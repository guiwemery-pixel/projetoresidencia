/*
 * Atalhos para iniciar sessões a partir de qualquer lugar (tema, baralho, tag,
 * ponto fraco, busca): revisão normal (só os devidos) ou Quick Review (todos).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button } = FC.ui;
  const U = FC.util;

  function filterToQuery(filter, label) {
    const q = new URLSearchParams();
    if (filter.deckIds && filter.deckIds.length) q.set('deck', filter.deckIds.join(','));
    if (filter.nodeIds && filter.nodeIds.length) q.set('node', filter.nodeIds.join(','));
    if (filter.tags && filter.tags.length) q.set('tag', filter.tags.join(','));
    if (filter.favorites) q.set('fav', '1');
    if (label) q.set('label', label);
    return q.toString();
  }

  function queryToFilter(query) {
    const f = {};
    if (query.deck) f.deckIds = query.deck.split(',').filter(Boolean);
    if (query.node) f.nodeIds = query.node.split(',').filter(Boolean);
    if (query.tag) f.tags = query.tag.split(',').filter(Boolean);
    if (query.fav) f.favorites = true;
    return f;
  }

  function review(filter, label) {
    const qs = filterToQuery(filter || {}, label);
    FC.app.go('/revisar' + (qs ? '?' + qs : ''));
  }

  function order(cards, mode) {
    if (mode === 'hierarchy') return cards.slice().sort((a, b) => FC.areas.breadcrumb(a.nodeId).localeCompare(FC.areas.breadcrumb(b.nodeId), 'pt-BR') || a.createdAt - b.createdAt);
    if (mode === 'hardest') {
      const now = Date.now();
      const score = (c) => FC.performance.cardPriority(c, FC.performance.cardReport(c, FC.store.cardLogs(c.id), now));
      return cards.map((c) => [c, score(c)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    }
    return U.shuffle(cards);
  }

  function quick(filter, label, mode) {
    const cards = FC.cards.select(Object.assign({ includeBlockedDecks: true }, filter || {}));
    if (!cards.length) return FC.ui.toast('Nenhum card nessa seleção.', { error: true });
    quickIds(order(cards, mode || 'random').map((c) => c.id), label, filter);
  }

  function quickIds(ids, label, filter) {
    if (!ids.length) return FC.ui.toast('Nenhum card selecionado.', { error: true });
    FC.app.state.pendingQuick = { cardIds: ids, label: label || 'Quick Review', filter: filter || null };
    FC.app.go('/quick/sessao');
  }

  /** Diálogo "Como quer estudar?" com as contagens de cada modo. */
  function choose(filter, label) {
    const counts = FC.review.counts(filter);
    const all = FC.cards.select(Object.assign({ includeBlockedDecks: true }, filter)).length;
    const due = counts.dueNow + counts.newToday;
    const content = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'ink2', text: label }),
      h(
        'div',
        { class: 'grid two' },
        h(
          'div',
          { class: 'panel flat stack' },
          h('h3', { text: 'Revisão normal' }),
          h('p', { class: 'small ink2', text: U.plural(counts.dueNow, 'card devido', 'cards devidos') + ' e ' + U.plural(counts.newToday, 'novo', 'novos') + ' hoje. Segue o agendamento.' }),
          button(due ? 'Revisar ' + due : 'Nada devido agora', { variant: 'primary', icon: 'play', disabled: !due, onClick: () => (m.close(), review(filter, label)) }),
        ),
        h(
          'div',
          { class: 'panel flat stack' },
          h('h3', { text: 'Quick Review' }),
          h('p', { class: 'small ink2', text: 'Todos os ' + U.plural(all, 'card', 'cards') + ', vencidos ou não. Não altera o agendamento.' }),
          button('Quick Review', { icon: 'zap', disabled: !all, onClick: () => (m.close(), quick(filter, 'Quick Review · ' + label)) }),
        ),
      ),
    );
    const m = FC.ui.modal({ title: 'Como quer estudar?', content });
  }

  FC.launch = { filterToQuery, queryToFilter, review, quick, quickIds, choose, order };
})(typeof self !== 'undefined' ? self : this);
