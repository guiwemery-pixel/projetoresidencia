/*
 * Quick Review: escolha baralhos, áreas, subáreas, assuntos, temas ou tags e
 * revise TODOS os cards selecionados, vencidos ou não, com 3 respostas
 * (Não sei · Quase · Sei). Não mexe no agendamento; guarda só o resumo da sessão.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  // ── Seleção ────────────────────────────────────────────────────────────────
  FC.views.quickSetup = {
    title: 'Quick Review',
    render(ctx) {
      const { el } = ctx;
      const sel = { deckIds: new Set(), nodeIds: new Set(), tags: new Set(), favorites: false };
      let orderMode = 'random';
      let limit = 0;
      const countEl = h('strong', { class: 'num' });
      const startBtn = button('Começar', { variant: 'primary', size: 'lg', icon: 'zap', onClick: start });

      function filter() {
        return { deckIds: [...sel.deckIds], nodeIds: [...sel.nodeIds], tags: [...sel.tags], favorites: sel.favorites, includeBlockedDecks: true };
      }
      function selected() {
        const any = sel.deckIds.size || sel.nodeIds.size || sel.tags.size || sel.favorites;
        return any ? FC.cards.select(filter()) : [];
      }
      function updateCount() {
        const n = selected().length;
        const total = limit && limit < n ? limit : n;
        countEl.textContent = U.plural(total, 'card', 'cards') + (limit && limit < n ? ' (de ' + n + ')' : '');
        startBtn.disabled = !n;
      }
      function start() {
        const cards = selected();
        if (!cards.length) return;
        let ordered = FC.launch.order(cards, orderMode);
        if (limit) ordered = ordered.slice(0, limit);
        const parts = [];
        for (const id of sel.deckIds) parts.push(FC.decks.shortName(FC.decks.get(id)));
        for (const id of sel.nodeIds) parts.push(FC.areas.title(id));
        for (const t of sel.tags) parts.push('#' + t);
        if (sel.favorites) parts.push('Favoritos');
        FC.launch.quickIds(ordered.map((c) => c.id), 'Quick Review · ' + U.truncate(parts.join(', '), 80), filter());
      }

      const check = (label, sub, onChange, checked) => {
        const input = h('input', { type: 'checkbox', checked: !!checked });
        input.addEventListener('change', () => {
          onChange(input.checked);
          updateCount();
        });
        return h('label', { class: 'check', style: { padding: '5px 0' } }, input, h('span', null, label, sub ? h('span', { class: 'muted small', text: '  ' + sub }) : null));
      };

      // Baralhos
      const decksBox = h('div', { class: 'stack tight' });
      const drawDecks = (nodes, depth) => {
        for (const n of nodes) {
          const count = FC.decks.cardsIn(n.deck.id).length;
          const row = check(n.deck.name.split('::').pop(), U.plural(count, 'card', 'cards'), (v) => (v ? sel.deckIds.add(n.deck.id) : sel.deckIds.delete(n.deck.id)));
          row.style.paddingLeft = depth * 20 + 'px';
          decksBox.appendChild(row);
          drawDecks(n.children, depth + 1);
        }
      };
      drawDecks(FC.decks.tree(), 0);

      // Conteúdo (hierarquia até o tema)
      const treeBox = h('div', { class: 'stack tight' });
      const counts = new Map();
      for (const c of FC.store.cards.values()) for (const n of FC.areas.path(c.nodeId)) counts.set(n.id, (counts.get(n.id) || 0) + 1);
      const drawNodes = (parentId, depth) => {
        for (const n of FC.areas.children(parentId)) {
          if (!counts.get(n.id)) continue;
          const row = check(n.name, FC.areas.LEVEL_LABELS[n.level] + ' · ' + counts.get(n.id), (v) => (v ? sel.nodeIds.add(n.id) : sel.nodeIds.delete(n.id)));
          row.style.paddingLeft = depth * 20 + 'px';
          treeBox.appendChild(row);
          if (n.level < 4) drawNodes(n.id, depth + 1);
        }
      };
      drawNodes(null, 0);

      // Tags
      const tagsBox = h('div', { class: 'row tight' });
      for (const { tag, count } of FC.cards.allTags().slice(0, 80)) {
        const b = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', text: '#' + tag + ' (' + count + ')' });
        b.addEventListener('click', () => {
          const on = !sel.tags.has(tag);
          if (on) sel.tags.add(tag);
          else sel.tags.delete(tag);
          b.setAttribute('aria-pressed', String(on));
          b.style.background = on ? 'var(--accent-wash)' : '';
          b.style.color = on ? 'var(--accent-strong)' : '';
          updateCount();
        });
        tagsBox.appendChild(b);
      }

      const favCount = FC.cards.select({ favorites: true }).length;
      const recent = FC.store.quickSessions.slice(-5).reverse();

      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Quick Review' }), h('p', { text: 'Revise todos os cards de uma seleção, vencidos ou não. As respostas não alteram o agendamento da revisão normal.' }))),
        h(
          'div',
          { class: 'grid side' },
          h(
            'div',
            { class: 'stack loose' },
            h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Conteúdo' }), h('p', { text: 'Área, subárea, assunto ou tema' })), treeBox.childNodes.length ? treeBox : h('p', { class: 'muted', text: 'Nenhum card classificado ainda.' })),
            h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Baralhos' })), decksBox.childNodes.length ? decksBox : h('p', { class: 'muted', text: 'Nenhum baralho.' })),
            tagsBox.childNodes.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Tags' })), tagsBox) : null,
          ),
          h(
            'div',
            { class: 'stack loose' },
            h(
              'section',
              { class: 'panel stack', style: { position: 'sticky', top: '76px' } },
              h('h2', { text: 'Sessão' }),
              favCount ? check('Só favoritos', U.plural(favCount, 'card', 'cards'), (v) => (sel.favorites = v)) : null,
              FC.ui.field(
                'Ordem',
                FC.ui.select(
                  [
                    { value: 'random', label: 'Aleatória' },
                    { value: 'hierarchy', label: 'Pela hierarquia (tema a tema)' },
                    { value: 'hardest', label: 'Mais difíceis primeiro' },
                  ],
                  orderMode,
                  { onchange: (e) => (orderMode = e.target.value) },
                ),
              ),
              FC.ui.field(
                'Quantidade',
                FC.ui.select(
                  [
                    { value: 0, label: 'Todos os cards selecionados' },
                    { value: 20, label: '20' },
                    { value: 50, label: '50' },
                    { value: 100, label: '100' },
                    { value: 200, label: '200' },
                  ],
                  0,
                  { onchange: (e) => ((limit = Number(e.target.value)), updateCount()) },
                ),
              ),
              h('p', { class: 'ink2' }, 'Selecionados: ', countEl),
              startBtn,
              h('p', { class: 'hint', text: 'Atalhos: Espaço mostra a resposta · 1 Não sei · 2 Quase · 3 Sei · Z desfaz' }),
            ),
            recent.length
              ? h(
                  'section',
                  { class: 'panel' },
                  h('h2', { text: 'Sessões recentes', style: { marginBottom: '8px' } }),
                  h(
                    'div',
                    { class: 'list' },
                    recent.map((s) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'small', style: { fontWeight: 600 }, text: s.label }), h('div', { class: 'tiny muted', text: U.formatDateTime(s.startedAt) + ' · ' + U.plural(s.reviewed, 'card', 'cards') + (s.hardestNodeId && FC.areas.get(s.hardestNodeId) ? ' · difícil: ' + FC.areas.title(s.hardestNodeId) : '') })), h('strong', { class: 'num', text: U.pct(s.accuracy) }))),
                  ),
                )
              : null,
          ),
        ),
      );
      if (!FC.store.cards.size) {
        FC.ui.clear(el).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'zap', title: 'Nenhum card ainda', text: 'Crie, importe ou gere cards para usar o Quick Review.', actions: [link('Importar', '#/importar', { variant: 'primary' })] })));
      }
      updateCount();
    },
  };

  // ── Sessão ─────────────────────────────────────────────────────────────────
  async function saveSession(session, report, hardest) {
    const record = {
      id: session.id,
      startedAt: session.startedAt,
      endedAt: Date.now(),
      label: session.meta.label,
      total: report.total,
      reviewed: report.reviewed,
      presentations: report.presentations,
      counts: report.counts,
      accuracy: report.accuracy,
      hardestNodeId: hardest ? hardest.nodeId : null,
      answers: report.firstAnswers.map((a) => ({ cardId: a.cardId, first: a.first, presentations: a.presentations })),
    };
    const idx = FC.store.quickSessions.findIndex((s) => s.id === record.id);
    if (idx >= 0) FC.store.quickSessions[idx] = record;
    else FC.store.quickSessions.push(record);
    await FC.db.put('quickSessions', record);
    FC.store.emit('quick', record);
    return record;
  }

  function hardestOf(report) {
    return FC.performance.hardestInSession(report.firstAnswers.map((a) => ({ cardId: a.cardId, score: a.score, nodeId: (FC.cards.get(a.cardId) || {}).nodeId })));
  }

  function reportView(ctx, session) {
    const report = session.report();
    const hardest = hardestOf(report);
    saveSession(session, report, hardest);
    document.body.classList.remove('focus-mode');
    const { el } = ctx;
    FC.ui.clear(el);
    el.appendChild(
      h(
        'div',
        { class: 'summary stack loose' },
        h('div', { class: 'panel pad-lg stack' }, h('div', { class: 'row' }, icon('zap', 22), h('h1', { text: 'Quick Review concluído' })), h('p', { class: 'ink2', text: session.meta.label })),
        h(
          'div',
          { class: 'summary-figs' },
          FC.ui.tile('Cards revisados', U.fmtNum(report.reviewed), report.total > report.reviewed ? 'de ' + report.total + ' selecionados' : null),
          FC.ui.tile('Sei', U.fmtNum(report.counts.sei)),
          FC.ui.tile('Quase', U.fmtNum(report.counts.quase)),
          FC.ui.tile('Não sei', U.fmtNum(report.counts.naosei)),
        ),
        h('div', { class: 'panel row between' }, h('span', { class: 'ink2', text: 'Aproveitamento' }), h('span', { class: 'hero', text: U.pct(report.accuracy) })),
        hardest
          ? h(
              'div',
              { class: 'panel stack' },
              h('p', { class: 'small ink2', text: 'Maior dificuldade da sessão:' }),
              h('div', { style: { fontSize: '1.25rem', fontWeight: 650 }, text: FC.areas.title(hardest.nodeId) }),
              h('p', { class: 'small muted', text: FC.areas.breadcrumb(hardest.nodeId) + ' · ' + U.pct(hardest.accuracy) + ' de aproveitamento em ' + hardest.n + ' cards' }),
            )
          : h('p', { class: 'muted', text: report.counts.sei === report.reviewed ? 'Você sabia todos. 👏' : 'Poucos cards por tema para apontar uma dificuldade específica.' }),
        h('p', { class: 'small muted', text: 'Contagem pela primeira resposta de cada card. ' + U.plural(report.presentations, 'apresentação', 'apresentações') + ' no total · ' + U.formatDuration(report.durationMs) + '.' }),
        h(
          'div',
          { class: 'row' },
          report.missedIds.length ? button('Revisar os que errei (' + report.missedIds.length + ')', { variant: 'primary', icon: 'refresh', onClick: () => FC.launch.quickIds(U.shuffle(report.missedIds), 'Quick Review · não sabia / quase') }) : null,
          hardest ? button('Revisar tema', { icon: 'target', onClick: () => FC.launch.quick({ nodeIds: [hardest.nodeId] }, 'Quick Review · ' + FC.areas.title(hardest.nodeId), 'hardest') }) : null,
          link('Voltar ao dashboard', '#/', { variant: 'ghost', icon: 'home' }),
        ),
      ),
    );
  }

  FC.views.quickSession = {
    title: 'Quick Review',
    render(ctx) {
      const pending = FC.app.state.pendingQuick;
      if (!pending || !pending.cardIds || !pending.cardIds.length) return FC.app.go('/quick');
      FC.app.state.pendingQuick = null;
      const session = FC.quickReview.create(pending.cardIds.filter((id) => FC.store.cards.has(id)), { label: pending.label, filter: pending.filter });
      ctx.setTitle(pending.label);
      const { el } = ctx;
      let revealed = false;
      let done = false;
      const progress = h('span', { class: 'small ink2 num' });
      const bar = h('div', { style: { flex: '1 1 100%' } });
      const undoBtn = button('', { icon: 'undo', variant: 'ghost', size: 'sm', title: 'Desfazer (Z)', onClick: () => undo() });
      const top = h('div', { class: 'study-top' }, h('span', { class: 'title', text: pending.label }), progress, undoBtn, button('Encerrar', { variant: 'ghost', size: 'sm', onClick: () => finish() }), bar);
      const stage = h('div', { class: 'stack' });
      const foot = h('div', { class: 'study-foot' }, h('div', { class: 'keys' }, h('span', null, h('kbd', { text: 'Espaço' }), ' mostrar'), h('span', null, h('kbd', { text: '1' }), ' não sei'), h('span', null, h('kbd', { text: '2' }), ' quase'), h('span', null, h('kbd', { text: '3' }), ' sei')), h('span', { class: 'tiny', text: 'Quick Review não altera o agendamento' }));
      el.appendChild(h('div', { class: 'study' }, top, stage, foot));
      document.body.classList.add('focus-mode');

      function draw() {
        revealed = false;
        undoBtn.disabled = !session.history.length;
        const id = session.current();
        const seen = session.seenCount();
        progress.textContent = seen + ' de ' + session.total + ' vistos · ' + session.remaining() + ' na fila';
        FC.ui.clear(bar).appendChild(FC.ui.progressBar(session.total ? [...session.records.values()].filter((r) => r.done).length / session.total : 0));
        FC.ui.clear(stage);
        if (!id) return finish();
        const card = FC.cards.get(id);
        if (!card) {
          session.answer('sei');
          return draw();
        }
        const rec = session.records.get(id);
        const flash = h('article', { class: 'flashcard' }, FC.reviewView.pathHeader(card), FC.ui.rich(card.front, 'fc-front'));
        if (rec) flash.appendChild(h('span', { class: 'badge ' + (rec.last === 'naosei' ? 'crit' : 'warn'), text: 'De novo · ' + (rec.last === 'naosei' ? 'não sabia' : rec.last === 'quase' ? 'quase' : 'reforço') }));
        const show = button('Mostrar resposta', { variant: 'primary', size: 'lg', onClick: reveal });
        FC.ui.add(stage, flash, h('div', { class: 'show-answer' }, show));
        show.focus({ preventScroll: true });
      }

      function reveal() {
        if (revealed || !session.current()) return;
        revealed = true;
        const card = FC.cards.get(session.current());
        const flash = stage.querySelector('.flashcard');
        FC.ui.add(flash, h('hr', { class: 'fc-sep' }), FC.ui.rich(card.back, 'fc-back'));
        const answers = h(
          'div',
          { class: 'rating-bar quick', role: 'group', 'aria-label': 'Você sabia?' },
          FC.quickReview.ANSWERS.map((a, i) => h('button', { type: 'button', class: 'rate q-' + a.key, onclick: () => answer(a.key) }, h('span', { class: 'name', text: a.label }), h('span', { class: 'key', text: String(i + 1) }))),
        );
        stage.querySelector('.show-answer').replaceWith(answers);
        answers.querySelector('.q-sei').focus({ preventScroll: true });
      }

      function answer(key) {
        if (!revealed || done) return;
        session.answer(key);
        draw();
      }

      function undo() {
        if (!session.history.length || done) return;
        session.undo();
        draw();
      }

      function finish() {
        if (done) return;
        done = true;
        if (!session.history.length) return FC.app.go('/quick');
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
        } else if (revealed && e.key === '1') answer('naosei');
        else if (revealed && e.key === '2') answer('quase');
        else if (revealed && e.key === '3') answer('sei');
        else if (e.key.toLowerCase() === 'z') undo();
      };
      document.addEventListener('keydown', onKey);
      ctx.onCleanup(() => {
        document.removeEventListener('keydown', onKey);
        if (!done && session.history.length) {
          const report = session.report();
          saveSession(session, report, hardestOf(report));
        }
      });
      draw();
    },
  };
})(typeof self !== 'undefined' ? self : this);
