/*
 * Aba "Flashcards" do Projeto Residente.
 *
 * O site (React) desenha o menu, o cabeçalho e o tema, e chama
 * FC.app.mount(elemento, opções) na rota /flashcards/*. Aqui ficam: a barra de
 * abas dos flashcards, as rotas internas (/flashcards/decks, /flashcards/revisar…),
 * os atalhos e o início da sincronização com a conta. Cada tela fica em
 * js/ui/*View.js e se registra em FC.views.
 *
 * Endereços: o React é dono da URL. FC.app.go('/decks') pede a navegação ao
 * React (host.navigate) e o React avisa de volta (FC.app.onLocation) — assim o
 * voltar/avançar do navegador funciona igual ao resto do site.
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
    { re: /^\/plataforma\/?$/, view: 'platform', nav: 'platform' },
    { re: /^\/plataforma\/sessao\/?$/, view: 'platformSession', nav: 'platform' },
    { re: /^\/plataforma\/baralho\/([^/]+)\/([^/]+)$/, view: 'platformDeck', nav: 'platform', keys: ['pkg', 'deck'] },
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

  const TABS = [
    { key: 'dashboard', label: 'Início', path: '/' },
    { key: 'review', label: 'Revisar', path: '/revisar', count: 'due' },
    { key: 'quick', label: 'Quick Review', path: '/quick' },
    { key: 'decks', label: 'Decks', path: '/decks' },
    { key: 'platform', label: 'Cards da plataforma', path: '/plataforma' },
    { key: 'generate', label: 'Gerar com IA', path: '/gerar', count: 'drafts' },
    { key: 'import', label: 'Importar', path: '/importar' },
    { key: 'weak', label: 'Pontos fracos', path: '/pontos-fracos' },
    { key: 'stats', label: 'Estatísticas', path: '/estatisticas' },
    { key: 'calendar', label: 'Calendário', path: '/calendario' },
  ];

  const MORE = [
    { key: 'search', label: 'Buscar cards', icon: 'search', path: '/busca' },
    { key: 'favorites', label: 'Favoritos', icon: 'star', path: '/favoritos' },
    { key: 'suspended', label: 'Cards suspensos', icon: 'pause', path: '/suspensos' },
  ];

  const app = {
    state: {},
    current: null,
    cleanup: [],
  };

  let host = {};
  let rootEl = null;
  let els = {};
  let mounted = false;
  let userId = null;
  let bootingFor = null;
  let booting = null;
  let mountSeq = 0;
  let lastRouted = null;
  let savedTitle = null;
  let detach = [];

  // ── Endereços ──────────────────────────────────────────────────────────────
  function currentLocation() {
    const base = FC.config.base;
    let path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : '/';
    if (!path || path === '/index.html') path = '/';
    const query = {};
    new URLSearchParams(location.search).forEach((v, k) => (query[k] = v));
    return { path: decodeURI(path), query, key: location.pathname + location.search };
  }

  /** Vai para uma tela do app: go('/decks'), go('/busca?q=tb'). */
  function go(path, opts = {}) {
    const url = FC.ui.href(path);
    if (url === location.pathname + location.search && !opts.replace) return route();
    if (host.navigate) host.navigate(url, { replace: !!opts.replace });
    else {
      history[opts.replace ? 'replaceState' : 'pushState'](null, '', url);
      route();
    }
  }

  /** O React avisa que a URL mudou (link, voltar/avançar, navegação do app). */
  function onLocation() {
    // Ainda carregando a coleção: a tela certa é desenhada no fim do mount
    if (!mounted || !els.content) return;
    if (currentLocation().key !== lastRouted) route();
  }

  function route() {
    if (!mounted || !els.content) return;
    const { path, query, key } = currentLocation();
    lastRouted = key;
    let match = null;
    const params = {};
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (m) {
        match = r;
        (r.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        break;
      }
    }
    if (!match) return go('/', { replace: true });
    runCleanup();
    FC.ui.closeMenus();
    document.body.classList.remove('fc-focus-mode');
    setActiveNav(match.nav);
    const view = FC.views[match.view];
    clear(els.content);
    window.scrollTo(0, 0);
    app.current = match.view;
    const ctx = {
      el: els.content,
      params,
      query,
      setTitle(t) {
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
    if (!inSession()) FC.sync.resume();
  }

  function runCleanup() {
    for (const fn of app.cleanup) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    app.cleanup = [];
  }

  function showViewError(e) {
    console.error(e);
    clear(els.content).appendChild(FC.ui.empty({ icon: 'alert', title: 'Algo deu errado nesta tela', text: e && e.message ? e.message : String(e), actions: [FC.ui.link('Voltar ao início', '#/')] }));
  }

  function setActiveNav(key) {
    rootEl.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const active = rootEl.querySelector('.fc-tabs [aria-current="page"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Revisão, Quick Review ou estudo da plataforma em andamento: a sincronização não mexe na tela. */
  function inSession() {
    return mounted && (app.current === 'review' || app.current === 'quickSession' || app.current === 'platformSession');
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  function tab(item) {
    const count = item.count ? h('span', { class: 'count hidden', dataset: { count: item.count } }) : null;
    return h('a', { class: 'fc-tab', href: '#' + item.path, dataset: { nav: item.key } }, h('span', null, item.label), count);
  }

  function buildLayout() {
    const search = h('input', { type: 'search', class: 'fc-search-input', placeholder: 'Buscar cards (tecla /)', 'aria-label': 'Buscar cards' });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && search.value.trim()) {
        go('/busca?q=' + encodeURIComponent(search.value.trim()));
        search.blur();
      }
    });
    const syncBtn = h('button', { type: 'button', class: 'fc-sync', onclick: () => FC.sync.now() });
    const more = FC.ui.moreButton(() => {
      const items = MORE.map((m) => ({ label: m.label, icon: m.icon, run: () => go(m.path) })).concat(['-', { label: 'Sincronizar agora', icon: 'refresh', run: () => FC.sync.now() }]);
      // Alternar entre a aba do site e a versão só de flashcards, na mesma tela
      const alt = host.alternate;
      if (alt && host.navigate) {
        items.push({
          label: alt.label,
          icon: 'arrow',
          run: () => {
            const { path } = currentLocation();
            host.navigate(alt.base + (path === '/' ? '' : path) + location.search);
          },
        });
      }
      return items;
    }, 'Mais opções dos flashcards');
    const head = h(
      'div',
      { class: 'fc-head' },
      h(
        'div',
        { class: 'fc-head-row' },
        // Na versão só de flashcards o título já está na barra do app
        host.standalone ? h('div', { class: 'fc-spacer' }) : h('div', { class: 'fc-brand' }, h('span', { class: 'fc-brand-mark' }, icon('layers', 16)), h('span', { text: 'Flashcards' })),
        syncBtn,
        h('div', { class: 'fc-search' }, icon('search', 15), search),
        FC.ui.button('Novo card', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => FC.cardEditor.open({}) }),
        h('a', { class: 'btn ghost icon sm fc-settings', href: '#/configuracoes', title: 'Configurações dos flashcards', 'aria-label': 'Configurações dos flashcards', dataset: { nav: 'settings' } }, icon('settings', 17)),
        more,
      ),
      h('nav', { class: 'fc-tabs', 'aria-label': 'Seções dos flashcards' }, TABS.map(tab)),
    );
    const banner = h('div', { class: 'fc-banners' });
    const content = h('div', { class: 'content', id: 'fc-content', tabindex: '-1' });
    clear(rootEl);
    FC.ui.add(rootEl, head, banner, content);
    els = { content, search, banner, syncBtn };
    renderSync(FC.sync.status());
  }

  function updateCounts() {
    if (!mounted) return;
    // O mesmo número do menu do site e do widget do Início (tudo o que vence hoje + novos)
    const counts = FC.review.counts({});
    const due = counts.dueToday + counts.overdue + counts.newToday;
    for (const el of rootEl.querySelectorAll('[data-count="due"]')) {
      el.textContent = due > 999 ? '999+' : String(due);
      el.classList.toggle('hidden', !due);
    }
    const drafts = FC.store.drafts.length;
    for (const el of rootEl.querySelectorAll('[data-count="drafts"]')) {
      el.textContent = String(drafts);
      el.classList.toggle('hidden', !drafts);
    }
  }

  // ── Sincronização e avisos ─────────────────────────────────────────────────
  function renderSync(st) {
    if (!els.syncBtn) return;
    const btn = els.syncBtn;
    let text = 'Salvo na conta';
    let ic = 'check';
    let cls = 'ok';
    if (st.status === 'syncing') {
      text = 'Sincronizando…';
      ic = 'refresh';
      cls = 'busy';
    } else if (st.status === 'offline') {
      text = st.pending ? 'Offline · ' + st.pending + ' pendente' + (st.pending > 1 ? 's' : '') : 'Offline';
      ic = 'alert';
      cls = 'warn';
    } else if (st.status === 'error') {
      text = 'Não sincronizado';
      ic = 'alert';
      cls = 'crit';
    } else if (st.pending) {
      text = 'Enviando…';
      ic = 'refresh';
      cls = 'busy';
    }
    btn.className = 'fc-sync ' + cls;
    btn.title = (st.error || text) + (st.lastSyncAt ? ' · última sincronização ' + FC.util.formatDateTime(st.lastSyncAt) : '') + '. Clique para sincronizar agora.';
    clear(btn);
    FC.ui.add(btn, icon(ic, 14), h('span', { text }));
    renderBanners(st);
  }

  let legacyInfo = null;

  function renderBanners(st) {
    if (!els.banner) return;
    const box = clear(els.banner);
    if (legacyInfo) {
      const doImport = FC.ui.button('Levar para a minha conta', {
        variant: 'primary',
        size: 'sm',
        onClick: async (e) => {
          const b = e.currentTarget;
          FC.ui.busy(b, true, 'Copiando…');
          try {
            const counts = await FC.legacy.importAll(userId, (msg) => (b.lastChild.textContent = msg));
            legacyInfo = null;
            renderBanners(FC.sync.status());
            FC.ui.toast(FC.util.plural((counts && counts.cards) || 0, 'card levado', 'cards levados') + ' para a sua conta.');
            route();
            FC.sync.now();
          } catch (err) {
            FC.ui.busy(b, false);
            FC.ui.errorToast(err);
          }
        },
      });
      const skip = FC.ui.button('Agora não', {
        variant: 'ghost',
        size: 'sm',
        onClick: async () => {
          await FC.legacy.dismiss();
          legacyInfo = null;
          renderBanners(FC.sync.status());
        },
      });
      box.appendChild(
        h(
          'div',
          { class: 'callout fc-legacy' },
          icon('database', 18),
          h(
            'div',
            { class: 'grow stack tight' },
            h('strong', { text: 'Encontramos flashcards salvos só neste navegador' }),
            h('span', { text: FC.util.plural(legacyInfo.cards, 'card', 'cards') + ' e ' + FC.util.plural(legacyInfo.logs, 'revisão', 'revisões') + ' da versão anterior, que não tinha conta. Leve para a sua conta para ver em todos os aparelhos (nada é apagado deste navegador).' }),
            h('div', { class: 'row tight' }, doImport, skip),
          ),
        ),
      );
    }
    if (st.quotaError) box.appendChild(FC.ui.callout(st.quotaError + ' As alterações novas ficam só neste aparelho. Apague imagens, PDFs ou baralhos que não usa.', 'crit'));
    else if (st.status === 'error' && st.error && /sess/i.test(st.error)) box.appendChild(FC.ui.callout(st.error, 'warn'));
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

  /** Links dentro do app viram navegação do site (sem recarregar a página). */
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target || a.hasAttribute('download')) return;
    if (!rootEl.contains(a) && !FC.ui.portal().contains(a)) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const base = FC.config.base;
    e.preventDefault();
    if (url.pathname === base || url.pathname.startsWith(base + '/')) go((url.pathname.slice(base.length) || '/') + url.search);
    else if (host.navigate) host.navigate(url.pathname + url.search + url.hash);
    else location.href = url.href;
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  function loading(text, fraction) {
    clear(rootEl).appendChild(
      h('div', { class: 'fc-loading panel stack' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { text })), fraction != null ? FC.ui.progressBar(fraction) : null),
    );
  }

  /** Abre a coleção do usuário (uma vez por login). */
  async function boot(id, onProgress) {
    FC.db.use('fc:' + id);
    await FC.db.open();
    FC.sync.configure({ apiBase: FC.config.api });
    const cursor = await FC.db.getMeta('cursor', 0);
    if (!cursor) {
      // Aparelho novo para esta conta: baixa a coleção antes de mostrar
      try {
        await FC.sync.now({ throwErrors: true, onProgress });
      } catch (e) {
        if (!e.offline) console.error(e);
      }
    }
    await FC.settings.load();
    await FC.store.load();
    FC.cards.invalidateIndex();
    await FC.decks.ensureDefault();
    FC.sync.start();
    FC.summary.start();
    if (cursor) FC.sync.now();
    FC.db.requestPersistence();
    userId = id;
  }

  /**
   * Mostra os flashcards dentro de `el`.
   * opts: { userId, navigate(url, {replace}), registerStudy(info), onSummary(summary),
   *         base, api, assets, standalone, alternate: {base, label} }
   */
  async function mount(el, opts) {
    if (mounted) unmount();
    const seq = ++mountSeq;
    host = opts || {};
    FC.host = host;
    ['base', 'api', 'assets'].forEach((k) => host[k] && (FC.config[k] = host[k]));
    rootEl = el;
    el.classList.add('fc-root', 'fc-embedded');
    el.classList.toggle('fc-standalone', !!host.standalone);
    mounted = true;
    savedTitle = document.title;
    if (bootingFor !== host.userId) {
      if (bootingFor) await shutdown({ keepMounted: true });
      if (seq !== mountSeq) return;
      bootingFor = host.userId;
      loading('Carregando seus flashcards…');
      const progress = (received, total) => {
        if (mounted && rootEl && !els.content) loading('Baixando seus flashcards da conta…' + (total ? ' ' + FC.util.fmtNum(Math.min(received, total)) + ' de ' + FC.util.fmtNum(total) : ''), total ? received / total : null);
      };
      booting = boot(host.userId, progress);
    } else if (!userId) loading('Carregando seus flashcards…');
    try {
      await booting;
    } catch (e) {
      console.error(e);
      bootingFor = null;
      if (seq === mountSeq && mounted) clear(el).appendChild(FC.ui.empty({ icon: 'alert', title: 'Não foi possível abrir os flashcards', text: ((e && e.message) || String(e)) + ' — verifique se o navegador permite armazenamento (o modo anônimo pode bloquear).' }));
      return;
    }
    // Saiu da aba (ou montou de novo) enquanto carregava
    if (seq !== mountSeq || !mounted) return;

    buildLayout();
    const on = (target, type, fn, capture) => {
      target.addEventListener(type, fn, capture);
      detach.push(() => target.removeEventListener(type, fn, capture));
    };
    on(document, 'keydown', globalKeys);
    on(document, 'click', onClick);
    detach.push(FC.store.on('change', FC.util.debounce(updateCounts, 300)));
    detach.push(FC.store.on('settings', FC.util.debounce(updateCounts, 300)));
    detach.push(FC.store.on('sync', renderSync));
    const timer = setInterval(updateCounts, 60000);
    detach.push(() => clearInterval(timer));
    updateCounts();
    // Endereços antigos: /flashcards/index.html#/decks → /flashcards/decks
    if (/^#\//.test(location.hash)) go(location.hash.slice(1), { replace: true });
    else if (/\/index\.html$/.test(location.pathname)) go('/', { replace: true });
    else route();
    FC.legacy.check().then((info) => {
      if (!mounted || !info) return;
      legacyInfo = info;
      renderBanners(FC.sync.status());
    });
  }

  /** Sai da aba (a sincronização continua em segundo plano). */
  function unmount() {
    if (!mounted) return;
    mountSeq++;
    runCleanup();
    for (const fn of detach) fn();
    detach = [];
    FC.ui.destroyPortal();
    document.body.classList.remove('fc-focus-mode');
    if (savedTitle != null) document.title = savedTitle;
    if (rootEl) {
      clear(rootEl);
      rootEl.classList.remove('fc-root', 'fc-embedded', 'fc-standalone');
    }
    mounted = false;
    app.current = null;
    lastRouted = null;
    els = {};
    rootEl = null;
    FC.sync.resume();
  }

  /**
   * Encerra a coleção do usuário (sair da conta). Envia o que faltar; com
   * clearLocal apaga a cópia deste aparelho se tudo já estiver na conta.
   * Devolve true se a cópia local foi apagada.
   */
  async function shutdown(opts = {}) {
    if (!opts.keepMounted) unmount();
    const id = userId || bootingFor;
    if (booting) await booting.catch(() => {});
    userId = null;
    bootingFor = null;
    booting = null;
    legacyInfo = null;
    FC.summary.stop();
    if (!id) return false;
    let pending = -1;
    if (!opts.skipFlush) {
      try {
        pending = await FC.sync.flush();
      } catch (e) {
        /* offline: o que faltou fica guardado neste aparelho */
      }
    }
    FC.sync.stop();
    const reset = await FC.db.getMeta('pendingReset', false).catch(() => true);
    FC.db.use(null);
    FC.store.loaded = false;
    FC.store.cards = new Map();
    FC.store.nodes = new Map();
    FC.store.decks = new Map();
    FC.store.logs = [];
    FC.store.reindexLogs();
    FC.store.drafts = [];
    FC.store.sessions = [];
    FC.store.quickSessions = [];
    FC.store.sources = new Map();
    FC.ui.forgetMedia();
    if (opts.clearLocal && pending === 0 && !reset) return FC.db.deleteDatabase('fc:' + id);
    return false;
  }

  Object.assign(app, { go, route, mount, unmount, shutdown, onLocation, updateCounts, inSession, currentLocation, userId: () => userId });
  FC.app = app;
})(typeof self !== 'undefined' ? self : globalThis);
