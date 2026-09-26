/*
 * Busca global (pergunta, resposta, área, subárea, assunto, tema, baralho, tag,
 * fonte), Favoritos e Cards suspensos.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, link } = FC.ui;
  const U = FC.util;

  FC.views.search = {
    title: 'Busca',
    render(ctx) {
      const { el, query } = ctx;
      const state = { q: query.q || '', tag: query.tag || '', deck: '', status: 'all' };
      const input = h('input', { class: 'input', type: 'search', value: state.q, placeholder: 'Ex.: acalasia, Borrmann, #ENARE, tratamento…', 'aria-label': 'Buscar', style: { fontSize: '1.05rem', minHeight: '46px' } });
      const deck = FC.ui.deckSelect('', { allowAll: true, includeArchived: true });
      const tags = FC.cards.allTags();
      const tagSel = FC.ui.select([{ value: '', label: 'Todas as tags' }].concat(tags.map((t) => ({ value: t.tag, label: '#' + t.tag + ' (' + t.count + ')' }))), state.tag);
      const status = FC.ui.select(
        [
          { value: 'all', label: 'Todos (inclui suspensos)' },
          { value: 'active', label: 'Ativos' },
          { value: 'new', label: 'Novos' },
          { value: 'due', label: 'Vencidos' },
          { value: 'fav', label: 'Favoritos' },
          { value: 'suspended', label: 'Suspensos' },
        ],
        state.status,
      );
      const info = h('p', { class: 'small ink2' });
      const results = () => {
        let q = state.q.trim();
        const hashTags = [];
        q = q.replace(/#([^\s#]+)/g, (m, t) => (hashTags.push(t), '')).trim();
        const filter = { query: q, tags: hashTags.concat(state.tag ? [state.tag] : []), deckIds: state.deck ? [state.deck] : null, suspended: state.status === 'suspended' ? 'only' : state.status === 'all' ? 'include' : 'exclude', includeBlockedDecks: true, favorites: state.status === 'fav' };
        if (state.status === 'new') filter.state = 'new';
        let list = FC.cards.select(filter);
        if (state.status === 'due') {
          const now = Date.now();
          list = list.filter((c) => c.state && c.state !== 'new' && c.dueDate <= now);
        }
        return list;
      };
      const listBox = h('div');
      let list = null;
      const run = () => {
        const has = state.q.trim() || state.tag || state.deck || state.status !== 'all';
        const found = has ? results() : [];
        info.textContent = has ? U.plural(found.length, 'card encontrado', 'cards encontrados') : 'Digite algo para buscar em ' + U.plural(FC.store.cards.size, 'card', 'cards') + '.';
        FC.ui.clear(listBox);
        if (!has) return;
        list = FC.cardList.create({ cards: () => results(), label: 'Busca: ' + (state.q || state.tag || 'filtro'), emptyText: 'Nada encontrado.' });
        listBox.appendChild(list.el);
        actions.classList.toggle('hidden', !found.length);
      };
      const debounced = U.debounce(() => {
        state.q = input.value;
        run();
      }, 200);
      input.addEventListener('input', debounced);
      deck.addEventListener('change', () => ((state.deck = deck.value), run()));
      tagSel.addEventListener('change', () => ((state.tag = tagSel.value), run()));
      status.addEventListener('change', () => ((state.status = status.value), run()));
      const actions = h(
        'div',
        { class: 'row hidden' },
        button('Quick Review dos resultados', { icon: 'zap', onClick: () => FC.launch.quickIds(U.shuffle(results().map((c) => c.id)), 'Busca: ' + (state.q || state.tag)) }),
        button('Exportar resultados', { icon: 'download', variant: 'ghost', onClick: () => FC.importView.exportDialog({ cardIds: results().map((c) => c.id), label: 'busca' }) }),
      );
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Busca' }), h('p', { text: 'Procura na pergunta, resposta, área, subárea, assunto, tema, baralho, tags e fonte. Use #tag para filtrar por tag.' }))),
        h('section', { class: 'panel stack', style: { marginBottom: '16px' } }, input, h('div', { class: 'grid three' }, deck, tagSel, status), h('div', { class: 'row between' }, info, actions)),
        h('section', { class: 'panel' }, listBox),
      );
      run();
      setTimeout(() => input.focus(), 30);
    },
  };

  function simpleList(ctx, opts) {
    const { el } = ctx;
    const count = () => opts.cards().length;
    const head = h('div', { class: 'page-head' }, h('div', null, h('h1', { text: opts.title }), h('p', { text: opts.subtitle })), h('div', { class: 'row' }, opts.actions ? opts.actions() : null));
    const list = FC.cardList.create({ cards: opts.cards, label: opts.title, emptyText: opts.empty });
    FC.ui.add(el, head, h('section', { class: 'panel' }, count() ? list.el : FC.ui.empty({ icon: opts.icon, title: opts.empty, text: opts.emptyText })));
    ctx.on('cards', U.debounce(() => ctx.rerender(), 300));
  }

  FC.views.favorites = {
    title: 'Favoritos',
    render(ctx) {
      simpleList(ctx, {
        title: 'Meus favoritos',
        subtitle: 'Cards marcados com estrela.',
        icon: 'star',
        cards: () => FC.cards.select({ favorites: true, suspended: 'include', includeBlockedDecks: true }),
        empty: 'Nenhum favorito ainda',
        emptyText: 'Marque a estrela de um card (na revisão, na busca ou nas listas) para encontrá-lo aqui.',
        actions: () => (FC.cards.select({ favorites: true }).length ? [button('Quick Review', { icon: 'zap', variant: 'primary', onClick: () => FC.launch.quick({ favorites: true }, 'Quick Review · Favoritos') }), button('Revisão normal', { icon: 'play', onClick: () => FC.launch.review({ favorites: true }, 'Favoritos') })] : null),
      });
    },
  };

  FC.views.suspended = {
    title: 'Cards suspensos',
    render(ctx) {
      simpleList(ctx, {
        title: 'Cards suspensos',
        subtitle: 'Não aparecem na revisão normal. Selecione e use "Reativar" para voltar a estudá-los.',
        icon: 'pause',
        cards: () => FC.cards.select({ suspended: 'only', includeBlockedDecks: true }),
        empty: 'Nenhum card suspenso',
        emptyText: 'Suspenda um card na revisão (link "Suspender") ou nas listas para tirá-lo temporariamente da revisão.',
        actions: () => {
          const ids = FC.cards.select({ suspended: 'only', includeBlockedDecks: true }).map((c) => c.id);
          return ids.length ? [button('Reativar todos', { icon: 'play', onClick: async () => { await FC.cards.setSuspended(ids, false); FC.ui.toast(U.plural(ids.length, 'card reativado', 'cards reativados') + '.'); } })] : null;
        },
      });
      const blocked = FC.decks.all().filter((d) => d.suspended || d.archived);
      if (blocked.length) ctx.el.appendChild(h('p', { class: 'small ink2', style: { marginTop: '12px' } }, 'Baralhos suspensos ou arquivados (também fora da revisão normal): ', blocked.map((d, i) => [i ? ', ' : '', h('a', { href: '#/decks/baralho/' + d.id, text: d.name })])));
    },
  };
  void link;
})(typeof self !== 'undefined' ? self : this);
