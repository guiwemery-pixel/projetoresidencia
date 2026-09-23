// Aplica o tema salvo antes da renderização (evita "piscar" claro/escuro)
try {
  var t = localStorage.getItem('ce-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* armazenamento indisponível */
}
