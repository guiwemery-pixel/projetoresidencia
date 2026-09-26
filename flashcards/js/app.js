/*
 * Aplicação: inicialização, layout (menu lateral, barra superior, navegação
 * inferior no celular), rotas por hash (#/...), tema e atalhos globais.
 * Cada tela fica em js/ui/*View.js e se registra em FC.views.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  FC.views = FC.views || {};
  const { h, icon, clear } = FC.ui;

  const ROUTES = [
    { re: /^\/?$/, view: 'dashboard', nav: 'dashboard' },
    { re: /^\/revisar\/?$/, view: 'review', nav: 'review' },
    { re: /^\/quick\/?$/, view: 'quickSetup', nav: 'quick' },
    { re: /^\/quick\/sessao\/?$/, view: 'quickSession', nav: 'quick' },
    { re: /^\/decks\/?$/, view: 'decks', nav: 'decks' },
    { re: /^\/decks\/no\/([^/]+)$/, view: 'nodeDetail', nav: 'decks', keys: ['id'] },
    { re: /^\/decks\/baralho\/([^/]+)$/, view: 'deckDetail', nav: 'decks', keys: ['id'] },
    { re: /^\/gerar\/?$/, view: 'generate', nav: 'generate' },
    { re: /^\/gerar\/revisao\/?$/, view: 'drafts', nav: 'generate' },
    { re: /^\/pontos-fracos\/?$/, view: 'weak', nav: 'weak' },
    { re: /^\/pontos-fracos\/([^/]+)$/, view: 'weakDetail', nav: 'weak', keys: ['id'] },
    { re: /^\/estatisticas\/?$/, view: 'stats', nav: 'stats' },
    { re: /^\/calendario\/?$/, view: 'calendar', nav: 'calendar' },
    { re: /^\/busca\/?$/, view: 'search', nav: 'search' },
    { re: /^\/favoritos\/?$/, view: 'favorites', nav: 'favorites' },
    { re: /^\/suspensos\/?$/, view: 'suspended', nav: 'suspended' },
    { re: /^\/importar\/?$/, view: 'importExport', nav: 'import' },
    { re: /^\/configuracoes\/?$/, view: 'settings', nav: 'settings' },
  ];

  const NAV = [
    { group: null, items: [{ key: 'dashboard', label: 'Início', icon: 'home', href: '#/' }] },
    {
      group: 'Revisar',
      items: [
        { key: 'review', label: 'Revisão normal', icon: 'play', href: '#/revisar', count: 'due' },
        { key: 'quick', label: 'Quick Review', icon: 'zap', href: '#/quick' },
      ],
    },
    {
      group: 'Conteúdo',
      items: [
        { key: 'decks', label: 'Decks', icon: 'layers', href: '#/decks' },
        { key: 'generate', label: 'Gerar com IA', icon: 'sparkles', href: '#/gerar', count: 'drafts' },
        { key: 'import', label: 'Importar e exportar', icon: 'upload', href: '#/importar' },
        { key: 'search', label: 'Busca', icon: 'search', href: '#/busca' },
        { key: 'favorites', label: 'Favoritos', icon: 'star', href: '#/favoritos' },
        { key: 'suspended', label: 'Cards suspensos', icon: 'pause', href: '#/suspensos' },
      ],
    },
    {
      group: 'Análise',
      items: [
        { key: 'weak', label: 'Pontos fracos', icon: 'target', href: '#/pontos-fracos' },
        { key: 'stats', label: 'Estatísticas', icon: 'chart', href: '#/estatisticas' },
        { key: 'calendar', label: 'Calendário', icon: 'calendar', href: '#/calendario' },
      ],
    },
    { group: null, items: [{ key: 'settings', label: 'Configurações', icon: 'settings', href: '#/configuracoes' }] },
  ];

  const BOTTOM = [
    { key: 'dashboard', label: 'Início', icon: 'home', href: '#/' },
    { key: 'review', label: 'Revisar', icon: 'play', href: '#/revisar' },
    { key: 'quick', label: 'Quick', icon: 'zap', href: '#/quick' },
    { key: 'decks', label: 'Decks', icon: 'layers', href: '#/decks' },
  ];

  const app = {
    state: {},
    current: null,
    cleanup: [],
  };

  let els = {};

  // ── Tema ───────────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'light' || theme === 'dark') html.setAttribute('data-theme', theme);
    else html.removeAttribute('data-theme');
    try {
      localStorage.setItem('fc-theme', theme || 'system');
    } catch (e) {
      /* sem localStorage */
    }
  }

  // ── Rotas ──────────────────────────────────────────────────────────────────
  function parseHash() {
    const raw = decodeURI(location.hash.replace(/^#/, '')) || '/';
    const [path, qs] = raw.split('?');
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => (query[k] = v));
    return { path: path || '/', query };
  }

  function go(path) {
    const target = '#' + path;
    if (location.hash === target) route();
    else location.hash = target;
  }

  function route() {
    const { path, query } = parseHash();
    let match = null;
    let params = {};
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (m) {
        match = r;
        (r.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        break;
      }
    }
    if (!match) {
      go('/');
      return;
    }
    for (const fn of app.cleanup) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    app.cleanup = [];
    FC.ui.closeMenus();
    document.body.classList.remove('nav-open', 'focus-mode');
    setActiveNav(match.nav);
    const view = FC.views[match.view];
    clear(els.content);
    els.content.scrollTop = 0;
    window.scrollTo(0, 0);
    app.current = match.view;
    const ctx = {
      el: els.content,
      params,
      query,
      setTitle(t) {
        els.title.textContent = t;
        document.title = t + ' · Flashcards';
      },
      on(event, fn) {
        app.cleanup.push(FC.store.on(event, fn));
      },
      onCleanup(fn) {
        app.cleanup.push(fn);
      },
      rerender() {
        route();
      },
    };
    ctx.setTitle(view && view.title ? view.title : 'Flashcards');
    try {
      const res = view.render(ctx);
      if (res && typeof res.then === 'function') res.catch(showViewError);
    } catch (e) {
      showViewError(e);
    }
  }

  function showViewError(e) {
    console.error(e);
    clear(els.content).appendChild(FC.ui.empty({ icon: 'alert', title: 'Algo deu errado nesta tela', text: e && e.message ? e.message : String(e), actions: [FC.ui.link('Voltar ao início', '#/')] }));
  }

  function setActiveNav(key) {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  function navLink(item) {
    const count = item.count ? h('span', { class: 'count hidden', dataset: { count: item.count } }) : null;
    return h('a', { class: 'nav-link', href: item.href, dataset: { nav: item.key } }, icon(item.icon, 18), h('span', null, item.label), count);
  }

  function buildLayout() {
    const sidebar = h(
      'aside',
      { class: 'sidebar', 'aria-label': 'Menu' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('layers', 18)), h('span', null, 'Flashcards', h('small', { text: 'Projeto Residente' }))),
      NAV.map((g) => h('nav', { class: 'nav-group', 'aria-label': g.group || 'Principal' }, g.group ? h('div', { class: 'nav-label', text: g.group }) : null, g.items.map(navLink))),
      h('div', { class: 'sidebar-foot' }, h('p', { class: 'tiny muted', text: 'Seus dados ficam neste navegador. Faça backups em Configurações.' })),
    );
    const title = h('span', { class: 'page-title' });
    const search = h('input', { type: 'search', placeholder: 'Buscar cards (tecla /)', 'aria-label': 'Buscar cards' });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && search.value.trim()) {
        go('/busca?q=' + encodeURIComponent(search.value.trim()));
        search.blur();
      }
    });
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'btn ghost icon menu-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu', 20)),
      title,
      h('div', { class: 'topbar-search' }, icon('search', 16), search),
      FC.ui.button('Novo card', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => FC.cardEditor.open({}) }),
    );
    const content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
    const bottom = h(
      'nav',
      { class: 'bottom-nav', 'aria-label': 'Navegação rápida' },
      BOTTOM.map((b) => h('a', { href: b.href, dataset: { nav: b.key } }, icon(b.icon, 20), h('span', { text: b.label }))),
      h('button', { type: 'button', onclick: () => document.body.classList.add('nav-open') }, icon('menu', 20), h('span', { text: 'Mais' })),
    );
    const scrim = h('div', { class: 'nav-scrim', onclick: () => document.body.classList.remove('nav-open') });
    const shell = h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, topbar, content), bottom, scrim);
    const rootEl = document.getElementById('app');
    clear(rootEl).appendChild(shell);
    els = { content, title, search, sidebar };
  }

  function updateCounts() {
    const counts = FC.review.counts({});
    const due = counts.dueNow + counts.newToday;
    for (const el of document.querySelectorAll('[data-count="due"]')) {
      el.textContent = due > 999 ? '999+' : String(due);
      el.classList.toggle('hidden', !due);
    }
    const drafts = FC.store.drafts.length;
    for (const el of document.querySelectorAll('[data-count="drafts"]')) {
      el.textContent = String(drafts);
      el.classList.toggle('hidden', !drafts);
    }
  }

  function globalKeys(e) {
    if (FC.ui.anyModalOpen()) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      if (getComputedStyle(els.search.parentNode).display === 'none') go('/busca');
      else els.search.focus();
    }
  }

  // ── Inicialização ──────────────────────────────────────────────────────────
  async function start() {
    const rootEl = document.getElementById('app');
    try {
      await FC.db.open();
      await FC.settings.load();
      applyTheme(FC.settings.get('theme'));
      await FC.store.load();
      await FC.decks.ensureDefault();
    } catch (e) {
      console.error(e);
      clear(rootEl).appendChild(
        h('div', { class: 'content' }, FC.ui.empty({ icon: 'alert', title: 'Não foi possível abrir o banco local', text: (e && e.message) || String(e) + ' — verifique se o navegador permite armazenamento (modo anônimo pode bloquear).' })),
      );
      return;
    }
    buildLayout();
    FC.db.requestPersistence();
    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', globalKeys);
    FC.store.on('settings', (s) => applyTheme(s.theme));
    const refreshCounts = FC.util.debounce(updateCounts, 300);
    FC.store.on('change', refreshCounts);
    setInterval(updateCounts, 60000);
    updateCounts();
    route();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  Object.assign(app, { go, route, start, applyTheme, updateCounts, parseHash });
  FC.app = app;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof self !== 'undefined' ? self : this);
