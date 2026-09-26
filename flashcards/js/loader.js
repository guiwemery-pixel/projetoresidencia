/*
 * Carrega bibliotecas de terceiros só quando são usadas: pdf.js (PDF),
 * JSZip + sql.js + fzstd (pacotes do Anki), SDK da Anthropic (IA).
 * Ficam em frontend/public/flashcards/vendor, servidas pelo próprio site
 * (FC.config.assets), sem depender de CDN.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const loaded = new Map();

  /** Endereço de um arquivo de terceiros: "pdf.min.js" → "/flashcards/vendor/pdf.min.js". */
  const vendor = (file) => ((FC.config && FC.config.assets) || 'vendor/') + file;

  function script(file) {
    const src = vendor(file);
    if (loaded.has(src)) return loaded.get(src);
    const p = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        loaded.delete(src);
        reject(new Error('Não foi possível carregar ' + src));
      };
      document.head.appendChild(el);
    });
    loaded.set(src, p);
    return p;
  }

  /** URL absoluta de um arquivo de terceiros (para workers). */
  function url(file) {
    return new URL(vendor(file), document.baseURI).href;
  }

  FC.loader = { script, url };
})(typeof self !== 'undefined' ? self : globalThis);
