/*
 * Configurações do usuário (guardadas no IndexedDB, tabela kv).
 * A chave de API da IA fica separada (kv "aiKey") e nunca entra no backup.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const DEFAULTS = {
    theme: 'system', // 'light' | 'dark' | 'system'
    // Estudo diário
    newPerDay: 20,
    reviewsPerDay: 300,
    newOrder: 'added', // 'added' | 'random'
    rolloverHour: 4,
    // Scheduler (FSRS)
    desiredRetention: 0.9,
    maximumInterval: 3650,
    // Análise de pontos fracos
    weakMinReviews: 10,
    weakMinCards: 3,
    weakRecentDays: 14,
    weakIncludeQuick: false,
    // Revisão
    showPathInReview: true,
    // IA
    aiProvider: 'manual', // 'manual' | 'anthropic' | 'backend'
    aiModel: 'claude-opus-5',
    aiEndpoint: '',
    aiEffort: 'high',
    // Padrões da geração
    genCount: 20,
    genAnswerSize: 'curta',
    genCardType: 'auto',
    genDifficulty: 'auto',
    genStyle: 'modelo', // 'modelo' (Pergunta/Resposta em tópicos) | 'livre'
    lastGenDeckId: null,
    // Exportação
    exportFields: ['front', 'back', 'deck', 'tags', 'source', 'difficulty'],
  };

  let current = Object.assign({}, DEFAULTS);
  let apiKey = '';

  const settings = {
    DEFAULTS,

    async load() {
      const saved = await FC.db.getKV('settings', {});
      current = Object.assign({}, DEFAULTS, saved || {});
      apiKey = (await FC.db.getKV('aiKey', '')) || '';
      return current;
    },

    get(key) {
      return key ? current[key] : Object.assign({}, current);
    },

    async set(patch) {
      current = Object.assign({}, current, patch);
      await FC.db.setKV('settings', current);
      if (FC.store) FC.store.emit('settings', current);
      return current;
    },

    /** Substitui tudo (restauração de backup). */
    async replace(all) {
      current = Object.assign({}, DEFAULTS, all || {});
      await FC.db.setKV('settings', current);
      if (FC.store) FC.store.emit('settings', current);
    },

    schedulerOptions() {
      return {
        desiredRetention: current.desiredRetention,
        maximumInterval: current.maximumInterval,
        rolloverHour: current.rolloverHour,
      };
    },

    getApiKey() {
      return apiKey;
    },

    async setApiKey(key) {
      apiKey = String(key || '').trim();
      await FC.db.setKV('aiKey', apiKey);
    },
  };

  FC.settings = settings;
})(typeof self !== 'undefined' ? self : this);
