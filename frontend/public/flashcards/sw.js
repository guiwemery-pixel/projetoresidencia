/*
 * A versão antiga dos flashcards (site separado em /flashcards/index.html)
 * registrava um service worker. Agora os flashcards são uma aba do Projeto
 * Residente: este arquivo substitui o antigo, apaga os caches dele e se
 * desinstala, para o navegador sempre buscar o site atual.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('flashcards-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
