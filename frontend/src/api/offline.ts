// Sem internet: leituras vêm da última cópia guardada pelo service worker (public/sw.js);
// gravações do dia a dia (registrar estudo, remarcar revisão, item do cronograma) ficam
// numa fila neste aparelho e são enviadas, na ordem, quando a conexão volta.
// Outras gravações (excluir, importar, grupos…) pedem internet.

export interface QueuedRequest {
  id: string;
  method: string;
  path: string;
  body: unknown;
  at: number;
  label: string;
}

const QUEUEABLE: { method: string; re: RegExp; label: string }[] = [
  { method: 'POST', re: /^\/studies$/, label: 'Estudo registrado' },
  { method: 'POST', re: /^\/studies\/batch$/, label: 'Estudo de vários assuntos' },
  { method: 'PATCH', re: /^\/reviews\/[^/?]+\/reschedule$/, label: 'Revisão remarcada' },
  { method: 'PATCH', re: /^\/plans\/items\/[^/?]+$/, label: 'Item do cronograma' },
];

let owner: string | null = null;
const listeners = new Set<() => void>();
const key = () => `offline-queue:${owner ?? 'anon'}`;

/** A fila é de cada conta (quem sair e outra pessoa entrar não envia o que não é dela). */
export function setOfflineOwner(userId: string | null) {
  if (owner === userId) return;
  owner = userId;
  queueMicrotask(notify);
}

function read(): QueuedRequest[] {
  try {
    return JSON.parse(localStorage.getItem(key()) || '[]') as QueuedRequest[];
  } catch {
    return [];
  }
}

function write(list: QueuedRequest[]) {
  try {
    if (list.length) localStorage.setItem(key(), JSON.stringify(list));
    else localStorage.removeItem(key());
  } catch {
    /* sem armazenamento: a gravação se perde, como antes */
  }
  notify();
}

function notify() {
  for (const fn of listeners) fn();
}

export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const pendingRequests = () => read();

/** Pode esperar a internet voltar? Devolve o nome do que foi guardado. */
export function queueable(method: string, path: string) {
  return QUEUEABLE.find((q) => q.method === method && q.re.test(path))?.label ?? null;
}

export function enqueue(method: string, path: string, body: unknown, label: string) {
  const item: QueuedRequest = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, path, body, at: Date.now(), label };
  write([...read(), item]);
  return item;
}

/** Erro de "sem internet" numa gravação que ficou na fila (a tela avisa que vai depois). */
export class QueuedOffline extends Error {
  queued = true as const;
  constructor(public item: QueuedRequest) {
    super('Sem internet: ficou salvo neste aparelho e será enviado quando a conexão voltar.');
  }
}

export const isQueuedOffline = (err: unknown): err is QueuedOffline => err instanceof QueuedOffline;

let flushing: Promise<{ sent: number; failed: { label: string; message: string }[] }> | null = null;

/** Envia a fila na ordem. Para no primeiro erro de rede; erro do servidor tira o item (com aviso). */
export function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    const failed: { label: string; message: string }[] = [];
    for (const item of read()) {
      let res: Response;
      try {
        res = await fetch(`/api${item.path}`, {
          method: item.method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Offline-Replay': '1' },
          body: JSON.stringify(item.body ?? {}),
        });
      } catch {
        break; // ainda sem internet
      }
      if (res.status === 401) break; // sessão expirou: fica para depois de entrar de novo
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        failed.push({ label: item.label, message: data.error ?? `Erro ${res.status}` });
      } else sent++;
      write(read().filter((x) => x.id !== item.id));
    }
    return { sent, failed };
  })().finally(() => (flushing = null));
  return flushing;
}

/** Ao sair da conta: apaga a cópia das telas guardada neste aparelho. */
export async function clearOfflineCopy() {
  try {
    await caches.delete('api-v1');
  } catch {
    /* navegador sem Cache Storage */
  }
}
