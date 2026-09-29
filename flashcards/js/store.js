/*
 * Estado em memória carregado do IndexedDB na abertura. Os módulos de domínio
 * (cards, decks, areas, review...) alteram este estado e gravam no banco;
 * a interface só lê daqui e escuta eventos para se atualizar.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const listeners = new Map();

  const store = {
    loaded: false,
    cards: new Map(),
    nodes: new Map(),
    decks: new Map(),
    logs: [],
    logsByCard: new Map(),
    quickSessions: [],
    sessions: [],
    sources: new Map(),
    drafts: [],

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    emit(event, payload) {
      for (const fn of listeners.get(event) || []) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
      // "sync" é só o estado da sincronização: não conta como alteração dos dados
      if (event !== 'change' && event !== 'sync') for (const fn of listeners.get('change') || []) fn({ event, payload });
    },

    async load() {
      const db = FC.db;
      const [cards, nodes, decks, logs, quick, sessions, sources, drafts] = await Promise.all([
        db.getAll('cards'),
        db.getAll('nodes'),
        db.getAll('decks'),
        db.getAll('logs'),
        db.getAll('quickSessions'),
        db.getAll('sessions'),
        db.getAll('sources'),
        db.getAll('drafts'),
      ]);
      this.cards = new Map(cards.map((c) => [c.id, c]));
      this.nodes = new Map(nodes.map((n) => [n.id, n]));
      this.decks = new Map(decks.map((d) => [d.id, d]));
      this.logs = logs.sort((a, b) => a.date - b.date);
      this.reindexLogs();
      this.quickSessions = quick.sort((a, b) => a.startedAt - b.startedAt);
      this.sessions = sessions.sort((a, b) => a.startedAt - b.startedAt);
      this.sources = new Map(sources.map((s) => [s.id, s]));
      this.drafts = drafts.sort((a, b) => (a.order || 0) - (b.order || 0));
      this.loaded = true;
    },

    reindexLogs() {
      this.logsByCard = new Map();
      for (const log of this.logs) {
        if (!this.logsByCard.has(log.cardId)) this.logsByCard.set(log.cardId, []);
        this.logsByCard.get(log.cardId).push(log);
      }
    },

    addLogs(list) {
      for (const log of list) {
        this.logs.push(log);
        if (!this.logsByCard.has(log.cardId)) this.logsByCard.set(log.cardId, []);
        this.logsByCard.get(log.cardId).push(log);
      }
      if (list.some((l, i) => i > 0 && l.date < list[i - 1].date) || (list.length && this.logs.length > list.length && list[0].date < this.logs[this.logs.length - list.length - 1].date)) {
        this.logs.sort((a, b) => a.date - b.date);
        for (const arr of this.logsByCard.values()) arr.sort((a, b) => a.date - b.date);
      }
    },

    removeLogs(ids) {
      const set = new Set(ids);
      this.logs = this.logs.filter((l) => !set.has(l.id));
      this.reindexLogs();
    },

    cardLogs(cardId) {
      return this.logsByCard.get(cardId) || [];
    },

    /**
     * Alterações vindas de outros aparelhos (já gravadas no banco local):
     * [{store, id, value|null}]. Atualiza a memória e avisa as telas.
     */
    applyRemote(changes) {
      const touched = new Set();
      const maps = { cards: this.cards, nodes: this.nodes, decks: this.decks, sources: this.sources };
      const lists = { quickSessions: 'quickSessions', sessions: 'sessions', drafts: 'drafts' };
      const removedLogs = new Set();
      const addedLogs = [];
      for (const c of changes) {
        touched.add(c.store);
        if (maps[c.store]) {
          if (c.value == null) maps[c.store].delete(c.id);
          else maps[c.store].set(c.id, c.value);
        } else if (lists[c.store]) {
          const key = lists[c.store];
          const list = this[key].filter((x) => x.id !== c.id);
          if (c.value != null) list.push(c.value);
          this[key] = list;
        } else if (c.store === 'logs') {
          removedLogs.add(c.id);
          if (c.value != null) addedLogs.push(c.value);
        }
      }
      if (removedLogs.size) {
        this.logs = this.logs.filter((l) => !removedLogs.has(l.id)).concat(addedLogs).sort((a, b) => a.date - b.date);
        this.reindexLogs();
      }
      this.quickSessions.sort((a, b) => a.startedAt - b.startedAt);
      this.sessions.sort((a, b) => a.startedAt - b.startedAt);
      this.drafts.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (touched.has('cards') || touched.has('logs')) this.emit('cards', { remote: true });
      if (touched.has('decks')) this.emit('decks', { remote: true });
      if (touched.has('nodes')) this.emit('nodes', { remote: true });
      if (touched.has('drafts')) this.emit('drafts', { remote: true });
      if (touched.has('sources')) this.emit('sources', { remote: true });
      if (touched.has('quickSessions')) this.emit('quick', { remote: true });
      if (touched.has('trash')) this.emit('trash', { remote: true });
      return touched;
    },
  };

  FC.store = store;
})(typeof self !== 'undefined' ? self : globalThis);
