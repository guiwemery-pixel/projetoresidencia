// Aplica o tema salvo antes da primeira pintura (evita piscar claro→escuro).
(function () {
  try {
    var t = localStorage.getItem('fc-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* sem localStorage */
  }
})();
