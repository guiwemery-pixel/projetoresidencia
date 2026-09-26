/*
 * Início: o que há para hoje, onde está a maior dificuldade e o progresso.
 * Também define FC.analysis (contexto de desempenho com cache) usado pelas
 * telas de pontos fracos e estatísticas.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  // ── Contexto de análise (cache curto) ──────────────────────────────────────
  let cache = null;
  const analysis = {
    context() {
      const s = FC.settings.get();
      const key = [FC.store.logs.length, FC.store.cards.size, FC.store.nodes.size, FC.store.quickSessions.length, s.weakMinReviews, s.weakMinCards, s.weakRecentDays, s.weakIncludeQuick, Math.floor(Date.now() / 60000), lastChange].join('|');
      if (cache && cache.key === key) return cache;
      const ctx = FC.performance.buildContext({
        cards: FC.cards.all(),
        logs: FC.store.logs,
        nodes: FC.store.nodes,
        quickSessions: FC.store.quickSessions,
        now: Date.now(),
        opts: { minReviews: s.weakMinReviews, minCards: s.weakMinCards, recentDays: s.weakRecentDays, includeQuick: s.weakIncludeQuick },
      });
      const aggs = FC.performance.nodeStats(ctx);
      cache = { key, ctx, aggs };
      return cache;
    },
    weak(limit = 10) {
      const { ctx, aggs } = this.context();
      return FC.performance.weakPoints(ctx, aggs, limit);
    },
    indicators() {
      const { ctx, aggs } = this.context();
      return FC.performance.indicators(ctx, aggs);
    },
    studyAgain() {
      const { ctx, aggs } = this.context();
      return FC.performance.studyAgain(ctx, aggs, (id) => FC.areas.title(id));
    },
  };
  let lastChange = 0;
  if (FC.store) FC.store.on('change', () => (lastChange = Date.now()));
  FC.analysis = analysis;

  function greeting() {
    const hr = new Date().getHours();
    if (hr < 5) return 'Boa noite!';
    if (hr < 12) return 'Bom dia!';
    if (hr < 18) return 'Boa tarde!';
    return 'Boa noite!';
  }

  function weakItem(agg, rank) {
    const names = FC.areas.path(agg.nodeId);
    const node = names[names.length - 1];
    return h(
      'button',
      { type: 'button', class: 'weak-item', onclick: () => FC.app.go('/pontos-fracos/' + agg.nodeId) },
      h('span', { class: 'weak-rank', text: String(rank) }),
      h('span', { style: { minWidth: 0 } }, h('div', { class: 'weak-title', text: FC.areas.title(agg.nodeId) }), h('div', { class: 'weak-sub', text: names.slice(0, -1).map((n) => n.name).join(' › ') + ' · ' + FC.areas.LEVEL_LABELS[node ? node.level : 0] })),
      h('span', { class: 'weak-value' }, h('strong', { text: U.pct(agg.accuracy) }), h('div', { class: 'tiny muted', text: agg.n + ' revisões' }), FC.ui.meter(agg.accuracy, 'weak')),
    );
  }

  function weakPanel() {
    const weak = analysis.weak(5);
    const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Onde estou tendo mais dificuldade?' }), h('p', { text: 'Calculado pelo seu histórico, no nível mais específico com dados suficientes.' })), link('Ver tudo', '#/pontos-fracos', { variant: 'ghost', size: 'sm' })));
    if (!weak.enoughData) {
      panel.appendChild(h('p', { class: 'ink2', text: 'Dados insuficientes para avaliar os temas ainda. Cada tema precisa de pelo menos ' + FC.settings.get('weakMinReviews') + ' revisões em ' + FC.settings.get('weakMinCards') + ' cards.' }));
      return panel;
    }
    if (!weak.items.length) {
      panel.appendChild(FC.ui.callout('Nenhum tema com dificuldade clara agora. Continue revisando!', 'good', 'check'));
      return panel;
    }
    panel.appendChild(h('div', { class: 'weak-list' }, weak.items.map((a, i) => weakItem(a, i + 1))));
    return panel;
  }

  function focusPanel() {
    const weak = analysis.weak(1);
    const top = weak.items[0];
    const panel = h('section', { class: 'panel focus-card stack' }, h('div', { class: 'row' }, icon('target', 18), h('h2', { text: 'Revisar meu ponto mais fraco' })));
    if (!top) {
      panel.appendChild(h('p', { class: 'ink2', text: weak.enoughData ? 'Sem ponto fraco claro no momento.' : 'Assim que houver dados suficientes, seu principal ponto de dificuldade aparece aqui.' }));
      return panel;
    }
    FC.ui.add(panel, 
      h('div', null, h('p', { class: 'small ink2', text: 'Seu principal ponto de dificuldade:' }), h('div', { class: 'big', text: FC.areas.title(top.nodeId) }), h('p', { class: 'small muted', text: FC.areas.breadcrumb(top.nodeId) })),
      h('div', { class: 'row' }, h('span', { class: 'ink2', text: 'Desempenho' }), h('strong', { text: U.pct(top.accuracy) }), h('span', { class: 'muted small', text: '· ' + top.n + ' revisões · ' + top.recentErrors + ' erros recentes' })),
      h(
        'div',
        { class: 'row' },
        button('Revisar agora', { variant: 'primary', icon: 'zap', onClick: () => FC.launch.quick({ nodeIds: [top.nodeId] }, 'Ponto fraco · ' + FC.areas.title(top.nodeId), 'hardest') }),
        link('Detalhes', '#/pontos-fracos/' + top.nodeId, { variant: 'ghost' }),
      ),
    );
    return panel;
  }

  function todayPanel() {
    const c = FC.review.counts({});
    const dueToday = c.dueToday;
    const total = c.dueNow + c.newToday;
    const panel = h('section', { class: 'panel pad-lg today-main' });
    FC.ui.add(panel, 
      h('div', null, h('p', { class: 'ink2', text: 'Hoje você tem:' })),
      h(
        'div',
        { class: 'today-counts' },
        count(c.newToday, 'cards novos', 'new'),
        count(dueToday, 'para revisar', 'review'),
        count(c.overdue, 'atrasados', 'overdue'),
      ),
    );
    const actions = h('div', { class: 'row' });
    if (total) actions.appendChild(button('Começar revisão', { variant: 'primary', size: 'lg', icon: 'play', onClick: () => FC.app.go('/revisar') }));
    else {
      const next = nextDue();
      actions.appendChild(FC.ui.callout(next ? 'Tudo em dia! Próxima revisão ' + next : 'Tudo em dia!', 'good', 'check'));
    }
    actions.appendChild(button('Quick Review', { icon: 'zap', onClick: () => FC.app.go('/quick') }));
    panel.appendChild(actions);
    return panel;
  }

  function nextDue() {
    let min = null;
    for (const card of FC.store.cards.values()) {
      if (card.suspended || !card.state || card.state === 'new' || card.dueDate == null) continue;
      if (min == null || card.dueDate < min) min = card.dueDate;
    }
    if (min == null) return null;
    const days = U.studyDaysBetween(Date.now(), min, FC.settings.get('rolloverHour'));
    if (days <= 0) return 'ainda hoje (' + new Date(min).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ')';
    if (days === 1) return 'amanhã';
    return 'em ' + days + ' dias (' + U.formatDate(min, false) + ')';
  }

  function count(n, label, dot) {
    return h('div', { class: 'today-count' }, h('div', { class: 'value', text: U.fmtNum(n) }), h('div', { class: 'label' }, h('span', { class: 'dot ' + dot }), label));
  }

  function progressPanel() {
    const now = Date.now();
    const s = FC.settings.get();
    const logs = FC.store.logs;
    const from7 = FC.statistics.periodStart('7', now, s.rolloverHour);
    const from30 = FC.statistics.periodStart('30', now, s.rolloverHour);
    const p7 = FC.statistics.periodStats(logs, from7, null);
    const p30 = FC.statistics.periodStats(logs, from30, null);
    const streak = FC.statistics.streak(logs, now, s.rolloverHour);
    const studied = new Set(logs.map((l) => l.cardId)).size;
    const series = FC.statistics.series(logs, FC.statistics.periodStart('30', now, s.rolloverHour) + 16 * U.DAY, now + 1, 'day', s.rolloverHour);
    return h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Seu progresso' }), link('Estatísticas', '#/estatisticas', { variant: 'ghost', size: 'sm' })),
      h(
        'div',
        { class: 'tiles' },
        FC.ui.tile('Cards estudados', U.fmtNum(studied), 'de ' + U.fmtNum(FC.store.cards.size) + ' na coleção'),
        FC.ui.tile('Revisões', U.fmtNum(p7.reviews), 'últimos 7 dias', h('div', { class: 'spark' }, FC.charts.sparkline(series.map((r) => r.reviews)))),
        FC.ui.tile('Taxa de acerto', U.pct(p30.accuracy), 'últimos 30 dias'),
        FC.ui.tile('Tempo estudado', U.formatDuration(p7.timeMs), 'últimos 7 dias'),
        FC.ui.tile('Sequência', U.plural(streak.current, 'dia', 'dias'), 'recorde: ' + U.plural(streak.longest, 'dia', 'dias')),
      ),
    );
  }

  function onboarding() {
    return h(
      'section',
      { class: 'panel pad-lg' },
      FC.ui.empty({
        icon: 'layers',
        title: 'Comece sua coleção',
        text: 'Crie cards à mão, importe um CSV no seu modelo (ou um baralho do Anki com o histórico de revisões) ou gere cards a partir de um PDF com IA.',
        actions: [
          button('Novo card', { variant: 'primary', icon: 'plus', onClick: () => FC.cardEditor.open({}) }),
          link('Importar', '#/importar', { icon: 'upload' }),
          link('Gerar com IA', '#/gerar', { icon: 'sparkles' }),
        ],
      }),
    );
  }

  async function backupReminder() {
    if (FC.store.cards.size < 30) return null;
    const last = await FC.backup.lastBackupAt();
    if (last && Date.now() - last < 14 * U.DAY) return null;
    return FC.ui.callout(
      h('span', null, last ? 'Seu último backup foi em ' + U.formatDate(last) + '. ' : 'Você ainda não fez backup. ', 'Os dados ficam só neste navegador — ', h('a', { href: '#/configuracoes', text: 'exporte um backup' }), '.'),
      'warn',
    );
  }

  FC.views.dashboard = {
    title: 'Início',
    render(ctx) {
      const { el } = ctx;
      const draw = async () => {
        FC.ui.clear(el);
        const raw = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        const date = raw.charAt(0).toUpperCase() + raw.slice(1);
        el.appendChild(h('div', { class: 'hello', style: { marginBottom: '18px' } }, h('div', null, h('h1', { text: greeting() }), h('p', { class: 'ink2', text: date }))));
        if (!FC.store.cards.size) {
          el.appendChild(onboarding());
          if (FC.store.drafts.length) el.appendChild(draftsNotice());
          return;
        }
        const stack = h('div', { class: 'stack loose' });
        el.appendChild(stack);
        if (FC.store.drafts.length) stack.appendChild(draftsNotice());
        stack.appendChild(h('div', { class: 'today' }, todayPanel(), focusPanel()));
        stack.appendChild(h('div', { class: 'grid side' }, weakPanel(), progressPanel()));
        const reminder = await backupReminder();
        if (reminder) stack.appendChild(reminder);
      };
      draw();
      ctx.on('cards', FC.util.debounce(draw, 400));
      ctx.on('decks', FC.util.debounce(draw, 400));
    },
  };

  function draftsNotice() {
    return FC.ui.callout(h('span', null, U.plural(FC.store.drafts.length, 'card gerado aguarda', 'cards gerados aguardam') + ' sua revisão antes de entrar na coleção. ', h('a', { href: '#/gerar/revisao', text: 'Revisar agora' })), '', 'sparkles');
  }
})(typeof self !== 'undefined' ? self : this);
