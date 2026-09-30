/*
 * Aba "Cards da plataforma": baralhos prontos para todos os usuários (FC.platform).
 * Estudar sem mexer nas revisões ou entrando nelas, adicionar à coleção, ver,
 * editar e ocultar cards e baralhos — o que o usuário muda vale só para ele.
 * Administradores publicam um .apkg por aqui.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;
  const P = () => FC.platform;

  const expanded = new Set();
  let expandedFor = null;

  const deckHref = (pkg, deck) => '/plataforma/baralho/' + encodeURIComponent(pkg.id) + '/' + encodeURIComponent(deck.id);
  const crumbOf = (pkg, deck) => P().ancestors(pkg, deck).map((d) => d.short).join(' › ');

  function loadingBox(text) {
    return h('div', { class: 'panel row', style: { justifyContent: 'center', padding: '28px' } }, h('span', { class: 'spinner' }), h('span', { class: 'ink2', text: text || 'Carregando…' }));
  }

  // ── Ações de baralho ───────────────────────────────────────────────────────
  /** Diálogo "Como quer estudar?" de um baralho da plataforma. */
  function studyDialog(pkg, deck) {
    const counts = P().collectionCounts(pkg);
    const inCollection = counts.get(deck.id) || 0;
    let order = 'deck';
    let limit = 0;
    const start = (mode) => {
      m.close();
      FC.app.state.pendingPlatform = { pkgId: pkg.id, deckId: deck.id, mode, order, limit, label: deck.short };
      FC.app.go('/plataforma/sessao');
    };
    const content = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'ink2', text: crumbOf(pkg, deck) + ' · ' + U.plural(deck.total, 'card', 'cards') }),
      h(
        'div',
        { class: 'grid two' },
        h(
          'div',
          { class: 'panel flat stack' },
          h('h3', { text: 'Só estudar' }),
          h('p', { class: 'small ink2', text: 'Não sei · Quase · Sei, sem interrupção. Não entra nas suas revisões e não muda o agendamento dos seus cards.' }),
          button('Começar', { variant: 'primary', icon: 'zap', onClick: () => start('free') }),
        ),
        h(
          'div',
          { class: 'panel flat stack' },
          h('h3', { text: 'Estudar e entrar nas revisões' }),
          h(
            'p',
            { class: 'small ink2', text: 'Errei · Difícil · Quase · Bom · Fácil. Cada card respondido entra na sua coleção já agendado e passa a aparecer nas suas revisões.' + (inCollection ? ' ' + U.plural(inCollection, 'card já está', 'cards já estão') + ' na sua coleção e fica' + (inCollection === 1 ? '' : 'm') + ' de fora.' : '') },
          ),
          button('Começar', { icon: 'play', onClick: () => start('schedule') }),
        ),
      ),
      h(
        'div',
        { class: 'grid two' },
        FC.ui.field(
          'Ordem',
          FC.ui.select(
            [
              { value: 'deck', label: 'A do baralho' },
              { value: 'shuffle', label: 'Embaralhar' },
            ],
            order,
            { onchange: (e) => (order = e.target.value) },
          ),
        ),
        FC.ui.field(
          'Quantidade',
          FC.ui.select(
            [0, 20, 50, 100, 200].map((n) => ({ value: n, label: n ? String(n) : 'Todos os cards' })),
            0,
            { onchange: (e) => (limit = Number(e.target.value)) },
          ),
        ),
      ),
    );
    const m = FC.ui.modal({ title: 'Estudar: ' + deck.short, content, size: 'wide' });
  }

  /** "Adicionar à minha coleção": copia os cards do baralho (e dos de dentro). */
  async function addDialog(pkg, deck, after) {
    const inCollection = P().collectionCounts(pkg).get(deck.id) || 0;
    const missing = Math.max(0, deck.total - inCollection);
    if (!missing) return FC.ui.toast('Todos os cards deste baralho já estão na sua coleção.');
    const status = h('p', { class: 'small ink2', text: '' });
    const go = button('Adicionar ' + U.plural(missing, 'card', 'cards'), {
      variant: 'primary',
      icon: 'plus',
      onClick: async () => {
        FC.ui.busy(go, true, 'Adicionando…');
        try {
          const r = await P().addDeck(pkg, deck.id, (t) => (status.textContent = t));
          m.close();
          FC.ui.toast(r.added ? U.plural(r.added, 'card adicionado', 'cards adicionados') + ' à sua coleção.' : 'Nada novo para adicionar.');
          if (after) after();
        } catch (e) {
          FC.ui.busy(go, false);
          status.textContent = '';
          FC.ui.errorToast(e);
        }
      },
    });
    const m = FC.ui.modal({
      title: 'Adicionar à minha coleção',
      size: 'narrow',
      sticky: true,
      content: h(
        'div',
        { class: 'stack' },
        h('p', { class: 'ink2', text: '“' + crumbOf(pkg, deck) + '”: ' + U.plural(missing, 'card entra', 'cards entram') + ' como novos no baralho de mesmo nome e passam a seguir as suas revisões (com o seu limite de novos por dia).' }),
        inCollection ? h('p', { class: 'small muted', text: U.plural(inCollection, 'card já está', 'cards já estão') + ' na sua coleção.' }) : null,
        h('p', { class: 'small muted', text: 'Na coleção, os cards são seus: editar ou excluir lá não muda nada para os outros usuários.' }),
        status,
      ),
      actions: [button('Cancelar', { onClick: () => m.close() }), go],
    });
  }

  function deckMenu(pkg, deck, refresh) {
    return [
      { label: 'Ver cards', icon: 'eye', run: () => FC.app.go(deckHref(pkg, deck)) },
      { label: 'Estudar', icon: 'play', run: () => studyDialog(pkg, deck) },
      { label: 'Adicionar à minha coleção', icon: 'plus', run: () => addDialog(pkg, deck, refresh) },
      '-',
      {
        label: 'Excluir da minha lista',
        icon: 'trash',
        danger: true,
        run: async () => {
          await P().setDeckHidden(deck.key, true);
          FC.ui.toast('“' + deck.short + '” saiu da sua lista (só para você).', { action: { label: 'Desfazer', run: () => P().setDeckHidden(deck.key, false) } });
        },
      },
    ];
  }

  // ── Publicar (administradores) ─────────────────────────────────────────────
  function publishPanel(cat, refresh) {
    const body = h('div', { class: 'stack' });
    const reset = () => {
      FC.ui.clear(body);
      FC.ui.add(
        body,
        h('p', { class: 'small ink2', text: 'Envie um pacote do Anki (.apkg). Ele é lido aqui no navegador e os cards vão para o Cloudflare R2 — ficam iguais para todos os usuários. Publicar de novo um pacote que já existe troca a versão anterior (o que cada usuário mudou continua valendo).' }),
        FC.ui.dropzone({ label: 'Escolher o .apkg', hint: 'Imagens do pacote não são publicadas.', accept: '.apkg,.colpkg', icon: 'upload', onFile: read }),
      );
    };
    async function read(file) {
      FC.ui.clear(body);
      const status = h('span', { class: 'ink2', text: 'Lendo o pacote…' });
      body.appendChild(h('div', { class: 'row' }, h('span', { class: 'spinner' }), status));
      let built;
      try {
        built = await P().readForPublish(file, (t) => (status.textContent = t));
      } catch (e) {
        FC.ui.errorToast(e);
        return reset();
      }
      FC.ui.clear(body);
      const name = h('input', { class: 'input', value: built.name, maxlength: 200 });
      const same = cat.packages.find((p) => p.name === built.name);
      const target = FC.ui.select([{ value: '', label: 'Novo pacote' }].concat(cat.packages.map((p) => ({ value: p.id, label: 'Atualizar “' + p.name + '”' }))), same ? same.id : '');
      const progress = h('p', { class: 'small ink2' });
      const go = button('Publicar para todos', {
        variant: 'primary',
        icon: 'upload',
        onClick: async () => {
          FC.ui.busy(go, true, 'Publicando…');
          try {
            await P().publish(built, { packageId: target.value || null, name: name.value.trim() || built.name }, (t) => (progress.textContent = t));
            FC.ui.toast('Publicado: ' + U.plural(built.cards, 'card', 'cards') + '.');
            refresh(true);
          } catch (e) {
            FC.ui.busy(go, false);
            progress.textContent = '';
            FC.ui.errorToast(e);
          }
        },
      });
      FC.ui.add(
        body,
        h('p', { class: 'ink2' }, h('strong', { text: built.fileName }), ' · ' + U.plural(built.cards, 'card', 'cards') + ' em ' + U.plural(built.decks.length, 'baralho', 'baralhos')),
        built.media ? FC.ui.callout(U.plural(built.media, 'imagem do pacote não será publicada', 'imagens do pacote não serão publicadas') + ' (os cards com imagem aparecem sem ela).', 'warn') : null,
        h('div', { class: 'grid two' }, FC.ui.field('Nome na plataforma', name), FC.ui.field('Destino', target)),
        progress,
        h('div', { class: 'row' }, go, button('Trocar arquivo', { variant: 'ghost', onClick: reset })),
      );
    }
    reset();
    return h('section', { class: 'panel stack' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Publicar baralho' }), h('p', { text: 'Só administradores veem esta parte.' }))), body);
  }

  // ── Catálogo ───────────────────────────────────────────────────────────────
  FC.views.platform = {
    title: 'Cards da plataforma',
    render(ctx) {
      const { el } = ctx;
      ctx.setTitle('Cards da plataforma');
      let showHidden = false;
      const head = h(
        'div',
        { class: 'page-head' },
        h('div', null, h('h1', { text: 'Cards da plataforma' }), h('p', { text: 'Baralhos prontos para todos. Estude sem mexer nas suas revisões ou coloque na sua coleção. O que você muda aqui (editar, excluir da lista) vale só para você.' })),
      );
      const body = h('div', { class: 'stack loose' });
      FC.ui.add(el, head, body);
      body.appendChild(loadingBox('Carregando os baralhos da plataforma…'));

      async function draw(force) {
        let cat;
        let o;
        try {
          [cat, o] = await Promise.all([P().load(force), P().overlay()]);
        } catch (e) {
          FC.ui.clear(body).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'alert', title: 'Não foi possível carregar', text: e.message, actions: [button('Tentar de novo', { variant: 'primary', onClick: () => draw(true) })] })));
          return;
        }
        if (FC.app.current !== 'platform') return;
        FC.ui.clear(body);
        if (!cat.enabled) {
          body.appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'layers', title: 'Ainda não disponível', text: cat.admin ? 'Os cards da plataforma ficam no Cloudflare R2. Configure as variáveis R2_* no servidor para publicar.' : 'Os baralhos da plataforma ainda não estão disponíveis.' })));
          return;
        }
        if (!cat.packages.length) body.appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'layers', title: 'Nenhum baralho publicado ainda', text: cat.admin ? 'Publique o primeiro abaixo.' : 'Volte mais tarde.' })));
        for (const pkg of cat.packages) body.appendChild(packagePanel(pkg, cat, o));
        if (cat.admin) body.appendChild(publishPanel(cat, draw));
      }

      function packagePanel(pkg, cat, o) {
        if (expandedFor !== pkg.id + pkg.version && !expanded.size) {
          if (!pkg.dropRoot) for (const r of pkg.roots) expanded.add(r.key);
          expandedFor = pkg.id + pkg.version;
        }
        const counts = P().collectionCounts(pkg);
        const tree = h('div', { class: 'tree' });
        const hiddenList = [];
        const drawLevel = (decks, depth) => {
          for (const deck of decks) {
            if (o.hiddenDecks.has(deck.key)) {
              hiddenList.push(deck);
              continue;
            }
            const kids = deck.children;
            const open = expanded.has(deck.key);
            const twisty = kids.length
              ? h('button', { type: 'button', class: 'twisty', 'aria-expanded': String(open), 'aria-label': (open ? 'Recolher ' : 'Expandir ') + deck.short, onclick: () => (open ? expanded.delete(deck.key) : expanded.add(deck.key), draw()) }, icon('right', 16))
              : h('span', { class: 'twisty', 'aria-hidden': 'true' });
            const have = counts.get(deck.id) || 0;
            tree.appendChild(
              h(
                'div',
                { class: 'tree-row' },
                h('div', { class: 'tree-name', style: { paddingLeft: depth * 18 + 'px' } }, twisty, h('button', { type: 'button', class: 'label-btn', text: deck.short, title: deck.name.replace(/::/g, ' › '), onclick: () => FC.app.go(deckHref(pkg, deck)) })),
                h(
                  'div',
                  { class: 'tree-stats' },
                  h('span', { class: 'nowrap', text: U.plural(deck.total, 'card', 'cards') }),
                  have ? h('span', { class: 'badge good', title: 'Na sua coleção', text: (have >= deck.total ? '✓ ' : '') + U.fmtNum(have) + ' na coleção' }) : null,
                  button('', { icon: 'play', size: 'sm', variant: 'ghost', title: 'Estudar', onClick: () => studyDialog(pkg, deck) }),
                  button('', { icon: 'plus', size: 'sm', variant: 'ghost', title: 'Adicionar à minha coleção', disabled: have >= deck.total, onClick: () => addDialog(pkg, deck, draw) }),
                  FC.ui.moreButton(() => deckMenu(pkg, deck, draw)),
                ),
              ),
            );
            if (open) drawLevel(kids, depth + 1);
          }
        };
        // Baralho-raiz com o nome do pacote: as grandes áreas aparecem direto
        const rootDeck = pkg.dropRoot ? pkg.roots[0] : null;
        const rootHidden = rootDeck && o.hiddenDecks.has(rootDeck.key);
        if (rootHidden) tree.appendChild(h('div', { class: 'list-item' }, h('span', { class: 'grow ink2', text: 'Você excluiu este pacote da sua lista.' }), button('Mostrar de novo', { size: 'sm', icon: 'undo', onClick: async () => { await P().setDeckHidden(rootDeck.key, false); draw(); } })));
        else drawLevel(rootDeck ? rootDeck.children : pkg.roots, 0);
        const hiddenBox = h('div', { class: 'stack tight' });
        if (hiddenList.length) {
          const toggle = h('button', { type: 'button', class: 'link-btn small', text: (showHidden ? 'Esconder' : 'Mostrar') + ' os excluídos da sua lista (' + hiddenList.length + ')', onclick: () => ((showHidden = !showHidden), draw()) });
          hiddenBox.appendChild(toggle);
          if (showHidden)
            for (const deck of hiddenList)
              hiddenBox.appendChild(
                h('div', { class: 'list-item' }, h('span', { class: 'grow ink2', text: crumbOf(pkg, deck) }), button('Mostrar de novo', { size: 'sm', icon: 'undo', onClick: async () => { await P().setDeckHidden(deck.key, false); draw(); } })),
              );
        }
        const setAll = (on) => {
          expanded.clear();
          if (on) for (const d of pkg.byId.values()) if (d.children.length && d.depth < (pkg.dropRoot ? 2 : 1)) expanded.add(d.key);
          draw();
        };
        return h(
          'section',
          { class: 'panel stack' },
          h(
            'div',
            { class: 'panel-head' },
            h('div', null, h('h2', { text: pkg.name }), h('p', { text: U.plural(pkg.cards, 'card', 'cards') + ' · atualizado em ' + U.formatDate(Date.parse(pkg.publishedAt), false) })),
            h(
              'div',
              { class: 'row tight' },
              rootDeck && !rootHidden ? button('Estudar', { size: 'sm', icon: 'play', onClick: () => studyDialog(pkg, rootDeck) }) : null,
              rootHidden ? null : h('span', { class: 'hide-sm' }, button('Expandir', { size: 'sm', variant: 'ghost', onClick: () => setAll(true) }), button('Recolher', { size: 'sm', variant: 'ghost', onClick: () => setAll(false) })),
              (rootDeck && !rootHidden) || cat.admin
                ? FC.ui.moreButton(() => [
                    ...(rootDeck && !rootHidden ? deckMenu(pkg, rootDeck, draw).map((x) => (x.label === 'Adicionar à minha coleção' ? Object.assign({}, x, { label: 'Adicionar tudo à minha coleção' }) : x.label === 'Ver cards' ? Object.assign({}, x, { label: 'Ver todos os cards' }) : x)) : []),
                    cat.admin && rootDeck && !rootHidden ? '-' : null,
                    cat.admin && {
                      label: 'Remover da plataforma',
                      icon: 'trash',
                      danger: true,
                      run: async () => {
                        if (!(await FC.ui.confirm('Remover “' + pkg.name + '” da plataforma para todos os usuários? Os cards que cada um já colocou na coleção continuam com ele (sem o texto nos aparelhos novos).', { danger: true, okText: 'Remover' }))) return;
                        try {
                          await P().removePackage(pkg.id);
                          FC.ui.toast('Pacote removido.');
                          draw(true);
                        } catch (e) {
                          FC.ui.errorToast(e);
                        }
                      },
                    },
                  ])
                : null,
            ),
          ),
          tree,
          hiddenBox,
        );
      }

      ctx.on('platform', () => draw());
      ctx.on('cards', U.debounce(() => draw(), 300));
      draw();
    },
  };

  // ── Cards de um baralho ────────────────────────────────────────────────────
  function editDialog(card, done) {
    const front = FC.cardEditor.richEditor(card.front, 'Frente');
    const back = FC.cardEditor.richEditor(card.back, 'Verso');
    const save = async (f, b) => {
      await P().saveEdit(card.key, f, b);
      m.close();
      FC.ui.toast(f == null ? 'Card original de volta.' : 'Edição salva (só para você).');
      if (done) done();
    };
    const m = FC.ui.modal({
      title: 'Editar card (só para você)',
      size: 'wide',
      content: h(
        'div',
        { class: 'stack' },
        h('p', { class: 'small ink2', text: 'A mudança vale só na sua conta: o card continua o mesmo para os outros usuários.' + (P().collectionIndex().has(card.key) ? ' Este card já está na sua coleção; lá ele é editado à parte.' : '') }),
        h('div', { class: 'field' }, h('label', { text: 'Frente' }), front.el),
        h('div', { class: 'field' }, h('label', { text: 'Verso' }), back.el),
      ),
      actions: [
        card.edited ? button('Voltar ao original', { variant: 'ghost', onClick: () => save(null) }) : null,
        button('Cancelar', { onClick: () => m.close() }),
        button('Salvar', { variant: 'primary', onClick: () => save(front.get(), back.get()) }),
      ].filter(Boolean),
    });
  }

  FC.views.platformDeck = {
    title: 'Cards da plataforma',
    render(ctx) {
      const { el, params } = ctx;
      const PAGE = 40;
      let shown = PAGE;
      let showHidden = false;
      el.appendChild(loadingBox());

      (async () => {
        let cat;
        try {
          cat = await P().load();
        } catch (e) {
          FC.ui.clear(el).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'alert', title: 'Não foi possível carregar', text: e.message })));
          return;
        }
        const pkg = cat.packages.find((p) => p.id === params.pkg);
        const deck = pkg && pkg.byId.get(params.deck);
        if (!deck) return FC.app.go('/plataforma', { replace: true });
        ctx.setTitle(deck.short);
        const decks = P().subtree(pkg, deck.id);
        const loaded = [];
        let next = 0;
        const list = h('div', { class: 'list' });
        const moreBtn = button('Mostrar mais', { variant: 'ghost', onClick: () => ((shown += PAGE), fill()) });
        const info = h('p', { class: 'small muted' });
        const hiddenToggle = h('button', { type: 'button', class: 'link-btn small hidden' });
        hiddenToggle.addEventListener('click', () => ((showHidden = !showHidden), render()));

        FC.ui.clear(el);
        FC.ui.add(
          el,
          h(
            'div',
            { class: 'page-head' },
            h('div', null, h('p', { class: 'small muted' }, h('a', { class: 'link-btn', href: '#/plataforma', text: 'Cards da plataforma' }), P().ancestors(pkg, deck).slice(0, -1).map((d) => ' › ' + d.short).join('')), h('h1', { text: deck.short }), h('p', { text: U.plural(deck.total, 'card', 'cards') + (decks.length > 1 ? ' em ' + U.plural(decks.length, 'baralho', 'baralhos') : '') })),
            h('div', { class: 'row' }, button('Estudar', { variant: 'primary', icon: 'play', onClick: () => studyDialog(pkg, deck) }), button('Adicionar à minha coleção', { icon: 'plus', onClick: () => addDialog(pkg, deck, render) })),
          ),
          h('section', { class: 'panel stack' }, h('div', { class: 'row between' }, info, hiddenToggle), list, moreBtn),
        );

        async function fill() {
          const o = await P().overlay();
          const visible = () => loaded.filter((c) => showHidden || !o.hiddenCards.has(c.key)).length;
          FC.ui.busy(moreBtn, true, 'Carregando…');
          try {
            while (visible() < shown && next < decks.length) {
              const group = decks.slice(next, next + 4);
              next += group.length;
              const lists = await Promise.all(group.map((d) => P().deckCards(pkg, d.id)));
              for (const l of lists) loaded.push(...l);
            }
          } catch (e) {
            FC.ui.errorToast(e);
          }
          FC.ui.busy(moreBtn, false);
          render();
        }

        async function render() {
          if (FC.app.current !== 'platformDeck') return;
          const o = await P().overlay();
          const have = P().collectionIndex();
          const hiddenCount = loaded.filter((c) => o.hiddenCards.has(c.key)).length;
          const cards = loaded.filter((c) => showHidden || !o.hiddenCards.has(c.key));
          FC.ui.clear(list);
          for (const raw of cards.slice(0, shown)) list.appendChild(row(raw, o, have));
          if (!cards.length) list.appendChild(h('p', { class: 'muted', style: { padding: '12px 4px' }, text: 'Nenhum card para mostrar.' }));
          const all = next >= decks.length;
          info.textContent = 'Mostrando ' + U.fmtNum(Math.min(shown, cards.length)) + ' de ' + (all ? U.fmtNum(cards.length) : U.fmtNum(deck.total));
          moreBtn.classList.toggle('hidden', all && cards.length <= shown);
          hiddenToggle.classList.toggle('hidden', !hiddenCount);
          hiddenToggle.textContent = (showHidden ? 'Esconder' : 'Mostrar') + ' os excluídos por você (' + hiddenCount + ')';
        }

        function row(raw, o, have) {
          const card = P().view(raw, o);
          const hidden = o.hiddenCards.has(raw.key);
          const inCol = have.get(raw.key);
          const back = h('div', { class: 'hidden', style: { marginTop: '8px' } }, FC.ui.rich(card.back));
          const toggle = h('button', { type: 'button', class: 'link-btn tiny', text: 'Ver resposta', onclick: () => { back.classList.toggle('hidden'); toggle.textContent = back.classList.contains('hidden') ? 'Ver resposta' : 'Esconder resposta'; } });
          const deckOf = pkg.byId.get(raw.deck);
          return h(
            'div',
            { class: 'card-row', style: { gridTemplateColumns: 'minmax(0, 1fr) auto', opacity: hidden ? '0.55' : '' } },
            h(
              'div',
              { style: { minWidth: 0 } },
              FC.ui.rich(card.front, 'q'),
              back,
              h(
                'div',
                { class: 'meta' },
                toggle,
                card.edited ? h('span', { class: 'badge warn', text: 'Editado por você' }) : null,
                inCol ? h('span', { class: 'badge good', text: 'Na sua coleção' }) : null,
                hidden ? h('span', { class: 'badge', text: 'Excluído da sua lista' }) : null,
                deckOf && deckOf.id !== deck.id ? h('span', { class: 'crumb', text: deckOf.short }) : null,
              ),
            ),
            FC.ui.moreButton(() => [
              { label: 'Editar (só para você)', icon: 'edit', run: () => editDialog(card, render) },
              inCol
                ? { label: 'Abrir na coleção', icon: 'eye', run: () => FC.cardDetail.open(inCol.id) }
                : {
                    label: 'Adicionar à minha coleção',
                    icon: 'plus',
                    run: async () => {
                      try {
                        await P().addCard(pkg, raw);
                        FC.ui.toast('Card adicionado à sua coleção.');
                        render();
                      } catch (e) {
                        FC.ui.errorToast(e);
                      }
                    },
                  },
              '-',
              hidden
                ? { label: 'Mostrar de novo', icon: 'undo', run: async () => { await P().setCardHidden(raw.key, false); render(); } }
                : {
                    label: 'Excluir da minha lista',
                    icon: 'trash',
                    danger: true,
                    run: async () => {
                      await P().setCardHidden(raw.key, true);
                      FC.ui.toast('Card excluído da sua lista (só para você).', { action: { label: 'Desfazer', run: () => P().setCardHidden(raw.key, false).then(render) } });
                      render();
                    },
                  },
            ]),
          );
        }

        ctx.on('platform', () => render());
        fill();
      })();
    },
  };

  // ── Sessão ─────────────────────────────────────────────────────────────────
  /** Dados para "Registrar estudo" no Projeto Residente (assunto mais frequente da sessão). */
  function studyInfo(session, keys, durationMs, notes) {
    const bySubject = new Map();
    for (const k of keys) {
      const card = session.raw.get(k);
      const deck = card && session.pkg.byId.get(card.deck);
      if (!deck) continue;
      const path = P().pathFor(session.pkg, deck);
      if (path.length < 3) continue;
      const key = path.slice(0, 3).join('\u0001');
      if (!bySubject.has(key)) bySubject.set(key, { n: 0, names: path.slice(0, 3) });
      bySubject.get(key).n++;
    }
    const top = [...bySubject.values()].sort((a, b) => b.n - a.n)[0];
    return { method: 'FLASHCARDS', minutes: Math.max(1, Math.round(durationMs / 60000)), subject: top ? { area: top.names[0], subarea: top.names[1], name: top.names[2] } : null, notes };
  }

  function reportView(ctx, session) {
    FC.timerView.sessionEnd();
    document.body.classList.remove('fc-focus-mode');
    const { el } = ctx;
    FC.ui.clear(el);
    const back = link('Cards da plataforma', '#/plataforma', { variant: 'ghost', icon: 'layers' });
    if (session.mode === 'free') {
      const report = session.quick.report();
      const missed = report.missedIds.filter((k) => session.raw.has(k));
      const addMissed = button('Colocar os que errei na minha coleção (' + missed.length + ')', {
        icon: 'plus',
        onClick: async () => {
          FC.ui.busy(addMissed, true, 'Adicionando…');
          let added = 0;
          try {
            for (const k of missed) if (!(await P().addCard(session.pkg, session.raw.get(k))).existed) added++;
            FC.ui.toast(added ? U.plural(added, 'card adicionado', 'cards adicionados') + ' à sua coleção.' : 'Esses cards já estavam na sua coleção.');
            addMissed.remove();
          } catch (e) {
            FC.ui.busy(addMissed, false);
            FC.ui.errorToast(e);
          }
        },
      });
      el.appendChild(
        h(
          'div',
          { class: 'summary stack loose' },
          h('div', { class: 'panel pad-lg stack' }, h('div', { class: 'row' }, icon('zap', 22), h('h1', { text: 'Estudo concluído' })), h('p', { class: 'ink2', text: session.label + ' · cards da plataforma (fora das suas revisões)' })),
          h('div', { class: 'summary-figs' }, FC.ui.tile('Cards estudados', U.fmtNum(report.reviewed)), FC.ui.tile('Sei', U.fmtNum(report.counts.sei)), FC.ui.tile('Quase', U.fmtNum(report.counts.quase)), FC.ui.tile('Não sei', U.fmtNum(report.counts.naosei))),
          h('div', { class: 'panel row between' }, h('span', { class: 'ink2', text: 'Aproveitamento' }), h('span', { class: 'hero', text: U.pct(report.accuracy) })),
          h('p', { class: 'small muted', text: 'Contagem pela primeira resposta de cada card · ' + U.formatDuration(report.durationMs) + '.' }),
          h(
            'div',
            { class: 'row' },
            missed.length
              ? button('Estudar os que errei de novo (' + missed.length + ')', {
                  variant: 'primary',
                  icon: 'refresh',
                  onClick: () => {
                    FC.app.state.pendingPlatform = { pkgId: session.pkg.id, deckId: session.deckId, mode: 'free', order: 'shuffle', label: session.label + ' · os que errei', cards: missed.map((k) => session.raw.get(k)) };
                    FC.app.go('/plataforma/sessao', { replace: true });
                  },
                })
              : null,
            missed.length ? addMissed : null,
            back,
          ),
          FC.reviewView.studyPanel(studyInfo(session, report.firstAnswers.map((a) => a.cardId), report.durationMs, 'Flashcards · ' + session.label + ' (cards da plataforma): ' + U.plural(report.reviewed, 'card', 'cards') + ', ' + U.pct(report.accuracy) + ' de aproveitamento.')),
        ),
      );
      return;
    }
    const answers = session.answers;
    const correct = answers.filter((a) => a.rating >= 2).length;
    const durationMs = answers.length ? answers[answers.length - 1].date - session.startedAt : 0;
    el.appendChild(
      h(
        'div',
        { class: 'summary stack loose' },
        h('div', { class: 'panel pad-lg stack' }, h('div', { class: 'row' }, icon('check', 22), h('h1', { text: 'Sessão concluída!' })), h('p', { class: 'ink2', text: session.label + ' · os cards respondidos entraram nas suas revisões' })),
        h('div', { class: 'summary-figs' }, FC.ui.tile('Cards respondidos', U.fmtNum(answers.length)), FC.ui.tile('Na sua coleção agora', U.fmtNum(session.added)), FC.ui.tile('Acertos', U.fmtNum(correct)), FC.ui.tile('Aproveitamento', U.pct(answers.length ? correct / answers.length : null))),
        h('p', { class: 'small muted', text: 'Os que você errou voltam daqui a pouco na revisão normal (aba Revisar).' }),
        h('div', { class: 'row' }, link('Ir para a revisão', '#/revisar', { variant: 'primary', icon: 'play' }), back),
        FC.reviewView.studyPanel(studyInfo(session, answers.map((a) => a.key), durationMs, 'Flashcards · ' + session.label + ' (cards da plataforma): ' + U.plural(answers.length, 'card', 'cards') + ' para as revisões.')),
      ),
    );
  }

  FC.views.platformSession = {
    title: 'Cards da plataforma',
    render(ctx) {
      const pending = FC.app.state.pendingPlatform;
      FC.app.state.pendingPlatform = null;
      const pkg = pending && P().pkgById(pending.pkgId);
      if (!pkg) return FC.app.go('/plataforma', { replace: true });
      const session = new (P().Session)(pkg, pending.deckId, pending);
      FC.timerView.sessionStart();
      ctx.onCleanup(() => FC.timerView.sessionEnd());
      const free = session.mode === 'free';
      ctx.setTitle(pending.label);
      const { el } = ctx;
      let revealed = false;
      let done = false;
      let busy = false;
      let shownAt = Date.now();

      const progress = h('span', { class: 'small ink2 num', style: { whiteSpace: 'nowrap' } });
      const bar = h('div', { style: { flex: '1 1 100%' } });
      const undoBtn = button('', { icon: 'undo', variant: 'ghost', size: 'sm', title: 'Desfazer (Z)', onClick: () => undo() });
      const top = h('div', { class: 'study-top' }, h('span', { class: 'title', text: pending.label }), progress, undoBtn, button('Encerrar', { variant: 'ghost', size: 'sm', onClick: () => finish() }), bar);
      const stage = h('div', { class: 'stack' });
      const keys = free
        ? [h('span', null, h('kbd', { text: 'Espaço' }), ' mostrar'), h('span', null, h('kbd', { text: '1' }), ' não sei'), h('span', null, h('kbd', { text: '2' }), ' quase'), h('span', null, h('kbd', { text: '3' }), ' sei')]
        : [h('span', null, h('kbd', { text: 'Espaço' }), ' mostrar'), h('span', null, h('kbd', { text: '1–5' }), ' avaliar'), h('span', null, h('kbd', { text: 'Z' }), ' desfazer')];
      const foot = h('div', { class: 'study-foot' }, h('div', { class: 'keys' }, keys), h('span', { class: 'tiny', text: free ? 'Só estudar: não entra nas suas revisões' : 'Cada card respondido entra nas suas revisões' }));
      el.appendChild(h('div', { class: 'study' }, top, stage, foot));
      document.body.classList.add('fc-focus-mode');
      stage.appendChild(loadingBox('Carregando os cards…'));

      function header(card) {
        const deck = pkg.byId.get(card.deck);
        if (!deck || !FC.settings.get('showPathInReview')) return null;
        const names = P().ancestors(pkg, deck).map((d) => d.short);
        const shownNames = pkg.dropRoot ? names.slice(1) : names;
        return h('div', { class: 'fc-path' }, shownNames.length > 1 ? h('div', { text: shownNames.slice(0, -1).join(' › ') }) : null, h('span', { class: 'subject', text: shownNames[shownNames.length - 1] || deck.short }));
      }

      function updateTop() {
        undoBtn.disabled = !session.canUndo() || busy;
        const target = session.limit ? Math.min(session.limit, session.total) : session.total;
        if (free) {
          const seen = session.quick.seenCount();
          progress.textContent = U.fmtNum(seen) + ' de ' + U.fmtNum(target) + ' vistos';
          const doneCount = [...session.quick.records.values()].filter((r) => r.done).length;
          FC.ui.clear(bar).appendChild(FC.ui.progressBar(target ? doneCount / target : 0));
        } else {
          progress.textContent = U.fmtNum(session.answers.length) + ' de ' + U.fmtNum(Math.max(0, target - session.skippedInCollection)) + ' respondidos';
          FC.ui.clear(bar).appendChild(FC.ui.progressBar(target ? session.answers.length / Math.max(1, target - session.skippedInCollection) : 0));
        }
      }

      async function draw() {
        if (done) return;
        revealed = false;
        let card = session.current();
        if (!card && !session.done()) {
          FC.ui.clear(stage).appendChild(loadingBox('Carregando mais cards…'));
          try {
            await session.fill(20);
          } catch (e) {
            FC.ui.clear(stage).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'alert', title: 'Não foi possível carregar os cards', text: e.message, actions: [button('Tentar de novo', { variant: 'primary', onClick: () => draw() }), button('Encerrar', { onClick: () => finish() })] })));
            return;
          }
          card = session.current();
        }
        updateTop();
        FC.ui.clear(stage);
        if (!card) return finish();
        const rec = free ? session.quick.records.get(card.key) : null;
        const flash = h('article', { class: 'flashcard', 'aria-live': 'polite' }, header(card), FC.ui.rich(card.front, 'fc-front'));
        if (rec) flash.appendChild(h('span', { class: 'badge ' + (rec.last === 'naosei' ? 'crit' : 'warn'), text: 'De novo · ' + (rec.last === 'naosei' ? 'não sabia' : rec.last === 'quase' ? 'quase' : 'reforço') }));
        if (card.edited) flash.appendChild(h('span', { class: 'badge', text: 'Editado por você' }));
        const show = button('Mostrar resposta', { variant: 'primary', size: 'lg', onClick: reveal });
        FC.ui.add(stage, flash, h('div', { class: 'show-answer' }, show));
        show.focus({ preventScroll: true });
        shownAt = Date.now();
      }

      function reveal() {
        const card = session.current();
        if (revealed || !card || done) return;
        revealed = true;
        const flash = stage.querySelector('.flashcard');
        FC.ui.add(flash, h('hr', { class: 'fc-sep' }), FC.ui.rich(card.back, 'fc-back'));
        const meta = h('div', { class: 'fc-meta' });
        if (free) {
          const inCol = P().collectionIndex().has(card.key);
          const addBtn = h('button', {
            type: 'button',
            class: 'link-btn tiny',
            text: inCol ? '✓ Na sua coleção' : '+ Colocar na minha coleção',
            disabled: inCol,
            onclick: async () => {
              addBtn.disabled = true;
              try {
                await P().addCard(pkg, session.raw.get(card.key));
                addBtn.textContent = '✓ Na sua coleção';
              } catch (e) {
                addBtn.disabled = false;
                FC.ui.errorToast(e);
              }
            },
          });
          meta.appendChild(addBtn);
        }
        meta.appendChild(h('button', { type: 'button', class: 'link-btn tiny', text: 'Editar (só para você)', onclick: () => editDialog(card, () => { session.refresh(card.key); revealed = false; draw(); }) }));
        meta.appendChild(
          h('button', {
            type: 'button',
            class: 'link-btn tiny',
            text: 'Excluir da minha lista',
            onclick: async () => {
              await P().setCardHidden(card.key, true);
              session.drop(card.key);
              FC.ui.toast('Card excluído da sua lista (só para você).', { action: { label: 'Desfazer', run: () => P().setCardHidden(card.key, false) } });
              draw();
            },
          }),
        );
        flash.appendChild(meta);
        let answers;
        if (free) {
          answers = h(
            'div',
            { class: 'rating-bar quick', role: 'group', 'aria-label': 'Você sabia?' },
            FC.quickReview.ANSWERS.map((a, i) => h('button', { type: 'button', class: 'rate q-' + a.key, onclick: () => answerFree(a.key) }, h('span', { class: 'name', text: a.label }), h('span', { class: 'key', text: String(i + 1) }))),
          );
        } else {
          const preview = FC.scheduler.preview(FC.scheduler.newState(), Date.now(), FC.settings.schedulerOptions());
          answers = h(
            'div',
            { class: 'rating-bar', role: 'group', 'aria-label': 'Como foi?' },
            preview.map((p) => h('button', { type: 'button', class: 'rate r' + p.rating, onclick: () => rate(p.rating), 'aria-label': p.label + ', próxima revisão em ' + p.text }, h('span', { class: 'name', text: p.label }), h('span', { class: 'ivl', text: p.text }), h('span', { class: 'key', text: String(p.rating) }))),
          );
        }
        stage.querySelector('.show-answer').replaceWith(answers);
        const focus = answers.querySelector(free ? '.q-sei' : '.rate.r4');
        if (focus) focus.focus({ preventScroll: true });
      }

      function answerFree(key) {
        if (!revealed || done || busy) return;
        session.answerFree(key);
        draw();
      }

      async function rate(value) {
        if (!revealed || done || busy) return;
        busy = true;
        try {
          await session.answerSchedule(value, Date.now() - shownAt);
        } catch (e) {
          FC.ui.errorToast(e);
        }
        busy = false;
        draw();
      }

      async function undo() {
        if (busy || done || !session.canUndo()) return;
        busy = true;
        try {
          await session.undo();
        } finally {
          busy = false;
        }
        draw();
      }

      function finish() {
        if (done) return;
        done = true;
        const answered = free ? session.quick.history.length : session.answers.length;
        if (!answered) return FC.app.go('/plataforma');
        reportView(ctx, session);
      }

      const onKey = (e) => {
        if (FC.ui.anyModalOpen() || done) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === ' ' || e.key === 'Enter') {
          if (!revealed) {
            e.preventDefault();
            reveal();
          } else if (e.key === ' ') e.preventDefault();
        } else if (revealed && free && /^[1-3]$/.test(e.key)) answerFree(['naosei', 'quase', 'sei'][Number(e.key) - 1]);
        else if (revealed && !free && /^[1-5]$/.test(e.key)) {
          e.preventDefault();
          rate(Number(e.key));
        } else if (e.key.toLowerCase() === 'z') undo();
      };
      document.addEventListener('keydown', onKey);
      ctx.onCleanup(() => document.removeEventListener('keydown', onKey));

      (async () => {
        try {
          if (pending.cards) {
            session.o = await P().overlay();
            session.have = P().collectionIndex();
            session.pending = [];
            session.total = pending.cards.length;
            session.append(pending.cards);
          } else await session.start();
        } catch (e) {
          FC.ui.clear(stage).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'alert', title: 'Não foi possível carregar os cards', text: e.message, actions: [link('Voltar', '#/plataforma', { variant: 'primary' })] })));
          return;
        }
        if (!session.current() && session.done()) {
          document.body.classList.remove('fc-focus-mode');
          FC.ui.clear(el).appendChild(h('div', { class: 'panel pad-lg' }, FC.ui.empty({ icon: 'check', title: 'Nenhum card para estudar aqui', text: free ? 'Os cards deste baralho foram excluídos da sua lista.' : 'Todos os cards deste baralho já estão na sua coleção: estude pela revisão normal.', actions: [link('Voltar', '#/plataforma', { variant: 'primary' })] })));
          done = true;
          return;
        }
        draw();
      })();
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
