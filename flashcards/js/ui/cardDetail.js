/*
 * Detalhe de um card: conteúdo, classificação, fonte (clicável), os três conceitos
 * separados — Agendamento (scheduler), Desempenho (performance) e Dificuldade
 * estimada — histórico de revisões e cards relacionados.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const U = FC.util;
  const { h, button, icon } = FC.ui;

  const RATING_TEXT = { 1: 'Errei', 2: 'Difícil', 3: 'Quase', 4: 'Bom', 5: 'Fácil' };
  const STATE_TEXT = { new: 'Novo', learning: 'Primeira aprendizagem', review: 'Em revisão' };

  function dl(rows) {
    return h(
      'div',
      { class: 'stack tight' },
      rows.filter(Boolean).map(([k, v]) => h('div', { class: 'row between nowrap-row small' }, h('span', { class: 'muted', text: k }), h('span', { class: 'num', style: { textAlign: 'right' }, text: v }))),
    );
  }

  /** Mostra o texto da página de origem (e abre o PDF, se guardado). */
  async function showSource(card) {
    const src = FC.pdf.findSource(card);
    const page = card.source && card.source.page;
    const content = h('div', { class: 'stack' });
    content.appendChild(h('p', { class: 'ink2' }, 'Arquivo: ', h('b', { text: (card.source && card.source.fileName) || '—' }), page ? ' · página ' + page : ''));
    if (!src) {
      content.appendChild(FC.ui.callout('O texto deste arquivo não está guardado neste navegador (o card veio de importação ou o arquivo foi removido).', 'warn'));
    } else if (page && src.pages[page - 1] != null) {
      const words = U.normalizeText(U.stripHtml(card.front))
        .split(' ')
        .filter((w) => w.length > 4);
      const pre = h('div', { class: 'prompt-box', style: { maxHeight: '50vh', fontFamily: 'var(--font)', fontSize: '0.9rem' } });
      const text = src.pages[page - 1];
      // Destaca termos da pergunta no texto da página
      const re = words.length ? new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null;
      let last = 0;
      const norm = U.stripAccents(text);
      if (re) {
        let m;
        while ((m = re.exec(norm))) {
          pre.appendChild(document.createTextNode(text.slice(last, m.index)));
          pre.appendChild(h('mark', { text: text.slice(m.index, m.index + m[0].length) }));
          last = m.index + m[0].length;
        }
      }
      pre.appendChild(document.createTextNode(text.slice(last)));
      content.appendChild(pre);
    } else {
      content.appendChild(h('p', { class: 'muted', text: 'Página não informada.' }));
    }
    const actions = [];
    if (src && src.hasPdf) {
      actions.push(
        button('Abrir PDF na página', {
          icon: 'file',
          variant: 'primary',
          onClick: async () => {
            const ok = await FC.pdf.openPdf(src.id, page);
            if (!ok) FC.ui.toast('O PDF não está guardado neste navegador.', { error: true });
          },
        }),
      );
    }
    actions.push(button('Fechar', { onClick: () => m.close() }));
    const m = FC.ui.modal({ title: 'Fonte do card', content, actions });
  }

  function sourceLink(card) {
    if (!card.source || (!card.source.fileName && !card.source.page)) return h('span', { class: 'muted', text: '—' });
    return h('button', { type: 'button', class: 'link-btn', onclick: () => showSource(card) }, icon('file', 14), ' ', (card.source.fileName || 'Arquivo') + (card.source.page ? ', p. ' + card.source.page : ''));
  }

  function open(cardId) {
    const card = FC.cards.get(cardId);
    if (!card) return;
    const now = Date.now();
    const logs = FC.store.cardLogs(card.id);
    const perf = FC.performance.cardReport(card, logs, now, { recentDays: FC.settings.get('weakRecentDays') });
    const est = FC.difficulty.estimate(card);
    const R = FC.scheduler.retrievability(card, now);
    const deck = FC.decks.get(card.deckId);

    const scheduling = h(
      'div',
      { class: 'panel flat' },
      h('h3', { text: 'Agendamento', style: { marginBottom: '8px' } }),
      h('p', { class: 'tiny muted', style: { marginBottom: '8px' }, text: 'Quando revisar (scheduler FSRS)' }),
      dl([
        ['Estado', card.suspended ? 'Suspenso' : STATE_TEXT[card.state || 'new']],
        ['Próxima revisão', card.dueDate ? U.formatDateTime(card.dueDate) : '—'],
        ['Intervalo atual', card.state && card.state !== 'new' ? FC.scheduler.formatInterval(card.scheduledDays) : '—'],
        ['Estabilidade', card.stability ? U.fmtNum(card.stability, 1) + ' dias' : '—'],
        ['Dificuldade (FSRS)', card.difficulty != null && card.state !== 'new' ? U.fmtNum(card.difficulty, 1) + ' / 10' : '—'],
        ['Chance de lembrar hoje', R != null ? U.pct(R) : '—'],
      ]),
    );
    const performance = h(
      'div',
      { class: 'panel flat' },
      h('h3', { text: 'Seu desempenho', style: { marginBottom: '8px' } }),
      h('p', { class: 'tiny muted', style: { marginBottom: '8px' }, text: 'Como você está indo neste card' }),
      dl([
        ['Revisões', U.fmtNum(perf.n)],
        ['Acertos', perf.n ? perf.correct + ' (' + U.pct(perf.accuracy) + ')' : '—'],
        ['Erros', U.fmtNum(perf.errors)],
        ['Esquecimentos', U.fmtNum(card.lapses || 0)],
        ['Erros seguidos agora', U.fmtNum(perf.consecutiveErrors)],
        ['Última resposta', perf.lastRating ? RATING_TEXT[perf.lastRating] + ' · ' + U.formatDate(perf.lastDate) : '—'],
      ]),
    );
    const difficulty = h(
      'div',
      { class: 'panel flat' },
      h('h3', { text: 'Dificuldade estimada', style: { marginBottom: '8px' } }),
      h('p', { class: 'tiny muted', style: { marginBottom: '8px' }, text: 'O quão difícil é o conteúdo' }),
      h('div', { class: 'row' }, est.label ? FC.ui.diffBadge(est.label) : h('span', { class: 'muted', text: 'Sem estimativa' }), est.value != null ? h('span', { class: 'num ink2', text: U.fmtNum(est.value, 1) + ' / 10' }) : null),
      h('p', { class: 'small muted', style: { marginTop: '8px' }, text: FC.difficulty.BASIS_TEXT[est.basis] }),
    );

    const history = logs.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', { text: 'Data' }), h('th', { text: 'Resposta' }), h('th', { class: 'num', text: 'Intervalo' }), h('th', { class: 'num', text: 'Tempo' }))),
            h(
              'tbody',
              null,
              logs
                .slice()
                .reverse()
                .slice(0, 50)
                .map((l) => h('tr', null, h('td', { text: U.formatDateTime(l.date) }), h('td', { text: RATING_TEXT[l.rating] + (l.source === 'anki' ? ' (Anki)' : '') }), h('td', { class: 'num', text: FC.scheduler.formatInterval(l.newInterval) }), h('td', { class: 'num', text: l.responseTime ? Math.round(l.responseTime / 1000) + ' s' : '—' }))),
            ),
          ),
        )
      : h('p', { class: 'muted small', text: 'Ainda não revisado.' });

    const related = FC.cards.related(card.id, 12);
    const relatedEl = related.length
      ? h(
          'div',
          { class: 'stack' },
          related.map((g) =>
            h(
              'div',
              { class: 'stack tight' },
              h('div', { class: 'row between' }, h('span', { class: 'label', text: g.label + ' · ' + FC.areas.title(g.nodeId) }), button('Quick Review', { size: 'sm', variant: 'ghost', icon: 'zap', onClick: () => (m.close(), FC.launch.quick({ nodeIds: [g.nodeId] }, 'Quick Review · ' + FC.areas.title(g.nodeId))) })),
              h(
                'div',
                { class: 'related-list' },
                g.cards.map((c) => h('button', { type: 'button', text: FC.ui.plain(c.front, 140), onclick: () => (m.close(), open(c.id)) })),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted small', text: 'Nenhum card relacionado (classifique o card para ligar aos do mesmo tema).' });

    const content = h(
      'div',
      { class: 'stack loose' },
      h(
        'div',
        { class: 'flashcard', style: { minHeight: '0' } },
        h('div', { class: 'fc-path' }, FC.ui.crumb(card.nodeId)),
        FC.ui.rich(card.front, 'fc-front'),
        h('hr', { class: 'fc-sep' }),
        FC.ui.rich(card.back, 'fc-back'),
      ),
      h(
        'div',
        { class: 'grid two' },
        dl([
          ['Baralho', deck ? deck.name.split('::').join(' › ') : '—'],
          ['Criado em', U.formatDate(card.createdAt)],
          ['Origem', { manual: 'Manual', ia: 'Gerado por IA', csv: 'Importado (CSV)', anki: 'Importado (Anki)', json: 'Importado (JSON)', duplicado: 'Cópia' }[card.origin] || '—'],
        ]),
        h(
          'div',
          { class: 'stack tight small' },
          h('div', { class: 'row between' }, h('span', { class: 'muted', text: 'Fonte' }), sourceLink(card)),
          card.reference ? h('div', { class: 'row between' }, h('span', { class: 'muted', text: 'Referência' }), h('span', { text: card.reference })) : null,
          h('div', { class: 'row tight' }, (card.tags || []).map((t) => h('button', { type: 'button', class: 'tag', text: '#' + t, onclick: () => (m.close(), FC.app.go('/busca?tag=' + encodeURIComponent(t))) }))),
        ),
      ),
      h('div', { class: 'grid three' }, scheduling, performance, difficulty),
      h('div', { class: 'stack' }, h('h3', { text: 'Histórico de revisões' }), history),
      h('div', { class: 'stack' }, h('h3', { text: 'Cards relacionados' }), relatedEl),
    );

    const favBtn = button(card.favorite ? 'Favorito' : 'Favoritar', {
      icon: 'star',
      onClick: async () => {
        await FC.cards.setFavorite(card.id, !card.favorite);
        m.close();
        open(card.id);
      },
    });
    if (card.favorite) favBtn.querySelector('svg').replaceWith(FC.ui.starIcon(true, 17));
    const m = FC.ui.modal({
      title: 'Card',
      size: 'wide',
      content,
      actions: [
        h(
          'div',
          { class: 'left' },
          FC.ui.moreButton(() => [
            {
              label: card.suspended ? 'Reativar' : 'Suspender',
              icon: 'pause',
              run: async () => {
                await FC.cards.setSuspended(card.id, !card.suspended);
                m.close();
                FC.ui.toast(card.suspended ? 'Card suspenso.' : 'Card reativado.');
              },
            },
            {
              label: 'Duplicar',
              icon: 'copy',
              run: async () => {
                const c = await FC.cards.duplicate(card.id);
                m.close();
                FC.ui.toast('Cópia criada.');
                open(c.id);
              },
            },
            {
              label: 'Voltar a "novo" (zerar agendamento)',
              icon: 'refresh',
              run: async () => {
                if (!(await FC.ui.confirm('O card volta a ser novo. O histórico continua nas estatísticas.'))) return;
                await FC.cards.resetScheduling(card.id);
                m.close();
              },
            },
            '-',
            {
              label: 'Excluir',
              icon: 'trash',
              danger: true,
              run: async () => {
                if (!(await FC.ui.confirm('Excluir este card e o histórico dele?', { danger: true, okText: 'Excluir' }))) return;
                await FC.cards.remove(card.id);
                m.close();
                FC.ui.toast('Card excluído.');
              },
            },
          ]),
          favBtn,
        ),
        button('Fechar', { onClick: () => m.close() }),
        button('Editar', { icon: 'edit', variant: 'primary', onClick: () => (m.close(), FC.cardEditor.open({ card })) }),
      ],
    });
  }

  FC.cardDetail = { open, showSource, sourceLink };
})(typeof self !== 'undefined' ? self : this);
