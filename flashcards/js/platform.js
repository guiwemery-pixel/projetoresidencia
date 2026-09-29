/*
 * Cards da plataforma: baralhos publicados para todos os usuários. O conteúdo fica
 * no Cloudflare R2 e chega pela API (/api/flashcards/platform), baralho a baralho.
 * Sem DOM — as telas ficam em ui/platformView.js.
 *
 * - Todos leem o mesmo baralho; o que cada um muda fica só na conta dele (kv
 *   sincronizado): 'platformHidden' {decks: [chave], cards: [chave]} e
 *   'platformEdits' {chave: {front, back, at}}. Chave = "<pacote>:<id>".
 * - "Adicionar à minha coleção" copia os cards (mesmo nome de baralho) com
 *   card.platform = {p: pacote, d: baralho, c: card, h: marca do conteúdo}.
 *   Enquanto frente e verso forem os originais (h confere), a sincronização não
 *   manda o texto para a conta: outro aparelho busca no R2 (hydrate).
 * - Estudar: "só estudar" (Não sei · Quase · Sei, fora do agendamento) ou
 *   "entrar nas revisões" (as 5 avaliações; cada card respondido vai para a
 *   coleção já agendado). Os cards chegam aos poucos: a sessão começa logo.
 * - Publicar (administradores): o .apkg é lido aqui e enviado em partes.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const U = FC.util;

  const CATALOG_TTL = 60 * 1000;
  const CHUNK_CACHE = 80; // baralhos guardados em memória
  const FETCH_PARALLEL = 6;
  const UPLOAD_MAX_BYTES = 2500000; // abaixo do limite de corpo das funções (4,5 MB no Vercel)
  const DECK_MAX_BYTES = 3800000;

  // Nomes de grande área dos baralhos → os usados no app (os outros ficam como estão)
  const AREA_ALIASES = {
    'clinica cirurgica': 'Cirurgia',
    'cirurgia geral': 'Cirurgia',
    'preventiva & social': 'Medicina Preventiva',
    'preventiva e social': 'Medicina Preventiva',
    'medicina preventiva e social': 'Medicina Preventiva',
    go: 'Ginecologia e Obstetrícia',
  };

  let catalog = null;
  let catalogUser = null;
  const chunks = new Map();

  const keyOf = (pkgId, id) => pkgId + ':' + id;
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const byteLength = (s) => (encoder ? encoder.encode(s).length : s.length * 2);
  const userKey = () => (FC.app && FC.app.userId ? FC.app.userId() : null);

  // ── Catálogo ───────────────────────────────────────────────────────────────
  function index(pkg) {
    pkg.byId = new Map();
    pkg.roots = [];
    for (const d of pkg.decks) {
      const segs = d.name.split('::');
      pkg.byId.set(d.id, Object.assign(d, { key: keyOf(pkg.id, d.id), short: segs[segs.length - 1], depth: segs.length - 1, children: [] }));
    }
    for (const d of pkg.byId.values()) {
      const parent = d.parent && pkg.byId.get(d.parent);
      if (parent) parent.children.push(d);
      else pkg.roots.push(d);
    }
    // Um baralho-raiz só com baralhos dentro, que não é uma grande área ("Flashcards
    // Revisados 2026"), é o nome do pacote: não entra na hierarquia
    const only = pkg.roots.length === 1 ? pkg.roots[0] : null;
    const isArea = only && FC.formats && FC.formats.guessArea && FC.formats.guessArea(only.name);
    pkg.dropRoot = !!(only && only.own === 0 && only.children.length > 0 && !isArea);
    return pkg;
  }

  /** { enabled, admin, packages } — cada pacote com a árvore (byId, roots). */
  async function load(force) {
    if (!force && catalog && catalogUser === userKey() && Date.now() - catalog.at < CATALOG_TTL) return catalog;
    const r = await FC.sync.request('GET', '/platform');
    r.packages.forEach(index);
    catalog = Object.assign({ at: Date.now() }, r);
    catalogUser = userKey();
    return catalog;
  }

  const cached = () => (catalog && catalogUser === userKey() ? catalog : null);

  function pkgById(id) {
    const c = cached();
    return c ? c.packages.find((p) => p.id === id) || null : null;
  }

  /** Baralhos com cards próprios dentro de `deckId` (ele incluído), na ordem da árvore. */
  function subtree(pkg, deckId, o) {
    const out = [];
    const walk = (d) => {
      if (o && o.hiddenDecks.has(d.key)) return;
      if (d.own) out.push(d);
      d.children.forEach(walk);
    };
    const start = pkg.byId.get(deckId);
    if (start) walk(start);
    return out;
  }

  function ancestors(pkg, deck) {
    const out = [];
    let d = deck;
    for (let guard = 0; d && guard < 20; guard++) {
      out.unshift(d);
      d = d.parent ? pkg.byId.get(d.parent) : null;
    }
    return out;
  }

  /** Cards de um baralho (só os dele, sem os de dentro). Guardados em memória. */
  function deckCards(pkg, deckId) {
    const k = pkg.id + '/' + pkg.version + '/' + deckId;
    if (chunks.has(k)) {
      const p = chunks.get(k);
      chunks.delete(k);
      chunks.set(k, p);
      return p;
    }
    const p = (async () => {
      const q = new URLSearchParams({ package: pkg.id, version: pkg.version, deck: deckId });
      let res;
      try {
        res = await fetch(FC.sync.url('/platform/cards?' + q), { credentials: 'include' });
      } catch (e) {
        throw new Error('Sem conexão: os cards da plataforma precisam da internet.');
      }
      if (res.status === 404) {
        catalog = null;
        throw new Error('Os cards da plataforma foram atualizados. Abra a aba de novo para carregar a versão nova.');
      }
      if (!res.ok) throw new Error('Não foi possível carregar os cards da plataforma (' + res.status + ').');
      const list = await res.json();
      return list.map((c) => Object.assign(c, { key: keyOf(pkg.id, c.id), pkg: pkg.id, deck: deckId }));
    })();
    p.catch(() => chunks.delete(k));
    chunks.set(k, p);
    while (chunks.size > CHUNK_CACHE) chunks.delete(chunks.keys().next().value);
    return p;
  }

  /** Busca vários baralhos, alguns ao mesmo tempo, na ordem pedida. */
  async function eachDeck(pkg, decks, fn) {
    for (let i = 0; i < decks.length; i += FETCH_PARALLEL) {
      const group = decks.slice(i, i + FETCH_PARALLEL);
      const lists = await Promise.all(group.map((d) => deckCards(pkg, d.id)));
      for (let j = 0; j < group.length; j++) await fn(group[j], lists[j]);
    }
  }

  // ── O que é só deste usuário ───────────────────────────────────────────────
  let overlayCache = null;
  let overlayUser = null;

  async function overlay() {
    if (overlayCache && overlayUser === userKey()) return overlayCache;
    const hidden = (await FC.db.getKV('platformHidden', null)) || {};
    const edits = (await FC.db.getKV('platformEdits', null)) || {};
    overlayCache = { hiddenDecks: new Set(hidden.decks || []), hiddenCards: new Set(hidden.cards || []), edits: new Map(Object.entries(edits)) };
    overlayUser = userKey();
    return overlayCache;
  }

  /** Mudou em outro aparelho (ou trocou de conta): relê na próxima vez. */
  function forget() {
    overlayCache = null;
  }

  async function saveHidden(o) {
    await FC.db.setKV('platformHidden', { decks: [...o.hiddenDecks], cards: [...o.hiddenCards] });
    FC.store.emit('platform', { hidden: true });
  }

  async function setDeckHidden(key, hidden) {
    const o = await overlay();
    if (hidden) o.hiddenDecks.add(key);
    else o.hiddenDecks.delete(key);
    await saveHidden(o);
  }

  async function setCardHidden(keys, hidden) {
    const o = await overlay();
    for (const k of [].concat(keys)) {
      if (hidden) o.hiddenCards.add(k);
      else o.hiddenCards.delete(k);
    }
    await saveHidden(o);
  }

  async function saveEdit(key, front, back) {
    const o = await overlay();
    if (front == null) o.edits.delete(key);
    else o.edits.set(key, { front: FC.sanitize(front), back: FC.sanitize(back || ''), at: Date.now() });
    await FC.db.setKV('platformEdits', Object.fromEntries(o.edits));
    FC.store.emit('platform', { edited: key });
  }

  /** Frente e verso como o app mostra (sem o cabeçalho do modelo, HTML limpo). */
  function canonical(card) {
    const parsed = FC.formats.parseModelFront(card.front);
    return { front: FC.sanitize(parsed.html), back: FC.sanitize(FC.formats.parseModelBack(card.back)), subject: parsed.subject, topics: parsed.topics };
  }

  /** O card como este usuário vê: com a edição dele, se houver. */
  function view(card, o) {
    const c = canonical(card);
    const e = o && o.edits.get(card.key);
    return Object.assign({}, card, { front: e ? e.front : c.front, back: e ? e.back : c.back, edited: !!e });
  }

  // ── Coleção ────────────────────────────────────────────────────────────────
  /** Marca do conteúdo: se frente e verso ainda são os da plataforma. */
  function contentHash(front, back) {
    const f = String(front == null ? '' : front);
    const b = String(back == null ? '' : back);
    return U.hashString(f + '\u0001' + b).toString(36) + '.' + (f.length + b.length).toString(36);
  }

  const isOriginal = (card) => !!(card && card.platform && card.platform.h && card.front != null && contentHash(card.front, card.back) === card.platform.h);

  /** Cards da coleção que vieram da plataforma: chave → card. */
  function collectionIndex() {
    const map = new Map();
    for (const c of FC.store.cards.values()) if (c.platform) map.set(keyOf(c.platform.p, c.platform.c), c);
    return map;
  }

  /** Quantos cards de cada baralho (e dos de dentro) já estão na coleção. */
  function collectionCounts(pkg) {
    const own = new Map();
    for (const c of FC.store.cards.values()) if (c.platform && c.platform.p === pkg.id) own.set(c.platform.d, (own.get(c.platform.d) || 0) + 1);
    const total = new Map();
    for (const [deckId, n] of own) for (const d of ancestors(pkg, pkg.byId.get(deckId))) total.set(d.id, (total.get(d.id) || 0) + n);
    return total;
  }

  /** Caminho na hierarquia (Grande área › Subárea › Assunto › Tema › Subtema). */
  function pathFor(pkg, deck, canon) {
    let parts = deck.name
      .split('::')
      .map((s) => s.trim())
      .filter(Boolean);
    if (pkg.dropRoot && parts.length > 1) parts = parts.slice(1);
    if (parts.length) parts[0] = AREA_ALIASES[U.normalizeText(parts[0])] || parts[0];
    if (canon && canon.subject) parts = parts.slice(0, 2).concat([canon.subject], canon.topics || []);
    return parts.slice(0, 5);
  }

  function toData(pkg, deck, card, o) {
    const canon = canonical(card);
    const e = o && o.edits.get(card.key);
    return {
      front: e ? e.front : canon.front,
      back: e ? e.back : canon.back,
      deckName: deck.name,
      path: pathFor(pkg, deck, canon),
      tags: card.tags || [],
      origin: 'platform',
      externalId: 'platform:' + card.key,
      // Editado antes de entrar: o texto passa a ser do usuário (vai inteiro para a conta)
      platform: { p: pkg.id, d: deck.id, c: card.id, original: !e },
    };
  }

  /** Grava na coleção (baralhos e caminhos criados uma vez só). */
  async function createInCollection(rows, onProgress) {
    const deckIds = new Map();
    for (const name of new Set(rows.map((r) => r.deckName))) deckIds.set(name, (await FC.decks.getOrCreate(name)).id);
    const nodeIds = new Map();
    for (const r of rows) {
      const k = r.path.join('\u0001');
      if (!nodeIds.has(k)) nodeIds.set(k, r.path.length ? await FC.areas.ensurePath(r.path) : null);
    }
    for (const r of rows) {
      r.deckId = deckIds.get(r.deckName);
      r.nodeId = nodeIds.get(r.path.join('\u0001'));
      delete r.deckName;
      delete r.path;
    }
    return FC.cards.bulkCreate(rows, onProgress);
  }

  /**
   * Copia para a coleção os cards de um baralho (e dos de dentro) que ainda não
   * estão nela. Entram como novos, na ordem do baralho.
   */
  async function addDeck(pkg, deckId, onProgress) {
    const progress = onProgress || (() => {});
    const o = await overlay();
    const have = collectionIndex();
    const decks = subtree(pkg, deckId, o);
    const total = decks.reduce((s, d) => s + d.own, 0);
    const rows = [];
    let already = 0;
    let loaded = 0;
    await eachDeck(pkg, decks, (deck, list) => {
      for (const card of list) {
        if (o.hiddenCards.has(card.key)) continue;
        if (have.has(card.key)) already++;
        else rows.push(toData(pkg, deck, card, o));
      }
      loaded += deck.own;
      progress('Baixando os cards… ' + U.fmtNum(loaded) + ' de ' + U.fmtNum(total));
    });
    const base = Date.now() - rows.length;
    rows.forEach((r, i) => (r.createdAt = base + i));
    if (rows.length) await createInCollection(rows, (i, n) => progress('Gravando na sua coleção… ' + U.fmtNum(i) + ' de ' + U.fmtNum(n)));
    return { added: rows.length, already };
  }

  /** Um card para a coleção (como novo, ou já com a primeira resposta). */
  async function addCard(pkg, card, answer) {
    const deck = pkg.byId.get(card.deck);
    if (!deck) throw new Error('Baralho não encontrado.');
    const existing = collectionIndex().get(card.key);
    if (existing) return { card: existing, existed: true };
    const data = toData(pkg, deck, card, await overlay());
    const now = Date.now();
    data.createdAt = now;
    if (answer) {
      const res = FC.scheduler.next(FC.scheduler.newState(), answer.rating, now, FC.settings.schedulerOptions());
      data.scheduling = res.card;
      data.logs = [Object.assign({ sessionId: answer.sessionId || null, responseTime: Math.max(0, Math.min(answer.responseTime || 0, 10 * U.MIN)), source: 'platform' }, res.log)];
    }
    const [created] = await createInCollection([data]);
    return { card: created, existed: false };
  }

  // ── Sincronização: texto dos cards só no R2 ────────────────────────────────
  /** Para a conta: sem frente/verso enquanto forem os da plataforma. */
  function slim(card) {
    if (!isOriginal(card)) return card;
    const out = Object.assign({}, card);
    delete out.front;
    delete out.back;
    return out;
  }

  /**
   * Completa cards que chegaram da conta sem frente/verso: usa a cópia deste
   * aparelho ou busca no R2. changes: [{store, id, value}] (value alterado no lugar).
   */
  async function hydrate(changes) {
    const missing = changes.filter((c) => c.store === 'cards' && c.value && c.value.platform && c.value.front == null);
    if (!missing.length) return 0;
    const local = await FC.db.getMany('cards', missing.map((c) => c.id));
    const toFetch = [];
    missing.forEach((c, i) => {
      const l = local[i];
      if (l && l.front != null && l.platform && l.platform.c === c.value.platform.c) Object.assign(c.value, { front: l.front, back: l.back });
      else toFetch.push(c);
    });
    if (!toFetch.length) return 0;
    // Sem o catálogo (sem internet, R2 fora do ar) a sincronização tenta de novo depois
    const cat = await load();
    if (!cat.enabled) throw new Error('Os cards da plataforma estão indisponíveis agora; a sincronização tenta de novo mais tarde.');
    const byDeck = new Map();
    for (const c of toFetch) {
      const k = c.value.platform.p + '/' + c.value.platform.d;
      if (!byDeck.has(k)) byDeck.set(k, []);
      byDeck.get(k).push(c);
    }
    const jobs = [...byDeck.values()];
    for (let i = 0; i < jobs.length; i += FETCH_PARALLEL) {
      await Promise.all(
        jobs.slice(i, i + FETCH_PARALLEL).map(async (list) => {
          const ref = list[0].value.platform;
          const pkg = cat.packages.find((p) => p.id === ref.p);
          const cards = pkg && pkg.byId.has(ref.d) ? await deckCards(pkg, ref.d) : [];
          const byId = new Map(cards.map((x) => [x.id, x]));
          for (const c of list) {
            const found = byId.get(c.value.platform.c);
            if (found) {
              const canon = canonical(found);
              Object.assign(c.value, { front: canon.front, back: canon.back });
            } else {
              // O pacote ou o card saiu da plataforma: aviso no lugar do texto, que
              // também não sobe para a conta (se o pacote voltar, o texto volta)
              const front = '<p><em>Este card saiu dos cards da plataforma.</em></p>';
              Object.assign(c.value, { front, back: '', platform: Object.assign({}, c.value.platform, { h: contentHash(front, '') }) });
            }
          }
        }),
      );
    }
    return toFetch.length;
  }

  // ── Sessão de estudo ───────────────────────────────────────────────────────
  /**
   * mode: 'free' (só estudar, fora do agendamento) | 'schedule' (entra nas revisões)
   * order: 'deck' | 'shuffle' · limit: 0 = todos
   */
  class Session {
    constructor(pkg, deckId, opts) {
      this.id = U.uid('p');
      this.pkg = pkg;
      this.deckId = deckId;
      this.mode = opts.mode === 'schedule' ? 'schedule' : 'free';
      this.order = opts.order || 'deck';
      this.limit = opts.limit || 0;
      this.label = opts.label || 'Cards da plataforma';
      this.startedAt = Date.now();
      this.cards = new Map(); // chave → card (como o usuário vê)
      this.raw = new Map(); // chave → card como veio da plataforma
      this.quick = FC.quickReview.create([], { label: this.label });
      this.queue = []; // modo 'schedule'
      this.answers = []; // modo 'schedule': {key, rating, cardId}
      this.added = 0;
      this.skippedInCollection = 0;
      this.pending = null;
      this.loading = null;
      this.error = null;
    }

    async start() {
      this.o = await overlay();
      this.have = collectionIndex();
      let decks = subtree(this.pkg, this.deckId, this.o);
      if (this.order === 'shuffle') decks = U.shuffle(decks);
      this.pending = decks;
      this.total = decks.reduce((s, d) => s + d.own, 0);
      await this.fill(20);
      this.fill(60).catch(() => {});
    }

    available() {
      return this.mode === 'free' ? this.quick.remaining() : this.queue.length;
    }

    loadedCount() {
      return this.cards.size;
    }

    full() {
      return this.limit && this.cards.size >= this.limit;
    }

    /** Carrega baralhos até ter `min` cards na fila (ou acabar). */
    fill(min) {
      if (this.loading) return this.loading;
      if (this.available() >= min || !this.pending.length || this.full()) return Promise.resolve();
      this.loading = (async () => {
        try {
          while (this.available() < min && this.pending.length && !this.full()) {
            const group = this.pending.splice(0, 3);
            const lists = await Promise.all(group.map((d) => deckCards(this.pkg, d.id)));
            for (let i = 0; i < group.length; i++) this.append(lists[i]);
          }
        } catch (e) {
          this.error = e;
          throw e;
        } finally {
          this.loading = null;
        }
      })();
      return this.loading;
    }

    append(list) {
      let keys = [];
      for (const card of list) {
        if (this.full()) break;
        if (this.o.hiddenCards.has(card.key) || this.cards.has(card.key)) continue;
        if (this.mode === 'schedule' && this.have.has(card.key)) {
          this.skippedInCollection++;
          continue;
        }
        this.raw.set(card.key, card);
        this.cards.set(card.key, view(card, this.o));
        keys.push(card.key);
      }
      if (this.order === 'shuffle') keys = U.shuffle(keys);
      if (this.mode === 'free') this.quick.append(keys);
      else this.queue.push(...keys);
    }

    /** Card da vez (ou null). Chama fill() antes quando a fila acaba. */
    current() {
      const key = this.mode === 'free' ? this.quick.current() : this.queue[0];
      return key ? this.cards.get(key) : null;
    }

    done() {
      return !this.current() && !this.pending.length && !this.loading;
    }

    /** Modo 'free': 'naosei' | 'quase' | 'sei'. */
    answerFree(answer) {
      this.quick.answer(answer);
      this.fill(15).catch(() => {});
    }

    /** Modo 'schedule': 1–5. O card entra na coleção já agendado. */
    async answerSchedule(rating, responseTime) {
      const key = this.queue[0];
      const card = this.cards.get(key);
      if (!card) return null;
      const res = await addCard(this.pkg, card, { rating, responseTime, sessionId: this.id });
      this.queue.shift();
      this.answers.push({ key, rating, cardId: res.card.id, existed: res.existed, date: Date.now() });
      if (!res.existed) this.added++;
      this.fill(15).catch(() => {});
      return res.card;
    }

    canUndo() {
      return this.mode === 'free' ? this.quick.history.length > 0 : this.answers.length > 0;
    }

    async undo() {
      if (this.mode === 'free') return this.quick.undo();
      const last = this.answers.pop();
      if (!last) return null;
      if (!last.existed) {
        await FC.cards.remove(last.cardId, { trash: false });
        this.added--;
      }
      this.queue.unshift(last.key);
      return last;
    }

    /** Tira um card da sessão (ocultado ou já adicionado na hora). */
    drop(key) {
      if (this.mode === 'free') {
        this.quick.queue = this.quick.queue.filter((k) => k !== key);
        this.quick.initialOrder = this.quick.initialOrder.filter((k) => k !== key);
        this.quick.history = this.quick.history.filter((x) => x.cardId !== key);
        this.quick.records.delete(key);
        this.quick.total = Math.max(0, this.quick.total - 1);
      } else this.queue = this.queue.filter((k) => k !== key);
      this.fill(15).catch(() => {});
    }

    /** Atualiza o card da sessão depois de editado. */
    refresh(key) {
      if (this.raw.has(key)) this.cards.set(key, view(this.raw.get(key), this.o));
    }
  }

  // ── Publicação (administradores) ───────────────────────────────────────────
  function compareDeckNames(a, b) {
    const x = a.split('::');
    const y = b.split('::');
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = x[i].localeCompare(y[i], 'pt-BR', { numeric: true, sensitivity: 'base' });
      if (c) return c;
    }
    return x.length - y.length;
  }

  /** Pacote do Anki → baralhos (árvore com contagens) e cards de cada baralho. */
  function buildPackage(pkgData) {
    const cardsByDeck = new Map();
    const names = new Set();
    for (const c of pkgData.cards) {
      const segs = String(c.deck || 'Anki')
        .split('::')
        .map((s) => s.trim())
        .filter(Boolean);
      const name = segs.join('::') || 'Anki';
      for (let i = 1; i <= segs.length; i++) names.add(segs.slice(0, i).join('::'));
      if (!cardsByDeck.has(name)) cardsByDeck.set(name, []);
      cardsByDeck.get(name).push({ id: String(c.ankiId), front: c.front, back: c.back, tags: (c.tags || []).slice(0, 100) });
    }
    const sorted = [...names].sort(compareDeckNames);
    const ids = new Map();
    const used = new Set();
    for (const name of sorted) {
      let id = U.hashString(name).toString(36);
      for (let n = 2; used.has(id); n++) id = U.hashString(name + '#' + n).toString(36);
      used.add(id);
      ids.set(name, id);
    }
    const decks = sorted.map((name) => {
      const segs = name.split('::');
      const parent = segs.length > 1 ? ids.get(segs.slice(0, -1).join('::')) : null;
      return { id: ids.get(name), name, parent, own: (cardsByDeck.get(name) || []).length, total: 0 };
    });
    const byName = new Map(decks.map((d) => [d.name, d]));
    for (const d of decks) {
      const segs = d.name.split('::');
      for (let i = 1; i <= segs.length; i++) byName.get(segs.slice(0, i).join('::')).total += d.own;
    }
    const files = decks.filter((d) => d.own).map((d) => ({ id: d.id, name: d.name, cards: cardsByDeck.get(d.name) }));
    const roots = decks.filter((d) => !d.parent);
    return { decks, files, name: roots.length === 1 ? roots[0].name : null, cards: pkgData.cards.length };
  }

  /** Lê o .apkg: prévia para a tela confirmar antes de enviar. */
  async function readForPublish(file, onProgress) {
    const pkgData = await FC.anki.readPackage(file, FC.settings.schedulerOptions(), onProgress);
    const built = buildPackage(pkgData);
    built.media = pkgData.media.length;
    built.fileName = file.name;
    if (!built.name) built.name = file.name.replace(/\.[^.]+$/, '');
    return built;
  }

  /** Envia para o R2 (pela API) em partes. packageId: atualizar um pacote que já existe. */
  async function publish(built, opts, onProgress) {
    const progress = onProgress || (() => {});
    const start = await FC.sync.request('POST', '/platform/publish', opts.packageId ? { packageId: opts.packageId } : {});
    const base = '/platform/publish/' + start.packageId + '/' + start.version;
    let batch = [];
    let size = 0;
    let sent = 0;
    const flush = async () => {
      if (!batch.length) return;
      await FC.sync.request('POST', base + '/decks', { decks: batch });
      sent += batch.reduce((s, d) => s + d.cards.length, 0);
      progress('Enviando… ' + U.fmtNum(sent) + ' de ' + U.fmtNum(built.cards) + ' cards');
      batch = [];
      size = 0;
    };
    for (const f of built.files) {
      const bytes = byteLength(JSON.stringify(f.cards)) + 100;
      if (bytes > DECK_MAX_BYTES) throw new Error('O baralho "' + f.name + '" é grande demais para enviar de uma vez. Divida-o em sub-baralhos no Anki.');
      if (batch.length && size + bytes > UPLOAD_MAX_BYTES) await flush();
      batch.push({ id: f.id, cards: f.cards });
      size += bytes;
    }
    await flush();
    progress('Finalizando…');
    const entry = await FC.sync.request('POST', base + '/finish', { name: opts.name || built.name, decks: built.decks });
    catalog = null;
    return entry;
  }

  async function removePackage(pkgId) {
    await FC.sync.request('DELETE', '/platform/packages/' + encodeURIComponent(pkgId));
    catalog = null;
  }

  FC.platform = {
    AREA_ALIASES,
    load,
    cached,
    pkgById,
    subtree,
    ancestors,
    deckCards,
    overlay,
    forget,
    setDeckHidden,
    setCardHidden,
    saveEdit,
    canonical,
    view,
    contentHash,
    isOriginal,
    collectionIndex,
    collectionCounts,
    pathFor,
    addDeck,
    addCard,
    slim,
    hydrate,
    Session,
    buildPackage,
    readForPublish,
    publish,
    removePackage,
    keyOf,
  };
})(typeof self !== 'undefined' ? self : globalThis);
