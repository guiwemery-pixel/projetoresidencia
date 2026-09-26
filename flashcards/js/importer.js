/*
 * Importação de cards e baralhos:
 *  - CSV/TXT no modelo Anki (ou planilha com títulos de coluna)
 *  - JSON (pacote de baralho deste app, com ou sem agendamento; ou lista de cards)
 *  - Anki .apkg/.colpkg (com agendamento e histórico de revisões)
 * Etapas: read(file) → prévia com opções → execute(plan, options).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { normalizeText, stripHtml, pascalTag } = FC.util;

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  async function read(file, onProgress) {
    const ext = extOf(file.name);
    const plan = { fileName: file.name, kind: null, rows: [], meta: {}, stats: {}, warnings: [], media: [] };
    if (ext === 'apkg' || ext === 'colpkg') {
      const pkg = await FC.anki.readPackage(file, FC.settings.schedulerOptions(), onProgress);
      plan.kind = 'anki';
      plan.media = pkg.media;
      plan.meta = { decks: pkg.decks };
      plan.stats = pkg.stats;
      plan.rows = pkg.cards.map((c) => {
        const parsed = FC.formats.parseModelFront(c.front);
        return {
          front: parsed.html,
          back: FC.formats.parseModelBack(c.back),
          subject: parsed.subject,
          topics: parsed.topics,
          hasModelHeader: !!parsed.subject,
          tags: c.tags,
          deck: c.deck,
          externalId: 'anki:' + c.ankiId,
          createdAt: c.createdAt,
          suspended: c.suspended,
          scheduling: c.scheduling,
          logs: c.logs,
          notetype: c.notetype,
        };
      });
      return plan;
    }
    const text = await file.text();
    const looksJson = ext === 'json' || /^\s*[[{]/.test(text.slice(0, 50));
    if (looksJson) {
      const parsed = FC.formats.parseJson(text);
      if (parsed.kind === 'backup') {
        plan.kind = 'backup';
        plan.backup = parsed.data;
        plan.stats = { cards: (parsed.data.stores.cards || []).length, logs: (parsed.data.stores.logs || []).length, decks: (parsed.data.stores.decks || []).length };
        return plan;
      }
      plan.kind = 'json';
      plan.rows = parsed.cards;
      plan.meta = { includesScheduling: parsed.includesScheduling };
      plan.stats = {
        cards: parsed.cards.length,
        withHistory: parsed.cards.filter((c) => c.logs && c.logs.length).length,
        logs: parsed.cards.reduce((s, c) => s + (c.logs ? c.logs.length : 0), 0),
        new: parsed.cards.filter((c) => !c.scheduling || c.scheduling.state === 'new').length,
      };
      return plan;
    }
    const parsed = FC.formats.parseText(text);
    plan.kind = 'text';
    plan.rows = parsed.rows;
    plan.meta = parsed.meta;
    plan.warnings = parsed.warnings;
    plan.stats = { cards: parsed.rows.length, withHeader: parsed.rows.filter((r) => r.hasModelHeader).length };
    return plan;
  }

  function firstDeck(plan) {
    return (plan.rows.find((r) => r.deck) || {}).deck || plan.meta.deck || null;
  }

  /** Opções iniciais sugeridas para a prévia. */
  function defaults(plan) {
    const deck = firstDeck(plan);
    const guess = FC.formats.guessArea(deck) || FC.formats.guessArea(plan.fileName);
    return {
      classify: 'auto',
      areaName: guess || 'Geral',
      subareaName: guess === 'Cirurgia' ? 'Cirurgia Geral' : guess || 'Geral',
      deckMode: 'file',
      deckName: deck ? deck : plan.fileName.replace(/\.[^.]+$/, ''),
      keepScheduling: plan.kind === 'anki' || (plan.kind === 'json' && plan.meta.includesScheduling),
      duplicates: 'skip',
      difficulty: '',
      extraTags: '',
    };
  }

  function matchNodeName(segment) {
    for (const n of FC.store.nodes.values()) if (pascalTag(n.name) === segment) return n.name;
    return FC.formats.humanizeTag(segment);
  }

  function compact(names) {
    const out = [];
    for (const n of names) {
      const s = String(n || '').trim();
      if (!s) break;
      out.push(s);
    }
    return out.slice(0, 5);
  }

  /**
   * Caminho na hierarquia (nomes) para uma linha, conforme as opções.
   * 'auto': cabeçalho do modelo → caminho/colunas do arquivo → tag hierárquica →
   * baralho com "::" → só grande área e subárea.
   */
  function resolvePath(row, o) {
    const base = [o.areaName, o.subareaName];
    const fromFile = () => {
      if (row.path && row.path.length) return compact(row.path);
      if (row.explicitPath) {
        const p = row.explicitPath.slice();
        if (!p[0]) p[0] = base[0];
        if (!p[1]) p[1] = base[1];
        return compact(p);
      }
      return null;
    };
    const fromHeader = () => (row.subject ? compact(base.concat([row.subject], row.topics || [])) : null);
    const fromTags = () => {
      const tag = (row.tags || []).find((t) => t.includes('::'));
      return tag ? compact(base.concat(tag.split('::').filter(Boolean).map(matchNodeName))) : null;
    };
    const fromDeck = (requireNested) => (row.deck && (!requireNested || row.deck.includes('::')) ? compact(row.deck.split('::')) : null);
    let path = null;
    if (o.classify === 'auto') path = fromHeader() || fromFile() || fromTags() || fromDeck(true);
    else if (o.classify === 'header') path = fromHeader();
    else if (o.classify === 'file') path = fromFile();
    else if (o.classify === 'tags') path = fromTags();
    else if (o.classify === 'deck') path = fromDeck(false);
    return path || compact(base);
  }

  function deckFor(row, o, plan) {
    if (o.deckMode === 'single') return o.deckName || 'Importados';
    return row.deck || plan.meta.deck || o.deckName || 'Importados';
  }

  function preview(plan, o, n = 6) {
    return plan.rows.slice(0, n).map((r) => ({ front: r.front, back: r.back, path: resolvePath(r, o), deck: deckFor(r, o, plan), state: r.scheduling ? r.scheduling.state : 'new', logs: r.logs ? r.logs.length : 0 }));
  }

  function contentKey(front, back) {
    return normalizeText(stripHtml(front)) + '\u0001' + normalizeText(stripHtml(back));
  }

  async function execute(plan, o, onProgress) {
    const progress = onProgress || (() => {});
    const byExternal = new Map();
    const byContent = new Map();
    for (const c of FC.store.cards.values()) {
      if (c.externalId) byExternal.set(c.externalId, c);
      byContent.set(contentKey(c.front, c.back), c);
    }
    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    const extra = FC.cards.normalizeTags(o.extraTags || '');
    for (const row of plan.rows) {
      const path = resolvePath(row, o);
      const hTag = FC.formats.hierarchicalTag(path);
      const tags = (row.tags || []).filter((t) => t !== hTag).concat(extra);
      const externalId = row.externalId || (row.id ? 'json:' + row.id : null);
      const existing = (externalId && (byExternal.get(externalId) || (row.id && FC.store.cards.get(row.id)))) || byContent.get(contentKey(row.front, row.back));
      const data = {
        front: row.front,
        back: row.back,
        path,
        deckName: deckFor(row, o, plan),
        tags,
        source: row.source || (row.page ? { fileName: plan.fileName, page: row.page } : null),
        reference: row.reference || '',
        estDifficulty: row.estDifficulty || row.difficulty || o.difficulty || null,
        estDifficultyBy: row.estDifficultyBy || (row.estDifficulty || row.difficulty || o.difficulty ? 'import' : null),
        cardType: row.cardType || '',
        origin: plan.kind === 'anki' ? 'anki' : plan.kind === 'json' ? 'json' : 'csv',
        favorite: !!row.favorite,
        suspended: !!row.suspended,
        createdAt: row.createdAt || null,
        externalId,
      };
      if (o.keepScheduling && row.scheduling) {
        data.scheduling = row.scheduling;
        data.logs = (row.logs || []).map((l) => Object.assign({ source: l.source || 'import' }, l));
      }
      if (existing) {
        if (o.duplicates === 'skip') {
          skipped++;
          continue;
        }
        if (o.duplicates === 'update') {
          toUpdate.push({ card: existing, data });
          continue;
        }
      }
      if (row.id && !FC.store.cards.has(row.id)) data.id = row.id;
      toCreate.push(data);
    }
    progress('Gravando ' + toCreate.length + ' cards…');
    const created = await FC.cards.bulkCreate(toCreate, (i, n) => progress('Gravando cards… ' + i + '/' + n));
    let updated = 0;
    const newLogs = [];
    for (const { card, data } of toUpdate) {
      const patch = { front: data.front, back: data.back, tags: data.tags, path: data.path };
      if (data.scheduling) {
        for (const f of FC.cards.SCHED_FIELDS) if (data.scheduling[f] !== undefined) patch[f] = data.scheduling[f];
        const known = new Set(FC.store.cardLogs(card.id).map((l) => l.date + ':' + l.rating));
        for (const l of data.logs || []) if (!known.has(l.date + ':' + l.rating)) newLogs.push(Object.assign({ id: FC.util.uid('l') }, l, { cardId: card.id }));
      }
      patch.suspended = data.suspended;
      await FC.cards.update(card.id, patch);
      updated++;
    }
    if (newLogs.length) {
      await FC.db.bulkPut('logs', newLogs);
      FC.store.addLogs(newLogs.sort((a, b) => a.date - b.date));
    }
    if (plan.media && plan.media.length) {
      progress('Gravando ' + plan.media.length + ' imagens…');
      await FC.db.bulkPut('media', plan.media.map((m) => ({ name: m.name, blob: m.blob })));
    }
    const logCount = created.reduce((s, c) => s + FC.store.cardLogs(c.id).length, 0) + newLogs.length;
    FC.store.emit('cards', { imported: true });
    return { created: created.length, updated, skipped, logs: logCount, media: plan.media ? plan.media.length : 0 };
  }

  FC.importer = { read, defaults, resolvePath, preview, execute, extOf };
})(typeof self !== 'undefined' ? self : this);
