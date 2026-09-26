/*
 * Decks: a hierarquia de conteúdo (Grande área → Subárea → Assunto → Tema →
 * Subtema) e os baralhos. Criar, renomear, mover, juntar, excluir, arquivar,
 * suspender, duplicar, exportar e estudar qualquer nível.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  const expanded = new Set();
  let activeTab = 'content';

  function nodeCounts() {
    const now = Date.now();
    const map = new Map();
    const blocked = FC.decks.blockedIds();
    const add = (id, card) => {
      if (!map.has(id)) map.set(id, { total: 0, due: 0, fresh: 0 });
      const c = map.get(id);
      c.total++;
      if (card.suspended || blocked.has(card.deckId)) return;
      if (!card.state || card.state === 'new') c.fresh++;
      else if (card.dueDate != null && card.dueDate <= now) c.due++;
    };
    for (const card of FC.store.cards.values()) {
      const path = FC.areas.path(card.nodeId);
      if (!path.length) add('__none__', card);
      for (const n of path) add(n.id, card);
    }
    return map;
  }

  // ── Ações de nó ────────────────────────────────────────────────────────────
  async function renameNode(node) {
    const name = await FC.ui.prompt('Renomear ' + FC.areas.LEVEL_LABELS[node.level].toLowerCase(), node.name, { hint: 'Se já existir um item com esse nome no mesmo lugar, os dois serão juntados.' });
    if (name && name !== node.name) {
      await FC.areas.rename(node.id, name);
      FC.ui.toast('Renomeado.');
    }
  }

  function moveNode(node, done) {
    if (node.level === 0) return FC.ui.toast('Grandes áreas ficam na raiz.', { error: true });
    const options = [...FC.store.nodes.values()].filter((n) => n.level === node.level - 1 && n.id !== node.parentId).map((n) => ({ value: n.id, label: FC.areas.breadcrumb(n.id) }));
    if (!options.length) return FC.ui.toast('Não há outro destino do nível ' + FC.areas.LEVEL_LABELS[node.level - 1] + '.', { error: true });
    options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    const sel = FC.ui.select(options, options[0].value);
    const m = FC.ui.modal({
      title: 'Mover "' + node.name + '"',
      size: 'narrow',
      content: h('div', { class: 'stack' }, FC.ui.field('Para dentro de (' + FC.areas.LEVEL_LABELS[node.level - 1] + ')', sel), h('p', { class: 'hint', text: 'Os cards e os níveis abaixo vão junto.' })),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Mover', {
          variant: 'primary',
          onClick: async () => {
            try {
              await FC.areas.move(node.id, sel.value);
              m.close();
              FC.ui.toast('Movido.');
              if (done) done();
            } catch (e) {
              FC.ui.errorToast(e);
            }
          },
        }),
      ],
    });
  }

  function mergeNode(node) {
    const options = [...FC.store.nodes.values()].filter((n) => n.level === node.level && n.id !== node.id).map((n) => ({ value: n.id, label: FC.areas.breadcrumb(n.id) }));
    if (!options.length) return FC.ui.toast('Não há outro item do mesmo nível para juntar.', { error: true });
    options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    const sel = FC.ui.select(options, options[0].value);
    const m = FC.ui.modal({
      title: 'Juntar "' + node.name + '" com…',
      size: 'narrow',
      content: h('div', { class: 'stack' }, FC.ui.field('Destino', sel), h('p', { class: 'hint', text: 'Cards e subníveis passam para o destino e "' + node.name + '" deixa de existir.' })),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Juntar', {
          variant: 'primary',
          onClick: async () => {
            await FC.areas.merge(node.id, sel.value);
            m.close();
            FC.ui.toast('Juntado.');
          },
        }),
      ],
    });
  }

  function deleteNode(node, after) {
    const count = FC.areas.cardsIn(node.id).length;
    const mode = FC.ui.select(
      [
        { value: 'parent', label: node.parentId ? 'Manter os cards em "' + FC.areas.get(node.parentId).name + '"' : 'Manter os cards, sem classificação' },
        { value: 'delete', label: 'Excluir também os ' + count + ' cards' },
      ],
      'parent',
    );
    const m = FC.ui.modal({
      title: 'Excluir "' + node.name + '"',
      size: 'narrow',
      content: h('div', { class: 'stack' }, h('p', { class: 'ink2', text: 'Remove este item e tudo o que está abaixo dele na hierarquia (' + U.plural(count, 'card', 'cards') + ').' }), count ? mode : null),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Excluir', {
          variant: 'danger',
          onClick: async () => {
            await FC.areas.remove(node.id, count ? mode.value : 'parent');
            m.close();
            FC.ui.toast('Excluído.');
            if (after) after();
          },
        }),
      ],
    });
  }

  function nodeMenu(node, refresh) {
    return [
      { label: 'Ver cards', icon: 'list', run: () => FC.app.go('/decks/no/' + node.id) },
      { label: 'Novo card aqui', icon: 'plus', run: () => FC.cardEditor.open({ nodeId: node.id }) },
      node.level < 4 ? { label: 'Novo ' + FC.areas.LEVEL_LABELS[node.level + 1].toLowerCase() + ' aqui', icon: 'folder', run: async () => { const name = await FC.ui.prompt('Novo ' + FC.areas.LEVEL_LABELS[node.level + 1].toLowerCase(), ''); if (name) { await FC.areas.create(name, node.id); expanded.add(node.id); refresh(); } } } : null,
      { label: 'Desempenho e pontos fracos', icon: 'target', run: () => FC.app.go('/pontos-fracos/' + node.id) },
      { label: 'Exportar', icon: 'download', run: () => FC.importView.exportDialog({ nodeId: node.id, label: node.name }) },
      '-',
      { label: 'Renomear', icon: 'edit', run: () => renameNode(node) },
      node.level > 0 ? { label: 'Mover', icon: 'folder', run: () => moveNode(node, refresh) } : null,
      { label: 'Juntar com…', icon: 'layers', run: () => mergeNode(node) },
      { label: 'Excluir', icon: 'trash', danger: true, run: () => deleteNode(node) },
    ];
  }

  // ── Árvore de conteúdo ─────────────────────────────────────────────────────
  function contentTree(refresh) {
    const counts = nodeCounts();
    const { aggs } = FC.analysis.context();
    const box = h('div', { class: 'tree' });
    const drawLevel = (parentId, depth) => {
      for (const node of FC.areas.children(parentId)) {
        const c = counts.get(node.id) || { total: 0, due: 0, fresh: 0 };
        const kids = FC.areas.children(node.id);
        const open = expanded.has(node.id);
        const agg = aggs.get(node.id);
        const acc = agg && agg.n ? agg.accuracy : null;
        const twisty = kids.length
          ? h('button', { type: 'button', class: 'twisty', 'aria-expanded': String(open), 'aria-label': open ? 'Recolher' : 'Expandir', onclick: () => (open ? expanded.delete(node.id) : expanded.add(node.id), refresh()) }, icon('right', 16))
          : h('span', { class: 'twisty', 'aria-hidden': 'true' });
        box.appendChild(
          h(
            'div',
            { class: 'tree-row' + (agg && agg.isWeak ? ' perf-weak' : '') },
            h('div', { class: 'tree-name', style: { paddingLeft: depth * 18 + 'px' } }, twisty, h('button', { type: 'button', class: 'label-btn', text: node.name, onclick: () => FC.app.go('/decks/no/' + node.id) }), h('span', { class: 'tree-level', text: FC.areas.LEVEL_LABELS[node.level] }), agg && agg.isWeak ? h('span', { class: 'badge serious', text: 'ponto fraco' }) : null),
            h(
              'div',
              { class: 'tree-stats' },
              h('span', { class: 'hide-sm', title: 'Cards', text: U.plural(c.total, 'card', 'cards') }),
              c.due || c.fresh ? h('span', { class: 'badge accent', title: 'Devidos + novos', text: U.fmtNum(c.due) + ' + ' + U.fmtNum(c.fresh) }) : null,
              h('span', { class: 'perf', title: acc != null ? 'Acerto: ' + U.pct(acc) + ' em ' + agg.n + ' revisões' : 'Sem revisões' }, h('span', { class: 'bar-cell' }, h('span', { style: { width: Math.round((acc || 0) * 100) + '%' } })), h('span', { text: acc != null ? U.pct(acc) : '—' })),
              button('', { icon: 'play', size: 'sm', variant: 'ghost', title: 'Estudar', onClick: () => FC.launch.choose({ nodeIds: [node.id] }, FC.areas.breadcrumb(node.id)) }),
              FC.ui.moreButton(() => nodeMenu(node, refresh)),
            ),
          ),
        );
        if (open) drawLevel(node.id, depth + 1);
      }
    };
    drawLevel(null, 0);
    const none = counts.get('__none__');
    if (none) {
      box.appendChild(
        h(
          'div',
          { class: 'tree-row' },
          h('div', { class: 'tree-name' }, h('span', { class: 'twisty' }), h('button', { type: 'button', class: 'label-btn muted', text: 'Sem classificação', onclick: () => FC.app.go('/decks/no/__none__') })),
          h('div', { class: 'tree-stats' }, h('span', { text: U.plural(none.total, 'card', 'cards') })),
        ),
      );
    }
    if (!box.childNodes.length) return h('p', { class: 'muted', text: 'Nenhuma área ainda. Ao criar, importar ou gerar cards, a hierarquia aparece aqui.' });
    return box;
  }

  // ── Baralhos ───────────────────────────────────────────────────────────────
  function deckMenu(deck, refresh) {
    return [
      { label: 'Ver cards', icon: 'list', run: () => FC.app.go('/decks/baralho/' + deck.id) },
      { label: 'Quick Review', icon: 'zap', run: () => FC.launch.quick({ deckIds: [deck.id] }, 'Quick Review · ' + deck.name) },
      { label: 'Novo card neste baralho', icon: 'plus', run: () => FC.cardEditor.open({ deckId: deck.id }) },
      { label: 'Importar para este baralho', icon: 'upload', run: () => FC.app.go('/importar?deck=' + deck.id) },
      { label: 'Exportar', icon: 'download', run: () => FC.importView.exportDialog({ deckId: deck.id, label: deck.name }) },
      '-',
      { label: 'Renomear', icon: 'edit', run: async () => { const name = await FC.ui.prompt('Renomear baralho', deck.name, { hint: 'Use "::" para sub-baralhos (ex.: Cirurgia::Esôfago).' }); if (name) { try { await FC.decks.rename(deck.id, name); refresh(); } catch (e) { FC.ui.errorToast(e); } } } },
      { label: 'Duplicar', icon: 'copy', run: async () => { const c = await FC.decks.duplicate(deck.id); FC.ui.toast('Criado "' + c.name + '".'); refresh(); } },
      { label: deck.archived ? 'Desarquivar' : 'Arquivar', icon: 'folder', run: async () => { await FC.decks.update(deck.id, { archived: !deck.archived }); FC.ui.toast(deck.archived ? 'Baralho arquivado (fora da revisão normal).' : 'Baralho desarquivado.'); refresh(); } },
      { label: deck.suspended ? 'Reativar baralho' : 'Suspender baralho', icon: 'pause', run: async () => { await FC.decks.update(deck.id, { suspended: !deck.suspended }); refresh(); } },
      { label: 'Excluir', icon: 'trash', danger: true, run: () => deleteDeck(deck, refresh) },
    ];
  }

  function deleteDeck(deck, refresh) {
    const cards = FC.decks.cardsIn(deck.id);
    const others = FC.decks.all().filter((d) => !FC.decks.descendantIds(deck.id).has(d.id));
    const mode = FC.ui.select([{ value: 'delete', label: 'Excluir também os ' + cards.length + ' cards' }].concat(others.map((d) => ({ value: d.id, label: 'Mover os cards para "' + d.name + '"' }))), others.length ? others[0].id : 'delete');
    const m = FC.ui.modal({
      title: 'Excluir baralho "' + deck.name + '"',
      size: 'narrow',
      content: h('div', { class: 'stack' }, h('p', { class: 'ink2', text: 'Inclui os sub-baralhos. ' + U.plural(cards.length, 'card', 'cards') + '.' }), cards.length ? mode : null),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Excluir', {
          variant: 'danger',
          onClick: async () => {
            const v = cards.length ? mode.value : 'delete';
            await FC.decks.remove(deck.id, v === 'delete' ? 'delete' : 'move', v === 'delete' ? null : v);
            await FC.decks.ensureDefault();
            m.close();
            FC.ui.toast('Baralho excluído.');
            refresh();
          },
        }),
      ],
    });
  }

  function decksTree(refresh) {
    const now = Date.now();
    const box = h('div', { class: 'tree' });
    const draw = (nodes, depth) => {
      for (const n of nodes) {
        const d = n.deck;
        const cards = FC.decks.cardsIn(d.id);
        const due = cards.filter((c) => !c.suspended && c.state && c.state !== 'new' && c.dueDate <= now).length;
        const fresh = cards.filter((c) => !c.suspended && (!c.state || c.state === 'new')).length;
        box.appendChild(
          h(
            'div',
            { class: 'tree-row' },
            h(
              'div',
              { class: 'tree-name', style: { paddingLeft: depth * 18 + 'px' } },
              h('span', { class: 'twisty' }, icon('layers', 15)),
              h('button', { type: 'button', class: 'label-btn', text: d.name.split('::').pop(), onclick: () => FC.app.go('/decks/baralho/' + d.id) }),
              d.archived ? h('span', { class: 'badge', text: 'Arquivado' }) : null,
              d.suspended ? h('span', { class: 'badge warn', text: 'Suspenso' }) : null,
            ),
            h(
              'div',
              { class: 'tree-stats' },
              h('span', { class: 'hide-sm', text: U.plural(cards.length, 'card', 'cards') }),
              due || fresh ? h('span', { class: 'badge accent', title: 'Devidos + novos', text: U.fmtNum(due) + ' + ' + U.fmtNum(fresh) }) : null,
              button('', { icon: 'play', size: 'sm', variant: 'ghost', title: 'Estudar', onClick: () => FC.launch.choose({ deckIds: [d.id] }, d.name) }),
              FC.ui.moreButton(() => deckMenu(d, refresh)),
            ),
          ),
        );
        draw(n.children, depth + 1);
      }
    };
    draw(FC.decks.tree(), 0);
    return box;
  }

  FC.views.decks = {
    title: 'Decks',
    render(ctx) {
      const { el } = ctx;
      const body = h('div');
      const draw = () => {
        FC.ui.clear(body);
        if (activeTab === 'content') {
          body.appendChild(
            h(
              'section',
              { class: 'panel' },
              h(
                'div',
                { class: 'panel-head' },
                h('div', null, h('h2', { text: 'Hierarquia de conteúdo' }), h('p', { text: 'Grande área → Subárea → Assunto → Tema → Subtema. Números: devidos + novos; barra: taxa de acerto.' })),
                h(
                  'div',
                  { class: 'row tight' },
                  button('Expandir tudo', { size: 'sm', variant: 'ghost', onClick: () => (FC.store.nodes.forEach((n) => expanded.add(n.id)), draw()) }),
                  button('Recolher', { size: 'sm', variant: 'ghost', onClick: () => (expanded.clear(), draw()) }),
                  button('Nova grande área', { size: 'sm', icon: 'plus', onClick: async () => { const name = await FC.ui.prompt('Nova grande área', '', { placeholder: 'Ex.: Cirurgia' }); if (name) { await FC.areas.create(name, null); draw(); } } }),
                ),
              ),
              contentTree(draw),
            ),
          );
        } else {
          body.appendChild(
            h(
              'section',
              { class: 'panel' },
              h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Baralhos' }), h('p', { text: 'Coleções de cards (independentes da hierarquia). Arquivados e suspensos ficam fora da revisão normal.' })), button('Novo baralho', { size: 'sm', icon: 'plus', onClick: async () => { const name = await FC.ui.prompt('Novo baralho', '', { label: 'Nome (use "::" para sub-baralhos)', okText: 'Criar' }); if (name) { await FC.decks.create(name); draw(); } } })),
              decksTree(draw),
            ),
          );
        }
      };
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Decks' }), h('p', { text: U.plural(FC.store.cards.size, 'card', 'cards') + ' · ' + U.plural(FC.store.decks.size, 'baralho', 'baralhos') })), h('div', { class: 'row' }, link('Importar', '#/importar', { icon: 'upload' }), button('Novo card', { variant: 'primary', icon: 'plus', onClick: () => FC.cardEditor.open({}) }))),
        FC.ui.tabs(
          [
            { key: 'content', label: 'Áreas e temas' },
            { key: 'decks', label: 'Baralhos' },
          ],
          activeTab,
          (k) => ((activeTab = k), draw()),
        ),
        body,
      );
      draw();
      const redraw = U.debounce(draw, 250);
      ctx.on('cards', redraw);
      ctx.on('nodes', redraw);
      ctx.on('decks', redraw);
    },
  };

  // ── Detalhe de um nó / baralho ─────────────────────────────────────────────
  function detail(ctx, opts) {
    const { el } = ctx;
    const draw = () => {
      FC.ui.clear(el);
      const cards = opts.cards();
      const now = Date.now();
      const due = cards.filter((c) => !c.suspended && c.state && c.state !== 'new' && c.dueDate <= now).length;
      const fresh = cards.filter((c) => !c.suspended && (!c.state || c.state === 'new')).length;
      const reviews = cards.reduce((s, c) => s + FC.store.cardLogs(c.id).length, 0);
      const correct = cards.reduce((s, c) => s + FC.store.cardLogs(c.id).filter((l) => l.rating >= 2).length, 0);
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, opts.crumb || null, h('h1', { text: opts.title }), opts.subtitle ? h('p', { text: opts.subtitle }) : null), h('div', { class: 'row' }, opts.actions)),
        h('div', { class: 'tiles', style: { marginBottom: '16px' } }, FC.ui.tile('Cards', U.fmtNum(cards.length)), FC.ui.tile('Devidos agora', U.fmtNum(due)), FC.ui.tile('Novos', U.fmtNum(fresh)), FC.ui.tile('Revisões', U.fmtNum(reviews)), FC.ui.tile('Taxa de acerto', reviews ? U.pct(correct / reviews) : '—')),
        opts.children || null,
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Cards' })), FC.cardList.create({ cards: () => opts.cards(), label: opts.title, emptyText: 'Nenhum card aqui.' }).el),
      );
    };
    draw();
    const redraw = U.debounce(draw, 300);
    ctx.on('cards', redraw);
    ctx.on('nodes', redraw);
  }

  FC.views.nodeDetail = {
    title: 'Tema',
    render(ctx) {
      const id = ctx.params.id;
      if (id === '__none__') {
        ctx.setTitle('Sem classificação');
        return detail(ctx, { title: 'Sem classificação', subtitle: 'Cards sem área/assunto. Selecione e use "Mover" para classificá-los.', cards: () => FC.cards.all().filter((c) => !c.nodeId || !FC.areas.get(c.nodeId)), actions: [] });
      }
      const node = FC.areas.get(id);
      if (!node) return FC.app.go('/decks');
      ctx.setTitle(node.name);
      const kids = FC.areas.children(node.id);
      detail(ctx, {
        title: node.name,
        subtitle: FC.areas.LEVEL_LABELS[node.level],
        crumb: h('p', { class: 'crumb', style: { marginBottom: '4px' } }, FC.areas.path(node.id).slice(0, -1).map((n, i) => [i ? ' › ' : '', h('a', { href: '#/decks/no/' + n.id, text: n.name })])),
        cards: () => FC.areas.cardsIn(node.id),
        children: kids.length ? h('div', { class: 'row tight', style: { marginBottom: '16px' } }, h('span', { class: 'label', text: FC.areas.LEVEL_LABELS[node.level + 1] + ':' }), kids.map((k) => link(k.name, '#/decks/no/' + k.id, { size: 'sm', variant: 'ghost' }))) : null,
        actions: [
          button('Estudar', { variant: 'primary', icon: 'play', onClick: () => FC.launch.choose({ nodeIds: [node.id] }, FC.areas.breadcrumb(node.id)) }),
          link('Pontos fracos', '#/pontos-fracos/' + node.id, { icon: 'target' }),
          FC.ui.moreButton(() => nodeMenu(node, () => ctx.rerender())),
        ],
      });
    },
  };

  FC.views.deckDetail = {
    title: 'Baralho',
    render(ctx) {
      const deck = FC.decks.get(ctx.params.id);
      if (!deck) return FC.app.go('/decks');
      ctx.setTitle(deck.name.split('::').pop());
      detail(ctx, {
        title: deck.name.split('::').pop(),
        subtitle: 'Baralho' + (deck.name.includes('::') ? ' · ' + deck.name.split('::').slice(0, -1).join(' › ') : '') + (deck.archived ? ' · arquivado' : '') + (deck.suspended ? ' · suspenso' : ''),
        cards: () => FC.decks.cardsIn(deck.id),
        actions: [button('Estudar', { variant: 'primary', icon: 'play', onClick: () => FC.launch.choose({ deckIds: [deck.id] }, deck.name) }), FC.ui.moreButton(() => deckMenu(deck, () => ctx.rerender()))],
      });
    },
  };
})(typeof self !== 'undefined' ? self : this);
