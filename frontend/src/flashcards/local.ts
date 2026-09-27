import type { FlashcardsEngine } from './types';

/**
 * Ao sair da conta: envia o que faltar e apaga a cópia local dos flashcards
 * deste navegador (computador compartilhado), a menos que algo não tenha ido
 * para a conta (sem internet) — aí a cópia fica para não perder nada.
 */
export async function closeFlashcards(userId: string) {
  const FC = (globalThis as unknown as { FC?: FlashcardsEngine }).FC;
  const work = FC?.app ? FC.app.shutdown({ clearLocal: true }) : deleteIfSynced(`fc:${userId}`);
  // Nunca segura o "Sair" por muito tempo
  await Promise.race([work.catch(() => false), new Promise((r) => setTimeout(r, 4000))]);
}

function deleteIfSynced(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(false);
    let fresh = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = (e) => {
      // Não existia: não cria
      if (e.oldVersion === 0) {
        fresh = true;
        req.transaction?.abort();
      }
    };
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      if (fresh || !db.objectStoreNames.contains('outbox') || !db.objectStoreNames.contains('meta')) {
        db.close();
        return resolve(false);
      }
      const tx = db.transaction(['outbox', 'meta'], 'readonly');
      const count = tx.objectStore('outbox').count();
      const reset = tx.objectStore('meta').get('pendingReset');
      tx.oncomplete = () => {
        db.close();
        if (count.result || reset.result?.value) return resolve(false);
        const del = indexedDB.deleteDatabase(name);
        del.onsuccess = () => resolve(true);
        del.onerror = () => resolve(false);
        del.onblocked = () => resolve(false);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    };
  });
}

/** Conta excluída: apaga a cópia local dos flashcards sem tentar enviar nada. */
export async function discardFlashcards(userId: string) {
  const FC = (globalThis as unknown as { FC?: FlashcardsEngine }).FC;
  if (FC?.app) await FC.app.shutdown({ skipFlush: true }).catch(() => false);
  await new Promise<void>((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const req = indexedDB.deleteDatabase(`fc:${userId}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
