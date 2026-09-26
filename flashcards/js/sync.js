/*
 * Sincronização com a conta do Projeto Residente (API /api/flashcards).
 *
 * - Envio: a fila do banco local (outbox) vai em lotes de até ~1,2 MB; cada lote
 *   só sai da fila depois de confirmado pelo servidor.
 * - Recebimento: baixa o que foi gravado depois do cursor deste aparelho e aplica
 *   no banco local e na memória. Alteração local ainda não enviada vence.
 * - Primeiro envia, depois recebe: o que foi feito offline chega à conta antes.
 * - Durante uma revisão nada é aplicado na tela (só envia); aplica ao terminar.
 * - "Recomeçar" (a coleção foi substituída em outro aparelho, ou o cursor ficou
 *   velho demais): limpa a cópia local e baixa tudo de novo.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const PUSH_MAX_OPS = 4000;
  const PUSH_MAX_BYTES = 1200000;
  const MEDIA_MAX_CHARS = 3400000; // imagem do Anki até ~2,5 MB; maiores ficam só neste aparelho
  const PUSH_DELAY = 1500;
  const PERIODIC_MS = 5 * 60 * 1000;
  const BULK_APPLY = 3000; // acima disso recarrega tudo em vez de aplicar um a um

  let apiBase = '/api/flashcards';
  let running = null;
  let queued = null;
  let pushTimer = null;
  let retryTimer = null;
  let retryDelay = 15000;
  let periodic = null;
  let unsubscribe = null;
  let pullWaiting = false;

  const state = {
    status: 'idle', // idle | syncing | ok | offline | error
    lastSyncAt: null,
    error: null,
    quotaError: null,
    pending: 0,
    bytes: null,
    quota: null,
    progress: null, // {received, total} na primeira carga
  };

  function emit() {
    if (FC.store) FC.store.emit('sync', Object.assign({}, state));
  }

  function configure(opts) {
    if (opts && opts.apiBase) apiBase = opts.apiBase.replace(/\/$/, '');
  }

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(apiBase + path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('Sem conexão com o servidor. As alterações ficam guardadas neste aparelho.');
      err.offline = true;
      throw err;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Sua sessão expirou. Entre novamente para sincronizar.' : data.error || 'Falha na sincronização (' + res.status + ')');
      err.status = res.status;
      err.details = data.details;
      throw err;
    }
    return data;
  }

  function setUsage(r) {
    if (r && typeof r.bytes === 'number') state.bytes = r.bytes;
    if (r && typeof r.quota === 'number') state.quota = r.quota;
  }

  // ── Conversão (imagens viajam como data URL) ───────────────────────────────
  async function serialize(store, value) {
    if (store !== 'media') return value;
    if (!value.blob) return null;
    const dataUrl = await FC.backup.blobToDataUrl(value.blob);
    return dataUrl.length > MEDIA_MAX_CHARS ? null : { name: value.name, dataUrl };
  }

  function deserialize(store, d) {
    if (d == null) return null;
    if (store !== 'media') return d;
    try {
      return { name: d.name, blob: FC.backup.dataUrlToBlob(d.dataUrl) };
    } catch (e) {
      return null;
    }
  }

  // ── Envio ──────────────────────────────────────────────────────────────────
  async function pushAll() {
    if (await FC.db.getMeta('pendingReset', false)) {
      const r = await request('POST', '/reset');
      await FC.db.setMeta({ pendingReset: false, epoch: r.epoch, cursor: r.version });
      setUsage(r);
    }
    for (let round = 0; round < 500; round++) {
      const entries = await FC.db.outboxBatch(PUSH_MAX_OPS);
      if (!entries.length) return;
      const values = new Map();
      const byStore = new Map();
      for (const e of entries) {
        if (e.del) continue;
        if (!byStore.has(e.s)) byStore.set(e.s, []);
        byStore.get(e.s).push(e);
      }
      for (const [store, list] of byStore) {
        const rows = await FC.db.getMany(store, list.map((e) => e.id));
        list.forEach((e, i) => values.set(e.k, rows[i]));
      }
      let ops = [];
      let sent = [];
      let skipped = [];
      let size = 0;
      const flush = async () => {
        if (ops.length) {
          const epoch = await FC.db.getMeta('epoch', null);
          const r = await request('POST', '/sync', { epoch, ops });
          if (r.reset) {
            const err = new Error('A coleção foi substituída em outro aparelho.');
            err.resetEpoch = r.epoch;
            throw err;
          }
          await FC.db.setMeta({ epoch: r.epoch });
          setUsage(r);
        }
        await FC.db.outboxAck(sent.concat(skipped));
        ops = [];
        sent = [];
        skipped = [];
        size = 0;
      };
      for (const e of entries) {
        const value = values.get(e.k);
        let op;
        if (e.del || value === undefined) op = { s: e.s, id: e.id, del: true };
        else {
          const d = await serialize(e.s, value);
          if (d == null) {
            skipped.push(e);
            continue;
          }
          op = { s: e.s, id: e.id, d };
        }
        const bytes = (op.d ? JSON.stringify(op.d).length : 0) + 60;
        if (ops.length && size + bytes > PUSH_MAX_BYTES) await flush();
        ops.push(op);
        sent.push(e);
        size += bytes;
      }
      await flush();
    }
  }

  // ── Recebimento ────────────────────────────────────────────────────────────
  async function pullAll(onProgress) {
    let cursor = await FC.db.getMeta('cursor', 0);
    let epoch = await FC.db.getMeta('epoch', null);
    let received = 0;
    let total = null;
    let applied = [];
    let reload = cursor === 0; // primeira carga: recarrega tudo de uma vez
    for (let guard = 0; guard < 100000; guard++) {
      const r = await request('GET', '/sync?since=' + cursor + (cursor && epoch ? '&epoch=' + epoch : ''));
      setUsage(r);
      if (r.reset) {
        await FC.db.resetLocal();
        await FC.db.setMeta({ cursor: 0, epoch: r.epoch });
        cursor = 0;
        epoch = r.epoch;
        applied = [];
        reload = true;
        continue;
      }
      if (total == null && r.total != null) total = r.total;
      const changes = [];
      for (const x of r.records) if (FC.db.synced(x.s, x.id) && FC.db.STORES[x.s]) changes.push({ store: x.s, id: x.id, value: deserialize(x.s, x.d) });
      const done = await FC.db.applyRemote(changes);
      await FC.db.setMeta({ cursor: r.cursor, epoch: r.epoch });
      cursor = r.cursor;
      epoch = r.epoch;
      received += r.records.length;
      if (onProgress) onProgress(received, total);
      if (!reload) {
        applied = applied.concat(done);
        if (applied.length > BULK_APPLY) reload = true;
      }
      if (!r.more) break;
    }
    return { applied: reload ? [] : applied, reload };
  }

  /** Leva para a memória (e para a tela) o que chegou da conta. */
  async function applyToMemory(res) {
    if (!FC.store.loaded) return;
    if (res.reload) {
      await FC.settings.load();
      await FC.store.load();
      FC.cards.invalidateIndex();
      FC.ui.forgetMedia();
      for (const ev of ['cards', 'decks', 'nodes', 'drafts', 'sources', 'quick']) FC.store.emit(ev, { remote: true });
      FC.store.emit('settings', FC.settings.get());
      return;
    }
    if (!res.applied.length) return;
    const kv = res.applied.filter((c) => c.store === 'kv');
    const media = res.applied.filter((c) => c.store === 'media').map((c) => c.id);
    if (media.length) FC.ui.forgetMedia(media);
    if (res.applied.some((c) => c.store === 'cards')) FC.cards.invalidateIndex();
    FC.store.applyRemote(res.applied.filter((c) => c.store !== 'kv' && c.store !== 'media'));
    if (kv.some((c) => c.id === 'settings')) {
      await FC.settings.load();
      FC.store.emit('settings', FC.settings.get());
    }
    if (media.length) FC.store.emit('cards', { remote: true, media: true });
  }

  const canApplyNow = () => !(FC.app && FC.app.inSession && FC.app.inSession());

  // ── Ciclo ──────────────────────────────────────────────────────────────────
  function run(opts = {}) {
    if (running) {
      queued = { pull: !!((queued && queued.pull) || opts.pull) };
      return running;
    }
    clearTimeout(pushTimer);
    running = (async () => {
      state.status = 'syncing';
      emit();
      let replaced = false;
      try {
        try {
          await pushAll();
        } catch (e) {
          if (e.resetEpoch === undefined) throw e;
          // A coleção foi substituída em outro aparelho: vale a versão da conta
          await FC.db.resetLocal();
          await FC.db.setMeta({ cursor: 0, epoch: e.resetEpoch, pendingReset: false });
          if (FC.ui && FC.ui.toast) FC.ui.toast('Seus flashcards foram substituídos em outro aparelho. Carregando a versão da conta…');
          opts.pull = true;
          replaced = true;
        }
        state.quotaError = null;
        if (opts.pull) {
          // A cópia local já foi limpa: a memória precisa acompanhar mesmo no meio de uma revisão
          if (replaced || canApplyNow() || !FC.store.loaded) {
            await applyToMemory(await pullAll(opts.onProgress));
            pullWaiting = false;
          } else pullWaiting = true;
        }
        state.status = 'ok';
        state.error = null;
        state.lastSyncAt = Date.now();
        retryDelay = 15000;
        clearTimeout(retryTimer);
      } catch (e) {
        if (e.offline) state.status = 'offline';
        else state.status = 'error';
        if (e.status === 413 && e.details && e.details.quota) state.quotaError = e.message;
        state.error = e.message;
        if (!e.offline && e.status !== 401) scheduleRetry();
        if (opts.throwErrors) throw e;
      } finally {
        state.progress = null;
        state.pending = await FC.db.outboxCount().catch(() => state.pending);
        running = null;
        emit();
        if (queued) {
          const q = queued;
          queued = null;
          run(q);
        }
      }
    })();
    return running;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => run({ pull: true }), retryDelay);
    retryDelay = Math.min(retryDelay * 2, PERIODIC_MS);
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run({ pull: false }), PUSH_DELAY);
  }

  const onOnline = () => run({ pull: true });
  const onOffline = () => {
    state.status = 'offline';
    emit();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') run({ pull: true });
  };

  /** Liga a sincronização em segundo plano (continua ao sair da aba de flashcards). */
  function start() {
    if (unsubscribe) return;
    unsubscribe = FC.db.onLocalChange(schedulePush);
    root.addEventListener('online', onOnline);
    root.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    periodic = setInterval(() => run({ pull: true }), PERIODIC_MS);
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    root.removeEventListener('online', onOnline);
    root.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(periodic);
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    periodic = null;
  }

  /** Envia o que falta agora (antes de sair da conta, por exemplo). */
  async function flush() {
    clearTimeout(pushTimer);
    if (running) await running.catch(() => {});
    await run({ pull: false });
    return FC.db.outboxCount();
  }

  /** Terminou uma revisão: aplica o que ficou esperando. */
  function resume() {
    if (pullWaiting) run({ pull: true });
  }

  FC.sync = {
    state,
    configure,
    request,
    start,
    stop,
    flush,
    resume,
    now: (opts) => run(Object.assign({ pull: true }, opts || {})),
    push: () => run({ pull: false }),
    status: () => Object.assign({}, state),
  };
})(typeof self !== 'undefined' ? self : globalThis);
