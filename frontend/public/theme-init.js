// Roda antes da renderização (arquivo externo por causa da CSP):
// 1) aplica o tema salvo, sem "piscar" claro/escuro;
// 2) na versão só de flashcards (/cards), usa nome, ícone e manifesto próprios,
//    para "Adicionar à tela inicial" instalar um app separado.
try {
  var t = localStorage.getItem('ce-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* armazenamento indisponível */
}
(function () {
  var p = location.pathname;
  if (p !== '/cards' && p.indexOf('/cards/') !== 0) return;
  var set = function (sel, attr, value) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  };
  set('link[rel="manifest"]', 'href', '/cards.webmanifest');
  set('link[rel="apple-touch-icon"]', 'href', '/icons/flashcards-apple-touch.png');
  set('link[rel="icon"][type="image/png"]', 'href', '/icons/flashcards-32.png');
  set('meta[name="apple-mobile-web-app-title"]', 'content', 'Flashcards');
  set('meta[name="application-name"]', 'content', 'Flashcards');
  document.title = 'Flashcards';
})();
