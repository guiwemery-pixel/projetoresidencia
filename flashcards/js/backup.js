/*
 * Backup completo da coleção (um arquivo JSON): cards, baralhos, hierarquia
 * (áreas, subáreas, assuntos, temas), tags, histórico de revisões, sessões,
 * Quick Reviews, dados do scheduler, fontes (texto dos PDFs), imagens,
 * rascunhos da IA e configurações. A chave de API da IA NÃO entra no backup.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const STORES = ['cards', 'nodes', 'decks', 'logs', 'quickSessions', 'sessions', 'sources', 'drafts'];

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(url) {
    const m = String(url).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!m) throw new Error('Imagem inválida');
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  }

  async function exportBackup() {
    const stores = {};
    for (const name of STORES) stores[name] = await FC.db.getAll(name);
    const media = [];
    for (const m of await FC.db.getAll('media')) media.push({ name: m.name, dataUrl: await blobToDataUrl(m.blob) });
    stores.media = media;
    const data = {
      format: FC.formats.FORMAT_BACKUP,
      version: 1,
      app: 'Flashcards — Projeto Residente',
      exportedAt: new Date().toISOString(),
      settings: FC.settings.get(),
      counts: { cards: stores.cards.length, logs: stores.logs.length, decks: stores.decks.length, nodes: stores.nodes.length },
      stores,
    };
    await FC.db.setKV('lastBackupAt', Date.now());
    return JSON.stringify(data);
  }

  /** Restaura um backup, substituindo tudo o que existe neste navegador. */
  async function restore(data, onProgress) {
    const progress = onProgress || (() => {});
    if (!data || data.format !== FC.formats.FORMAT_BACKUP || !data.stores) throw new Error('Arquivo de backup inválido.');
    progress('Apagando dados atuais…');
    const key = FC.settings.getApiKey();
    await FC.db.wipe();
    if (key) await FC.settings.setApiKey(key);
    for (const name of STORES) {
      const list = Array.isArray(data.stores[name]) ? data.stores[name] : [];
      progress('Restaurando ' + name + ' (' + list.length + ')…');
      await FC.db.bulkPut(name, list);
    }
    const media = [];
    for (const m of data.stores.media || []) {
      try {
        media.push({ name: m.name, blob: await dataUrlToBlob(m.dataUrl) });
      } catch (e) {
        /* imagem corrompida: ignora */
      }
    }
    await FC.db.bulkPut('media', media);
    await FC.settings.replace(data.settings || {});
    await FC.store.load();
    FC.cards.invalidateIndex();
    FC.store.emit('cards', { restored: true });
    FC.store.emit('decks');
    FC.store.emit('nodes');
    return data.counts || {};
  }

  async function lastBackupAt() {
    return FC.db.getKV('lastBackupAt', null);
  }

  FC.backup = { exportBackup, restore, lastBackupAt };
})(typeof self !== 'undefined' ? self : this);
