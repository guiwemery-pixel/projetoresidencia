/*
 * Service worker do site: o Projeto Residente abre sem internet.
 * - O app (index.html + JS/CSS do build) fica guardado na instalação; a lista vem de
 *   /offline-assets.json, gerado no build (vite.config.ts), com a versão do build.
 * - Leituras da API (GET /api/…): sempre da rede; sem internet, a última resposta
 *   guardada neste aparelho (as telas mostram os dados da última vez que abriram).
 *   Os flashcards têm a própria cópia local e sincronização: /api/flashcards passa direto.
 * - Gravações (POST/PATCH/…) passam direto: sem internet, o site guarda o registro e
 *   envia quando a conexão volta (frontend/src/api/offline.ts).
 * Ao sair da conta, o site apaga a cópia da API (caches "api-…").
 */
const VERSION = '__BUILD_VERSION__';
const SHELL = 'shell-' + VERSION;
const STATIC = 'static-v1';
const API = 'api-v1';
const NO_CACHE_API = /^\/api\/(flashcards|ical|auth\/(login|logout|register|signup)|cron|me\/export)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      let files = [];
      try {
        const res = await fetch('/offline-assets.json', { cache: 'no-store' });
        if (res.ok) files = (await res.json()).files || [];
      } catch (e) {
        /* sem a lista: guarda só a página; o resto entra no cache conforme é usado */
      }
      await cache.add(new Request('/', { cache: 'reload' }));
      // Um arquivo que falhar não impede a instalação
      await Promise.all(files.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => null)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api') event.waitUntil(caches.delete(API));
});

const offlineJson = () =>
  new Response(JSON.stringify({ error: 'Sem internet, e esta página ainda não foi aberta neste aparelho.', offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });

async function apiRead(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(API).then((c) => c.put(request, copy)).catch(() => {});
    } else if (res.status === 401) {
      // Saiu da conta (ou a sessão expirou): nada da conta anterior fica guardado
      caches.delete(API).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = await caches.match(request, { cacheName: API });
    if (!cached) return offlineJson();
    const headers = new Headers(cached.headers);
    headers.set('X-Offline', '1');
    return new Response(cached.body, { status: cached.status, headers });
  }
}

async function page(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return (await caches.match('/', { cacheName: SHELL })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(STATIC).then((c) => c.put(request, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => cached || Response.error());
  return cached || fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API.test(url.pathname)) return;
    event.respondWith(apiRead(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  // Arquivos do build têm o conteúdo no nome: nunca mudam
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }
  // Pacotes grandes dos flashcards (PDF, Anki) só quando usados; o resto (ícones, manifesto…)
  if (url.pathname.startsWith('/flashcards/vendor/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
