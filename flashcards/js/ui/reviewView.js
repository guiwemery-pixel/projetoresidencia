/*
 * Revisão normal: pergunta → [Mostrar resposta] → resposta → 5 avaliações com o
 * próximo intervalo embaixo de cada botão. Atalhos: Espaço mostra a resposta,
 * 1–5 avaliam, Z desfaz, E edita. Ao fim, resumo com a maior dificuldade da sessão.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  /** Cabeçalho do card no estilo do modelo: ASSUNTO + "Tema › Subtema". */
  function pathHeader(card) {
    if (!FC.settings.get('showPathInReview')) return null;
    const names = FC.areas.pathNames(card.nodeId);
    if (!names.length) return null;
    const parts = FC.formats.modelParts(names);
    return h(
      'div',
      { class: 'fc-path' },
      names.length > 2 ? h('div', { text: names.slice(0, 2).join(' › ') }) : null,
      h('span', { class: 'subject', text: parts.subject }),
      parts.topics.length ? h('span', { class: 'topics', text: parts.topics.join(' › ') }) : null,
    );
  }

  /**
   * Dados para registrar a sessão no histórico de estudos do Projeto Residente:
   * tempo, o assunto mais frequente (Grande área › Subárea › Assunto) e um resumo.
   */
  function studyInfo(cardIds, durationMs, notes) {
    const bySubject = new Map();
    for (const id of cardIds) {
      const card = FC.cards.get(id);
      const path = card ? FC.areas.path(card.nodeId) : [];
      if (path.length < 3) continue;
      const key = path[2].id;
      if (!bySubject.has(key)) bySubject.set(key, { n: 0, names: path.slice(0, 3).map((n) => n.name) });
      bySubject.get(key).n++;
    }
    const top = [...bySubject.values()].sort((a, b) => b.n - a.n)[0];
    return {
      method: 'FLASHCARDS',
      minutes: Math.max(1, Math.round(durationMs / 60000)),
      subject: top ? { area: top.names[0], subarea: top.names[1], name: top.names[2] } : null,
      notes,
    };
  }

  /** "Registrar estudo": só aparece dentro do site (o React fornece host.registerStudy). */
  function studyPanel(info) {
    if (!FC.host || !FC.host.registerStudy) return null;
    return h(
      'div',
      { class: 'panel row between fc-register' },
      h('div', { class: 'grow', style: { minWidth: '220px' } }, h('strong', { text: 'Contar no seu histórico de estudos' }), h('p', { class: 'small ink2', text: 'Registra esta sessão no Projeto Residente (método Flashcards) com o tempo' + (info.subject ? ' e o assunto (' + info.subject.name + ')' : '') + ' já preenchidos.' })),
      button('Registrar estudo', { icon: 'book', onClick: () => FC.host.registerStudy(info) }),
    );
  }

  function summaryView(ctx, sum, label, extra) {
    const { el } = ctx;
    FC.ui.clear(el);
    document.body.classList.remove('fc-focus-mode');
    const hardest = sum.hardest;
    const box = h(
      'div',
      { class: 'summary stack loose' },
      h('div', { class: 'panel pad-lg stack' }, h('div', { class: 'row' }, icon('check', 22), h('h1', { text: 'Sessão concluída!' })), h('p', { class: 'ink2', text: label })),
      h(
        'div',
        { class: 'summary-figs' },
        FC.ui.tile('Cards revisados', U.fmtNum(sum.reviewed)),
        FC.ui.tile('Acertos', U.fmtNum(sum.correct)),
        FC.ui.tile('Erros', U.fmtNum(sum.errors)),
        FC.ui.tile('Aproveitamento', U.pct(sum.accuracy)),
      ),
      h('p', { class: 'ink2' }, icon('clock', 15), ' Tempo: ', h('strong', { text: U.formatDuration(sum.durationMs) })),
      hardest
        ? h(
            'div',
            { class: 'panel stack' },
            h('p', { class: 'small ink2', text: 'Maior dificuldade da sessão:' }),
            h('div', { style: { fontSize: '1.25rem', fontWeight: 650 }, text: FC.areas.title(hardest.nodeId) }),
            h('p', { class: 'small muted', text: FC.areas.breadcrumb(hardest.nodeId) }),
            h('div', { class: 'row' }, h('span', { class: 'ink2', text: 'Desempenho:' }), h('strong', { text: U.pct(hardest.accuracy) }), h('span', { class: 'muted small', text: '(' + hardest.n + ' respostas)' })),
          )
        : h('p', { class: 'muted', text: sum.errors ? 'Poucas respostas por tema para apontar uma dificuldade específica.' : 'Nenhum erro nesta sessão.' }),
      h(
        'div',
        { class: 'row' },
        sum.errorIds.length ? button('Revisar erros (' + sum.errorIds.length + ')', { variant: 'primary', icon: 'refresh', onClick: () => FC.launch.quickIds(sum.errorIds, 'Erros da sessão') }) : null,
        hardest ? button('Revisar tema', { icon: 'zap', onClick: () => FC.launch.quick({ nodeIds: [hardest.nodeId] }, 'Tema · ' + FC.areas.title(hardest.nodeId), 'hardest') }) : null,
        link('Início dos flashcards', '#/', { variant: 'ghost', icon: 'home' }),
      ),
      extra || null,
    );
    el.appendChild(box);
  }

  FC.views.review = {
    title: 'Revisão',
    render(ctx) {
      const { el, query } = ctx;
      const filter = FC.launch.queryToFilter(query);
      const label = query.label || 'Revisão de hoje';
      ctx.setTitle(label);
      const session = FC.review.createSession(filter, label, { all: query.todos === '1', noNew: query.novos === '0' });
      let current = null;
      let revealed = false;
      let busy = false;
      let waitTimer = null;

      const counts = h('div', { class: 'queue-counts', 'aria-label': 'Restantes' });
      const undoBtn = button('', { icon: 'undo', variant: 'ghost', size: 'sm', title: 'Desfazer (Z)', disabled: true, onClick: () => undo() });
      const endBtn = button('Encerrar', { variant: 'ghost', size: 'sm', onClick: () => finish() });
      const top = h('div', { class: 'study-top' }, h('span', { class: 'title', text: label }), counts, undoBtn, endBtn);
      const stage = h('div', { class: 'stack' });
      const foot = h(
        'div',
        { class: 'study-foot' },
        h('div', { class: 'keys' }, h('span', null, h('kbd', { text: 'Espaço' }), ' mostrar'), h('span', null, h('kbd', { text: '1–5' }), ' avaliar'), h('span', null, h('kbd', { text: 'Z' }), ' desfazer'), h('span', null, h('kbd', { text: 'E' }), ' editar')),
        h('span', { class: 'tiny' }),
      );
      const wrap = h('div', { class: 'study' }, top, stage, foot);
      el.appendChild(wrap);
      document.body.classList.add('fc-focus-mode');

      function renderCounts(rem, kind) {
        FC.ui.clear(counts);
        if (!rem) return;
        const item = (n, dot, title, k) => h('span', { class: kind === k ? 'current' : '', title }, h('span', { class: 'dot ' + dot }), U.fmtNum(n));
        FC.ui.add(counts, item(rem.new, 'new', 'Novos', 'new'), item(rem.learning, 'learn', 'Aprendendo', 'learning'), item(rem.review, 'review', 'Revisões', 'review'));
      }

      function next() {
        clearTimeout(waitTimer);
        revealed = false;
        const res = session.next();
        undoBtn.disabled = !session.canUndo();
        FC.ui.clear(stage);
        if (res && res.waitUntil) {
          renderCounts({ new: 0, learning: res.remainingLearning, review: 0 }, 'learning');
          const mins = Math.max(1, Math.round((res.waitUntil - Date.now()) / 60000));
          stage.appendChild(
            h(
              'div',
              { class: 'panel wait-card stack' },
              h('h2', { text: 'Próximo card em ' + mins + ' min' }),
              h('p', { class: 'ink2', text: 'Restam cards em aprendizagem que voltam daqui a pouco. Você pode esperar aqui ou encerrar.' }),
              h('div', { class: 'row', style: { justifyContent: 'center' } }, button('Encerrar sessão', { variant: 'primary', onClick: () => finish() })),
            ),
          );
          waitTimer = setTimeout(next, Math.min(60000, Math.max(5000, res.waitUntil - Date.now() + 500)));
          return;
        }
        if (!res) {
          if (!session.answers.length) return emptyState();
          return finish();
        }
        current = res;
        renderCounts(res.remaining, res.kind);
        const card = res.card;
        const front = FC.ui.rich(card.front, 'fc-front');
        const flash = h('article', { class: 'flashcard', 'aria-live': 'polite' }, pathHeader(card), front);
        if (res.early) flash.appendChild(h('span', { class: 'badge warn', text: res.early === 'ahead' ? 'Antes do vencimento' : 'Adiantado (aprendizagem)' }));
        const showBtn = button('Mostrar resposta', { variant: 'primary', size: 'lg', onClick: reveal });
        FC.ui.add(stage, flash, h('div', { class: 'show-answer' }, showBtn));
        showBtn.focus({ preventScroll: true });
      }

      function reveal() {
        if (!current || revealed) return;
        revealed = true;
        const card = current.card;
        const flash = stage.querySelector('.flashcard');
        FC.ui.add(flash, h('hr', { class: 'fc-sep' }), FC.ui.rich(card.back, 'fc-back'));
        const meta = h('div', { class: 'fc-meta' });
        if (card.source && (card.source.fileName || card.source.page)) meta.appendChild(FC.cardDetail.sourceLink(card));
        if (card.reference) meta.appendChild(h('span', { text: card.reference }));
        meta.appendChild(h('button', { type: 'button', class: 'link-btn tiny', text: 'Relacionados', onclick: () => FC.cardDetail.open(card.id) }));
        const fav = h('button', { type: 'button', class: 'link-btn tiny', text: card.favorite ? '★ Favorito' : '☆ Favoritar', onclick: async () => { await FC.cards.setFavorite(card.id, !card.favorite); fav.textContent = card.favorite ? '★ Favorito' : '☆ Favoritar'; } });
        meta.appendChild(fav);
        meta.appendChild(h('button', { type: 'button', class: 'link-btn tiny', text: 'Editar', onclick: () => edit() }));
        meta.appendChild(h('button', { type: 'button', class: 'link-btn tiny', text: 'Suspender', onclick: () => suspend() }));
        flash.appendChild(meta);
        const preview = session.preview(card.id);
        const bar = h(
          'div',
          { class: 'rating-bar', role: 'group', 'aria-label': 'Como foi?' },
          preview.map((p) => h('button', { type: 'button', class: 'rate r' + p.rating, onclick: () => rate(p.rating), 'aria-label': p.label + ', próxima revisão em ' + p.text }, h('span', { class: 'name', text: p.label }), h('span', { class: 'ivl', text: p.text }), h('span', { class: 'key', text: String(p.rating) }))),
        );
        stage.querySelector('.show-answer').replaceWith(bar);
        bar.querySelector('.rate.r4').focus({ preventScroll: true });
      }

      async function rate(value) {
        if (!current || !revealed || busy) return;
        busy = true;
        try {
          const elapsed = Date.now() - session.shownAt;
          await session.answer(current.card.id, value, elapsed);
        } catch (e) {
          FC.ui.errorToast(e);
        }
        busy = false;
        next();
      }

      async function undo() {
        if (busy || !session.canUndo()) return;
        busy = true;
        await session.undo();
        busy = false;
        FC.ui.toast('Última resposta desfeita.');
        next();
      }

      async function edit() {
        if (!current) return;
        const updated = await FC.cardEditor.open({ card: FC.cards.get(current.card.id) });
        if (updated === null && !FC.cards.get(current.card.id)) return next();
        const wasRevealed = revealed;
        const card = FC.cards.get(current.card.id);
        if (!card) return next();
        current.card = card;
        const flash = stage.querySelector('.flashcard');
        const fresh = h('article', { class: 'flashcard' }, pathHeader(card), FC.ui.rich(card.front, 'fc-front'));
        flash.replaceWith(fresh);
        if (wasRevealed) {
          revealed = false;
          const bar = stage.querySelector('.rating-bar');
          const placeholder = h('div', { class: 'show-answer' });
          if (bar) bar.replaceWith(placeholder);
          reveal();
        }
      }

      async function suspend() {
        if (!current) return;
        const id = current.card.id;
        await FC.cards.setSuspended(id, true);
        FC.ui.toast('Card suspenso.', { action: { label: 'Desfazer', run: () => FC.cards.setSuspended(id, false) } });
        next();
      }

      async function finish() {
        clearTimeout(waitTimer);
        if (!session.answers.length) return FC.app.go('/');
        await session.finish();
        const sum = session.summary();
        const notes = 'Flashcards · ' + label + ': ' + U.plural(sum.reviewed, 'resposta', 'respostas') + ', ' + U.pct(sum.accuracy) + ' de acerto.';
        summaryView(ctx, sum, label, studyPanel(studyInfo(session.answers.map((a) => a.cardId), sum.durationMs, notes)));
      }

      function emptyState() {
        document.body.classList.remove('fc-focus-mode');
        const c = FC.review.counts(filter);
        const all = FC.cards.select(filter).length;
        FC.ui.clear(el).appendChild(
          h(
            'div',
            { class: 'panel pad-lg' },
            FC.ui.empty({
              icon: 'check',
              title: all ? 'Nada para revisar agora' : 'Nenhum card aqui',
              text: all
                ? (c.newHeld ? U.plural(c.newHeld, 'card novo daqui não entra', 'cards novos daqui não entram') + ' nos novos do dia (marcado "Fora da revisão geral"): estude-os pelo "Estudar tudo". ' : '') +
                  (c.dueHeld ? U.plural(c.dueHeld, 'revisão devida fica', 'revisões devidas ficam') + ' fora desta revisão (baralho ou tema marcado "Fora da revisão geral"): abra o baralho/tema para revisá-las. ' : '') +
                  (c.newAvailable && !c.newToday ? 'O limite de cards novos de hoje já foi atingido. ' : '') +
                  'A revisão normal segue o agendamento. Para revisar mesmo assim, use o Quick Review (não altera o agendamento).'
                : 'Crie, importe ou gere cards para começar.',
              actions: all
                ? [
                    c.newHeld ? button('Estudar tudo', { variant: 'primary', icon: 'layers', onClick: () => FC.launch.studyAll(filter, label) }) : null,
                    button('Quick Review', { variant: c.newHeld ? null : 'primary', icon: 'zap', onClick: () => FC.launch.quick(filter, 'Quick Review · ' + label) }),
                    link('Início', '#/', { variant: 'ghost' }),
                  ].filter(Boolean)
                : [link('Importar', '#/importar', { variant: 'primary' }), link('Gerar com IA', '#/gerar')],
            }),
          ),
        );
      }

      const onKey = (e) => {
        if (FC.ui.anyModalOpen()) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (e.ctrlKey || e.metaKey || e.altKey) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
          }
          return;
        }
        if (e.key === ' ' || e.key === 'Enter') {
          if (!revealed && current) {
            e.preventDefault();
            reveal();
          } else if (e.key === ' ') e.preventDefault();
        } else if (/^[1-5]$/.test(e.key) && revealed) {
          e.preventDefault();
          rate(Number(e.key));
        } else if (e.key.toLowerCase() === 'z') undo();
        else if (e.key.toLowerCase() === 'e') edit();
      };
      document.addEventListener('keydown', onKey);
      ctx.onCleanup(() => {
        document.removeEventListener('keydown', onKey);
        clearTimeout(waitTimer);
        if (session.answers.length) session.finish();
      });
      next();
    },
  };

  FC.reviewView = { summaryView, pathHeader, studyInfo, studyPanel };
})(typeof self !== 'undefined' ? self : globalThis);
