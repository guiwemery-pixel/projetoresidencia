/*
 * Importação de baralhos do Anki (.apkg / .colpkg) COM as informações de revisão.
 *
 * - Lê collection.anki21b (zstd), collection.anki21 ou collection.anki2 (SQLite, via sql.js).
 * - Suporta o esquema antigo (col.models/col.decks em JSON) e o novo (tabelas notetypes,
 *   fields, templates, decks com configuração em protobuf).
 * - Renderiza frente/verso pelos modelos do Anki (campos, seções, cloze, {{FrontSide}}).
 * - Converte o agendamento: estado, vencimento, intervalo, repetições, esquecimentos,
 *   suspensão; estabilidade/dificuldade do FSRS vêm do próprio Anki (quando o FSRS
 *   estava ativo) ou são recalculadas pelo histórico (revlog). O histórico vira
 *   registros de revisão, então estatísticas e pontos fracos já partem dele.
 * - Imagens do pacote são guardadas no banco local.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.FC.util;
  const scheduler = isNode ? require('./scheduler.js') : root.FC.scheduler;
  const mod = factory(util, scheduler, root);
  if (isNode) module.exports = mod;
  else (root.FC = root.FC || {}).anki = mod;
})(typeof self !== 'undefined' ? self : this, function (util, scheduler, root) {
  'use strict';

  const { DAY, HOUR, clamp, dayStart, stripHtml } = util;

  // ── Protobuf mínimo ────────────────────────────────────────────────────────
  function readVarint(buf, pos) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = buf[pos++];
      result += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80 && pos < buf.length);
    return [result, pos];
  }

  function parseProto(buf) {
    const fields = {};
    let pos = 0;
    while (pos < buf.length) {
      let key;
      [key, pos] = readVarint(buf, pos);
      const field = Math.floor(key / 8);
      const wire = key & 7;
      let val;
      if (wire === 0) [val, pos] = readVarint(buf, pos);
      else if (wire === 2) {
        let len;
        [len, pos] = readVarint(buf, pos);
        val = buf.subarray(pos, pos + len);
        pos += len;
      } else if (wire === 5) {
        val = buf.subarray(pos, pos + 4);
        pos += 4;
      } else if (wire === 1) {
        val = buf.subarray(pos, pos + 8);
        pos += 8;
      } else break;
      (fields[field] = fields[field] || []).push(val);
    }
    return fields;
  }

  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  const bytesToString = (b) => (b ? decoder.decode(b) : '');

  // ── Modelos (templates) ────────────────────────────────────────────────────
  const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

  function renderCloze(text, active, isAnswer) {
    return String(text || '').replace(CLOZE_RE, (m, num, content, hint) => {
      if (Number(num) !== active) return content;
      if (isAnswer) return '<span class="cloze">' + content + '</span>';
      return '<span class="cloze">[' + (hint || '...') + ']</span>';
    });
  }

  function clozeNumbers(text) {
    const nums = new Set();
    let m;
    CLOZE_RE.lastIndex = 0;
    while ((m = CLOZE_RE.exec(String(text || '')))) nums.add(Number(m[1]));
    return [...nums].sort((a, b) => a - b);
  }

  const isEmptyField = (v) => !stripHtml(v || '').trim() && !/<img/i.test(v || '');

  /**
   * Renderiza um modelo do Anki.
   * ctx: { fields: {nome: valor}, ord, cloze (bool), isAnswer, frontSide, tags, deck, card, notetype }
   */
  function renderTemplate(tpl, ctx) {
    let out = String(tpl || '');
    const valueOf = (name) => {
      const n = name.trim();
      if (n === 'FrontSide') return ctx.frontSide || '';
      if (n === 'Tags') return ctx.tags || '';
      if (n === 'Deck') return ctx.deck || '';
      if (n === 'Subdeck') return (ctx.deck || '').split('::').pop();
      if (n === 'Card') return ctx.card || '';
      if (n === 'Type') return ctx.notetype || '';
      return ctx.fields[n] != null ? ctx.fields[n] : '';
    };
    // Seções condicionais (de dentro para fora)
    const SECTION = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
    let guard = 0;
    let m;
    while ((m = out.match(SECTION)) && guard++ < 200) {
      const name = m[2].includes(':') ? m[2].split(':').pop() : m[2];
      let value = valueOf(name);
      if (m[2].startsWith('cloze:') && ctx.cloze) value = clozeNumbers(value).includes(ctx.ord + 1) ? 'x' : '';
      const filled = !isEmptyField(value);
      const keep = m[1] === '#' ? filled : !filled;
      out = out.replace(m[0], keep ? m[3] : '');
    }
    out = out.replace(/\{\{([^{}]+?)\}\}/g, (whole, expr) => {
      const parts = expr.split(':');
      const name = parts.pop();
      const filters = parts.map((f) => f.trim().toLowerCase());
      if (filters.includes('type')) return '';
      let value = valueOf(name);
      if (filters.includes('cloze')) value = renderCloze(value, ctx.ord + 1, ctx.isAnswer);
      if (filters.includes('text')) value = stripHtml(value);
      if (filters.some((f) => f.startsWith('tts'))) return '';
      return value;
    });
    return out;
  }

  const FRONT_MARK = '\u0000FRONT\u0000';

  /** Frente e verso de um card. model: {type (0|1), tmpls:[{ord, qfmt, afmt}], flds:[{name, ord}], name} */
  function renderCard(model, note, ord, deckName) {
    const isCloze = model.type === 1;
    const values = String(note.flds || '').split('\x1f');
    const fields = {};
    for (const f of model.flds) fields[f.name] = values[f.ord] != null ? values[f.ord] : '';
    const tmpl = isCloze ? model.tmpls[0] : model.tmpls.find((t) => t.ord === ord) || model.tmpls[0];
    if (!tmpl) return { front: values[0] || '', back: values[1] || '' };
    const base = { fields, ord, cloze: isCloze, tags: String(note.tags || '').trim(), deck: deckName, card: tmpl.name, notetype: model.name };
    const front = renderTemplate(tmpl.qfmt, Object.assign({}, base, { isAnswer: false }));
    let back = renderTemplate(tmpl.afmt, Object.assign({}, base, { isAnswer: true, frontSide: FRONT_MARK }));
    const hr = back.search(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i);
    if (hr >= 0) back = back.slice(hr).replace(/^<hr[^>]*>/i, '');
    back = back.split(FRONT_MARK).join('');
    return { front: cleanRendered(front), back: cleanRendered(back) };
  }

  function cleanRendered(html) {
    return String(html || '')
      .replace(/\[sound:[^\]]*\]/g, '')
      .replace(/^(\s|<br\s*\/?>)+/i, '')
      .replace(/(\s|<br\s*\/?>)+$/i, '')
      .trim();
  }

  // ── Agendamento ────────────────────────────────────────────────────────────
  const EASE_TO_RATING = { 1: 1, 2: 2, 3: 4, 4: 5 };

  function factorToDifficulty(factor) {
    const ease = (factor || 2500) / 1000;
    const d = ease <= 2.5 ? 5 + (2.5 - ease) * (5 / 1.2) : 5 - (ease - 2.5) * 4;
    return clamp(d, 1, 10);
  }

  /** Histórico do Anki → registros de revisão deste app. */
  function convertLogs(revlogs) {
    const sorted = revlogs.filter((r) => EASE_TO_RATING[r.ease] && r.type >= 0 && r.type <= 3).sort((a, b) => a.id - b.id);
    return sorted.map((r, i) => {
      const prev = r.lastIvl > 0 ? r.lastIvl : r.lastIvl < 0 ? -r.lastIvl / 86400 : 0;
      const next = r.ivl > 0 ? r.ivl : r.ivl < 0 ? -r.ivl / 86400 : 0;
      return {
        date: r.id,
        rating: EASE_TO_RATING[r.ease],
        previousInterval: prev,
        newInterval: next,
        responseTime: clamp(r.time || 0, 0, 10 * 60 * 1000),
        stateBefore: r.type === 0 ? (i === 0 ? 'new' : 'learning') : 'review',
        stateAfter: next >= 1 ? 'review' : 'learning',
        source: 'anki',
      };
    });
  }

  /**
   * Cartão do Anki → estado de agendamento deste app.
   * card: linha da tabela cards; revlogs: linhas do revlog do card; crt: col.crt (segundos)
   */
  function convertScheduling(card, revlogs, crt, opts) {
    const rollover = (opts && opts.rolloverHour) != null ? opts.rolloverHour : 4;
    const logs = convertLogs(revlogs || []);
    const dueRaw = card.odid && card.odue ? card.odue : card.due;
    let fsrs = null;
    try {
      const data = card.data ? JSON.parse(card.data) : null;
      if (data && data.s != null && data.d != null) fsrs = { s: Number(data.s), d: Number(data.d) };
    } catch (e) {
      /* data não é JSON */
    }
    const out = scheduler.newState();
    out.repetitions = card.reps || 0;
    out.lapses = card.lapses || 0;
    const suspended = card.queue === -1;
    if (card.type === 0) return { scheduling: out, logs, suspended };

    out.state = card.type === 1 ? 'learning' : 'review';
    const isTimestamp = card.queue === 1 || card.queue === 4 || dueRaw > 1e9;
    if (isTimestamp) out.dueDate = dueRaw * 1000;
    else out.dueDate = dayStart(crt * 1000 + dueRaw * DAY + 6 * HOUR, rollover);
    out.scheduledDays = card.ivl > 0 ? card.ivl : card.ivl < 0 ? -card.ivl / 86400 : 0;
    out.lastReview = logs.length ? logs[logs.length - 1].date : out.dueDate - Math.max(out.scheduledDays, 0) * DAY;

    if (fsrs && isFinite(fsrs.s) && isFinite(fsrs.d)) {
      out.stability = Math.max(0.01, fsrs.s);
      out.difficulty = clamp(fsrs.d, 1, 10);
    } else if (logs.length) {
      const replayed = scheduler.replay(logs.map((l) => ({ date: l.date, rating: l.rating })), opts);
      // Mesmo cálculo que o Anki faz ao ativar o FSRS: estado de memória a partir do histórico
      out.stability = replayed.stability;
      out.difficulty = replayed.difficulty;
    } else {
      out.stability = Math.max(1, out.scheduledDays || 1);
      out.difficulty = factorToDifficulty(card.factor);
    }
    if (out.state === 'learning' && !isTimestamp) out.state = 'review';
    return { scheduling: out, logs, suspended };
  }

  // ── Leitura do pacote (navegador) ──────────────────────────────────────────
  const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  const isZstd = (b) => b && b.length > 4 && ZSTD_MAGIC.every((x, i) => b[i] === x);

  async function libs() {
    const L = root.FC.loader;
    await Promise.all([L.script('assets/vendor/jszip.min.js'), L.script('assets/vendor/fzstd.js'), L.script('assets/vendor/sql-asm.js')]);
    if (!root.__sqlPromise) root.__sqlPromise = root.initSqlJs();
    return { JSZip: root.JSZip, fzstd: root.fzstd, SQL: await root.__sqlPromise };
  }

  function rows(db, sql) {
    const res = db.exec(sql);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  }

  function hasTable(db, name) {
    return rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='" + name + "'").length > 0;
  }

  function readModels(db) {
    const col = rows(db, 'SELECT crt, models, decks FROM col')[0] || {};
    let models = {};
    let decks = {};
    try {
      if (col.models && col.models.length > 2) {
        for (const m of Object.values(JSON.parse(col.models))) {
          models[m.id] = { id: m.id, name: m.name, type: m.type, flds: m.flds.map((f) => ({ name: f.name, ord: f.ord })), tmpls: m.tmpls.map((t) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })) };
        }
      }
      if (col.decks && col.decks.length > 2) for (const d of Object.values(JSON.parse(col.decks))) decks[d.id] = d.name;
    } catch (e) {
      /* formato novo */
    }
    if (!Object.keys(models).length && hasTable(db, 'notetypes')) {
      for (const nt of rows(db, 'SELECT id, name, config FROM notetypes')) {
        const cfg = parseProto(nt.config || new Uint8Array());
        models[nt.id] = { id: nt.id, name: nt.name, type: cfg[1] ? cfg[1][0] : 0, flds: [], tmpls: [] };
      }
      for (const f of rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) if (models[f.ntid]) models[f.ntid].flds.push({ name: f.name, ord: f.ord });
      for (const t of rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
        const cfg = parseProto(t.config || new Uint8Array());
        if (models[t.ntid]) models[t.ntid].tmpls.push({ name: t.name, ord: t.ord, qfmt: bytesToString(cfg[1] && cfg[1][0]), afmt: bytesToString(cfg[2] && cfg[2][0]) });
      }
    }
    if (!Object.keys(decks).length && hasTable(db, 'decks')) {
      for (const d of rows(db, 'SELECT id, name FROM decks')) decks[d.id] = String(d.name).split('\x1f').join('::');
    }
    return { crt: col.crt || Math.floor(Date.now() / 1000), models, decks };
  }

  async function readMedia(zip, fzstd) {
    const file = zip.file('media');
    if (!file) return [];
    let bytes = await file.async('uint8array');
    if (isZstd(bytes)) bytes = fzstd.decompress(bytes);
    const list = [];
    const text = bytesToString(bytes.subarray(0, Math.min(bytes.length, 1)));
    if (text === '{') {
      const map = JSON.parse(bytesToString(bytes));
      for (const [zipName, name] of Object.entries(map)) list.push({ zipName, name });
    } else {
      const entries = parseProto(bytes)[1] || [];
      entries.forEach((e, i) => {
        const f = parseProto(e);
        const legacy = f[255] ? String(f[255][0]) : null;
        list.push({ zipName: legacy || String(i), name: bytesToString(f[1] && f[1][0]) });
      });
    }
    return list;
  }

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

  /**
   * Lê o arquivo e devolve { notes, cards (já renderizados + agendamento), decks, media, stats }.
   * Os dados ainda não são gravados — a tela de importação mostra a prévia antes.
   */
  async function readPackage(file, opts, onProgress) {
    const progress = onProgress || (() => {});
    progress('Abrindo o pacote…');
    const { JSZip, fzstd, SQL } = await libs();
    const zip = await JSZip.loadAsync(file);
    let dbBytes = null;
    const b21 = zip.file('collection.anki21b');
    if (b21) dbBytes = fzstd.decompress(await b21.async('uint8array'));
    else if (zip.file('collection.anki21')) dbBytes = await zip.file('collection.anki21').async('uint8array');
    else if (zip.file('collection.anki2')) dbBytes = await zip.file('collection.anki2').async('uint8array');
    if (!dbBytes) throw new Error('Pacote do Anki sem coleção (collection.anki2/anki21).');
    progress('Lendo a coleção…');
    const db = new SQL.Database(dbBytes);
    try {
      const { crt, models, decks } = readModels(db);
      const notes = new Map(rows(db, 'SELECT id, guid, mid, flds, tags FROM notes').map((n) => [n.id, n]));
      const cardRows = rows(db, 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odue, odid' + (rows(db, 'PRAGMA table_info(cards)').some((c) => c.name === 'data') ? ', data' : '') + ' FROM cards');
      const revByCard = new Map();
      for (const r of rows(db, 'SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog')) {
        if (!revByCard.has(r.cid)) revByCard.set(r.cid, []);
        revByCard.get(r.cid).push(r);
      }
      // Coleção de exemplo "atualize o Anki" quando só há collection.anki2 antigo
      progress('Convertendo ' + cardRows.length + ' cards…');
      const cards = [];
      let withHistory = 0;
      let logCount = 0;
      for (const c of cardRows) {
        const note = notes.get(c.nid);
        const model = note && models[note.mid];
        if (!note || !model) continue;
        const deckId = c.odid || c.did;
        const deckName = decks[deckId] || decks[c.did] || 'Anki';
        const rendered = renderCard(model, note, c.ord, deckName);
        if (!stripHtml(rendered.front).trim() && !/<img/i.test(rendered.front)) continue;
        const sched = convertScheduling(c, revByCard.get(c.id), crt, opts);
        if (sched.logs.length) withHistory++;
        logCount += sched.logs.length;
        cards.push({
          ankiId: c.id,
          noteId: c.nid,
          front: rendered.front,
          back: rendered.back,
          deck: deckName === 'Default' ? 'Anki' : deckName,
          tags: String(note.tags || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean),
          notetype: model.name,
          createdAt: c.nid > 1e11 ? c.nid : Date.now(),
          suspended: sched.suspended,
          scheduling: sched.scheduling,
          logs: sched.logs,
        });
      }
      progress('Lendo imagens…');
      const mediaList = await readMedia(zip, fzstd);
      const used = new Set();
      for (const card of cards) {
        for (const html of [card.front, card.back]) {
          const re = /<img[^>]+src=["']?([^"' >]+)/gi;
          let m;
          while ((m = re.exec(html))) used.add(decodeURIComponent(m[1]));
        }
      }
      const media = [];
      for (const entry of mediaList) {
        if (!entry.name || !used.has(entry.name)) continue;
        const f = zip.file(entry.zipName);
        if (!f) continue;
        let bytes = await f.async('uint8array');
        if (isZstd(bytes)) bytes = fzstd.decompress(bytes);
        const ext = entry.name.split('.').pop().toLowerCase();
        if (!MIME[ext]) continue;
        media.push({ name: entry.name, blob: new Blob([bytes], { type: MIME[ext] }) });
      }
      const deckNames = [...new Set(cards.map((c) => c.deck))];
      return {
        cards,
        decks: deckNames,
        media,
        stats: {
          cards: cards.length,
          notes: notes.size,
          withHistory,
          logs: logCount,
          new: cards.filter((c) => c.scheduling.state === 'new').length,
          suspended: cards.filter((c) => c.suspended).length,
          media: media.length,
        },
      };
    } finally {
      db.close();
    }
  }

  return { parseProto, readVarint, renderTemplate, renderCard, renderCloze, clozeNumbers, convertScheduling, convertLogs, factorToDifficulty, readPackage };
});
