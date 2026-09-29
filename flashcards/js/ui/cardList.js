/*
 * Lista de cards reutilizável (busca, baralhos, temas, favoritos, suspensos,
 * pontos fracos): seleção múltipla e ações em lote (mover, tags, suspender,
 * favoritar, excluir, estudar só os selecionados, exportar).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon } = FC.ui;
  const U = FC.util;
  const PAGE = 50;

  /**
   * opts: { cards: [] | () => [], emptyText, extra(card) → elemento extra na linha,
   *         label: nome para sessões, sort }
   * Retorna { el, refresh() }
   */
  function create(opts) {
    const selected = new Set();
    let shown = PAGE;
    const wrap = h('div', { class: 'stack' });
    const bar = h('div', { class: 'row panel flat hidden', style: { padding: '10px 12px', position: 'sticky', top: '64px', zIndex: '5' } });
    const list = h('div', { class: 'list' });
    const moreBtn = button('Mostrar mais', { variant: 'ghost', onClick: () => ((shown += PAGE), render()) });
    FC.ui.add(wrap, bar, list, moreBtn);

    const getCards = () => (typeof opts.cards === 'function' ? opts.cards() : opts.cards);

    function renderBar(cards) {
      FC.ui.clear(bar);
      // "Selecionar todos" sempre à mostra: marca todos os cards da lista (não só os da página)
      bar.classList.toggle('hidden', !cards.length);
      if (!cards.length) return;
      const ids = [...selected];
      bar.style.position = ids.length ? 'sticky' : 'static';
      const all = h('input', { type: 'checkbox', 'aria-label': 'Selecionar todos os ' + cards.length + ' cards' });
      all.checked = ids.length > 0 && ids.length >= cards.length;
      all.indeterminate = ids.length > 0 && ids.length < cards.length;
      all.addEventListener('change', () => {
        if (all.checked) cards.forEach((c) => selected.add(c.id));
        else selected.clear();
        render();
      });
      FC.ui.add(bar, h('label', { class: 'row tight select-all' }, all, ids.length ? h('strong', { text: U.plural(ids.length, 'selecionado', 'selecionados') + (ids.length < cards.length ? ' de ' + U.fmtNum(cards.length) : '') }) : h('span', { text: 'Selecionar todos (' + U.fmtNum(cards.length) + ')' })));
      if (!ids.length) return;
      FC.ui.add(bar,
        ids.length < cards.length ? button('Todos (' + U.fmtNum(cards.length) + ')', { size: 'sm', variant: 'ghost', onClick: () => (cards.forEach((c) => selected.add(c.id)), render()) }) : null,
        button('Limpar', { size: 'sm', variant: 'ghost', onClick: () => (selected.clear(), render()) }),
        h('span', { class: 'grow' }),
        button('Quick Review', { size: 'sm', icon: 'zap', onClick: () => FC.launch.quickIds(ids, (opts.label || 'Seleção') + ' · selecionados') }),
        button('Mover', { size: 'sm', icon: 'folder', onClick: () => moveDialog(ids, () => (selected.clear(), render())) }),
        FC.ui.moreButton(() => [
          { label: 'Adicionar tag', icon: 'tag', run: async () => { const t = await FC.ui.prompt('Adicionar tag', '', { label: 'Tags (separadas por espaço)', list: FC.cards.allTags().map((x) => x.tag) }); if (t) { await FC.cards.addTags(ids, t); FC.ui.toast('Tags adicionadas.'); render(); } } },
          { label: 'Favoritar', icon: 'star', run: async () => { await FC.cards.setFavorite(ids, true); render(); } },
          { label: 'Tirar dos favoritos', icon: 'star', run: async () => { await FC.cards.setFavorite(ids, false); render(); } },
          { label: 'Suspender', icon: 'pause', run: async () => { await FC.cards.setSuspended(ids, true); FC.ui.toast('Cards suspensos.'); render(); } },
          { label: 'Reativar', icon: 'play', run: async () => { await FC.cards.setSuspended(ids, false); FC.ui.toast('Cards reativados.'); render(); } },
          { label: 'Exportar selecionados', icon: 'download', run: () => FC.importView.exportDialog({ cardIds: ids, label: 'selecionados' }) },
          '-',
          { label: 'Excluir', icon: 'trash', danger: true, run: async () => { if (!(await FC.ui.confirm('Excluir ' + U.plural(ids.length, 'card', 'cards') + '? Eles vão para a lixeira (com o histórico) e podem ser restaurados por ' + FC.trash.KEEP_DAYS + ' dias.', { danger: true, okText: 'Excluir' }))) return; const batch = await FC.cards.remove(ids); selected.clear(); FC.trashView.toast(U.plural(ids.length, 'card excluído', 'cards excluídos') + '.', batch); render(); } },
        ]),
      );
    }

    function row(card) {
      const check = h('input', { type: 'checkbox', checked: selected.has(card.id), 'aria-label': 'Selecionar card' });
      check.addEventListener('change', () => {
        if (check.checked) selected.add(card.id);
        else selected.delete(card.id);
        renderBar(getCards());
      });
      const deck = FC.decks.get(card.deckId);
      const fav = h('button', { type: 'button', class: 'btn ghost icon sm', title: card.favorite ? 'Tirar dos favoritos' : 'Favoritar', 'aria-pressed': String(!!card.favorite) }, FC.ui.starIcon(card.favorite, 16));
      fav.addEventListener('click', async () => {
        await FC.cards.setFavorite(card.id, !card.favorite);
        render();
      });
      return h(
        'div',
        { class: 'card-row' },
        h('div', { style: { paddingTop: '3px' } }, check),
        h(
          'div',
          { style: { minWidth: 0, cursor: 'pointer' }, onclick: () => FC.cardDetail.open(card.id) },
          h('div', { class: 'q clamp-2', text: FC.ui.plain(card.front, 300) || '(imagem)' }),
          h('div', { class: 'a clamp-2', text: FC.ui.plain(card.back, 300) }),
          h(
            'div',
            { class: 'meta' },
            FC.ui.stateBadge(card),
            FC.ui.diffBadge(card.estDifficulty),
            FC.ui.crumb(card.nodeId),
            deck ? h('span', { class: 'crumb', text: '· ' + deck.name.split('::').pop() }) : null,
            (card.tags || []).slice(0, 4).map((t) => h('span', { class: 'tag', text: '#' + t })),
            opts.extra ? opts.extra(card) : null,
          ),
        ),
        h(
          'div',
          { class: 'row tight nowrap-row' },
          fav,
          FC.ui.moreButton(() => [
            { label: 'Ver detalhes', icon: 'eye', run: () => FC.cardDetail.open(card.id) },
            { label: 'Editar', icon: 'edit', run: () => FC.cardEditor.open({ card }).then(render) },
            { label: card.suspended ? 'Reativar' : 'Suspender', icon: 'pause', run: async () => { await FC.cards.setSuspended(card.id, !card.suspended); render(); } },
            { label: 'Duplicar', icon: 'copy', run: async () => { await FC.cards.duplicate(card.id); FC.ui.toast('Cópia criada.'); render(); } },
            { label: 'Mover', icon: 'folder', run: () => moveDialog([card.id], render) },
            '-',
            { label: 'Excluir', icon: 'trash', danger: true, run: async () => { const batch = await FC.cards.remove(card.id); FC.trashView.toast('Card excluído.', batch); render(); } },
          ]),
        ),
      );
    }

    function render() {
      const cards = getCards();
      for (const id of [...selected]) if (!FC.store.cards.has(id)) selected.delete(id);
      FC.ui.clear(list);
      if (!cards.length) {
        list.appendChild(h('p', { class: 'muted', style: { padding: '12px 4px' }, text: opts.emptyText || 'Nenhum card.' }));
      } else {
        for (const c of cards.slice(0, shown)) list.appendChild(row(c));
      }
      moreBtn.classList.toggle('hidden', cards.length <= shown);
      moreBtn.querySelector('span').textContent = 'Mostrar mais (' + (cards.length - shown) + ' restantes)';
      renderBar(cards);
    }

    render();
    return { el: wrap, refresh: render, selected };
  }

  /** Mover cards para outro baralho e/ou outra classificação. */
  function moveDialog(ids, done) {
    const first = FC.cards.get(ids[0]);
    const deck = FC.ui.deckSelect(first ? first.deckId : null, { allowNew: true });
    const keepDeck = FC.ui.checkbox('Mudar o baralho', false);
    const keepPath = FC.ui.checkbox('Mudar a classificação', false);
    const picker = FC.ui.pathPicker(first ? FC.areas.pathNames(first.nodeId) : []);
    const content = h('div', { class: 'stack loose' }, h('p', { class: 'ink2', text: U.plural(ids.length, 'card', 'cards') + ' serão movidos.' }), keepDeck.el, deck, keepPath.el, picker.el);
    const m = FC.ui.modal({
      title: 'Mover cards',
      size: 'wide',
      content,
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Mover', {
          variant: 'primary',
          onClick: async () => {
            const target = {};
            if (keepDeck.input.checked && deck.value !== '__new__') target.deckId = deck.value;
            if (keepPath.input.checked) target.path = picker.get();
            if (!target.deckId && !target.path) return FC.ui.toast('Marque o que deseja mudar.', { error: true });
            await FC.cards.move(ids, target);
            m.close();
            FC.ui.toast('Cards movidos.');
            if (done) done();
          },
        }),
      ],
    });
    deck.addEventListener('change', () => (keepDeck.input.checked = true));
    picker.inputs.forEach((i) => i.addEventListener('input', () => (keepPath.input.checked = true)));
  }

  FC.cardList = { create, moveDialog };
  void icon;
})(typeof self !== 'undefined' ? self : globalThis);
