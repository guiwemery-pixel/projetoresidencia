/*
 * Carrega bibliotecas de terceiros (pasta assets/vendor) só quando são usadas:
 * pdf.js (PDF), JSZip + sql.js + fzstd (pacotes do Anki), SDK da Anthropic (IA).
 * Tudo local — funciona offline e abrindo o index.html direto do computador.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const loaded = new Map();

  function script(src) {
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

  /** URL absoluta de um arquivo do app (para workers). */
  function url(path) {
    return new URL(path, document.baseURI).href;
  }

  FC.loader = { script, url };
})(typeof self !== 'undefined' ? self : this);
