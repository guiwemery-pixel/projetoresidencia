/*
 * Estatísticas: contagens da coleção, métricas do período, evolução no tempo
 * (acerto, erros, revisões, cards aprendidos, tempo), previsão de revisões e
 * desempenho hierárquico (grande área → subárea → assunto → tema).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon } = FC.ui;
  const U = FC.util;
  const S = () => FC.statistics;

  let period = '30';
  const openRows = new Set();

  function bucketLabel(ts, bucket) {
    const d = new Date(ts);
    if (bucket === 'month') return U.MONTHS[d.getMonth()] + '/' + String(d.getFullYear()).slice(2);
    return d.getDate() + '/' + (d.getMonth() + 1);
  }

  function bucketTitle(ts, bucket) {
    const d = new Date(ts);
    if (bucket === 'week') return 'Semana de ' + U.formatDate(ts);
    if (bucket === 'month') return U.MONTHS_LONG[d.getMonth()] + ' de ' + d.getFullYear();
    return U.WEEKDAYS[d.getDay()] + ', ' + U.formatDate(ts);
  }

  function hierarchyTable(scopeId) {
    const { aggs } = FC.analysis.context();
    const box = h('div', { class: 'tree' });
    const draw = (parentId, depth) => {
      const kids = FC.areas.children(parentId).map((n) => ({ n, a: aggs.get(n.id) })).filter((x) => x.a && x.a.cards);
      kids.sort((x, y) => (y.a.n ? 1 : 0) - (x.a.n ? 1 : 0) || (x.a.accuracy || 0) - (y.a.accuracy || 0));
      for (const { n, a } of kids) {
        const hasKids = FC.areas.children(n.id).length > 0;
        const open = openRows.has(n.id);
        box.appendChild(
          h(
            'div',
            { class: 'tree-row' + (a.isWeak ? ' perf-weak' : '') },
            h(
              'div',
              { class: 'tree-name', style: { paddingLeft: depth * 18 + 'px' } },
              hasKids ? h('button', { type: 'button', class: 'twisty', 'aria-expanded': String(open), 'aria-label': open ? 'Recolher' : 'Expandir', onclick: () => (open ? openRows.delete(n.id) : openRows.add(n.id), redraw()) }, icon('right', 16)) : h('span', { class: 'twisty' }),
              h('a', { class: 'label-btn', href: '#/pontos-fracos/' + n.id, text: n.name }),
              h('span', { class: 'tree-level', text: FC.areas.LEVEL_LABELS[n.level] }),
              a.isWeak ? h('span', { class: 'badge serious', text: 'ponto fraco' }) : null,
            ),
            h('div', { class: 'tree-stats' }, h('span', { class: 'hide-sm', text: U.fmtNum(a.n) + ' rev.' }), h('span', { class: 'perf' }, h('span', { class: 'bar-cell' }, h('span', { style: { width: Math.round((a.accuracy || 0) * 100) + '%' } })), h('strong', { class: 'num', text: a.n ? U.pct(a.accuracy) : '—' }))),
          ),
        );
        if (open) draw(n.id, depth + 1);
      }
    };
    let redraw = () => {
      FC.ui.clear(box);
      draw(scopeId || null, 0);
      if (!box.childNodes.length) box.appendChild(h('p', { class: 'muted', text: 'Sem cards classificados.' }));
    };
    redraw();
    return box;
  }

  FC.views.stats = {
    title: 'Estatísticas',
    render(ctx) {
      const { el, query } = ctx;
      let scope = query.node && FC.areas.get(query.node) ? query.node : '';
      const body = h('div', { class: 'stack loose' });

      const scopeOptions = [{ value: '', label: 'Toda a coleção' }].concat(
        [...FC.store.nodes.values()]
          .filter((n) => n.level <= 3)
          .map((n) => ({ value: n.id, label: FC.areas.breadcrumb(n.id) }))
          .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      );
      const scopeSel = FC.ui.select(scopeOptions, scope, { onchange: (e) => ((scope = e.target.value), draw()), 'aria-label': 'Escopo' });
      scopeSel.style.maxWidth = '360px';

      const draw = () => {
        FC.ui.clear(body);
        const s = FC.settings.get();
        const now = Date.now();
        const cards = scope ? FC.areas.cardsIn(scope) : FC.cards.all();
        const ids = new Set(cards.map((c) => c.id));
        const logs = scope ? FC.store.logs.filter((l) => ids.has(l.cardId)) : FC.store.logs;
        const from = S().periodStart(period, now, s.rolloverHour);
        const to = U.addDays(U.dayStart(now, s.rolloverHour), 1);
        const ov = S().overview(cards, now, s.rolloverHour);
        const ps = S().periodStats(logs, from, null);
        const streak = S().streak(FC.store.logs, now, s.rolloverHour);
        const quick = FC.store.quickSessions.filter((q) => from == null || q.startedAt >= from);

        body.appendChild(
          h(
            'section',
            { class: 'stack' },
            h('h2', { text: 'Coleção' }),
            h(
              'div',
              { class: 'tiles' },
              FC.ui.tile('Cards totais', U.fmtNum(ov.total)),
              FC.ui.tile('Novos', U.fmtNum(ov.new)),
              FC.ui.tile('Aprendendo', U.fmtNum(ov.learning), 'primeira aprendizagem'),
              FC.ui.tile('Em revisão', U.fmtNum(ov.young), 'intervalo < 21 dias'),
              FC.ui.tile('Aprendidos', U.fmtNum(ov.mature), 'intervalo ≥ 21 dias'),
              FC.ui.tile('Vencidos', U.fmtNum(ov.dueNow), ov.overdue ? ov.overdue + ' de dias anteriores' : 'para agora'),
              FC.ui.tile('Suspensos', U.fmtNum(ov.suspended)),
            ),
          ),
        );
        body.appendChild(
          h(
            'section',
            { class: 'stack' },
            h('h2', { text: 'No período' }),
            h(
              'div',
              { class: 'tiles' },
              FC.ui.tile('Taxa de acerto', U.pct(ps.accuracy), 'acerto = tudo menos "Errei"'),
              FC.ui.tile('Revisões', U.fmtNum(ps.reviews), U.plural(ps.uniqueCards, 'card', 'cards') + ' diferentes'),
              FC.ui.tile('Erros', U.fmtNum(ps.errors)),
              FC.ui.tile('Cards novos estudados', U.fmtNum(ps.newCards)),
              FC.ui.tile('Tempo estudado', U.formatDuration(ps.timeMs)),
              FC.ui.tile('Tempo médio/card', ps.avgTimeMs ? Math.round(ps.avgTimeMs / 1000) + ' s' : '—'),
              FC.ui.tile('Sequência atual', U.plural(streak.current, 'dia', 'dias'), 'recorde ' + streak.longest + ' · ' + streak.days + ' dias estudados'),
              FC.ui.tile('Quick Review', U.plural(quick.length, 'sessão', 'sessões'), quick.length ? U.pct(quick.reduce((a, q) => a + (q.accuracy || 0), 0) / quick.length) + ' de aproveitamento médio' : 'no período'),
            ),
          ),
        );

        if (!logs.length) {
          body.appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'chart', title: 'Sem revisões registradas', text: 'Os gráficos aparecem depois das primeiras revisões.' })));
        } else {
          const start = from != null ? from : U.dayStart(logs[0].date, s.rolloverHour);
          const bucket = S().bucketFor(start, to);
          const rows = S().series(logs, start, to, bucket, s.rolloverHour);
          const cum = S().cumulativeLearned(logs, rows);
          const unit = { day: 'dia', week: 'semana', month: 'mês' }[bucket];
          const acc = FC.charts.line({ name: 'Taxa de acerto', max: 1, spanGaps: true, format: (v) => U.pct(v), points: rows.map((r) => ({ label: bucketLabel(r.start, bucket), title: bucketTitle(r.start, bucket), value: r.accuracy, sub: r.reviews + ' revisões' })) });
          const revs = FC.charts.bars({
            name: 'Revisões',
            series: [
              { label: 'Acertos', color: 'var(--series-1)' },
              { label: 'Erros', color: 'var(--series-2)' },
            ],
            points: rows.map((r) => ({ label: bucketLabel(r.start, bucket), title: bucketTitle(r.start, bucket), values: [r.correct, r.errors] })),
          });
          const learned = FC.charts.line({ name: 'Cards aprendidos (acumulado)', integer: true, points: rows.map((r, i) => ({ label: bucketLabel(r.start, bucket), title: bucketTitle(r.start, bucket), value: cum[i], sub: r.learned + ' novos no período' })), format: (v) => U.fmtNum(Math.round(v)) });
          const time = FC.charts.bars({ name: 'Tempo', integer: false, series: [{ label: 'Minutos', color: 'var(--series-3)' }], format: (v) => (v < 10 ? U.fmtNum(v, 1) : U.fmtNum(Math.round(v))), points: rows.map((r) => ({ label: bucketLabel(r.start, bucket), title: bucketTitle(r.start, bucket), values: [r.timeMs / 60000] })) });
          body.appendChild(
            h(
              'div',
              { class: 'grid two' },
              FC.charts.card({ title: 'Acerto ao longo do tempo', subtitle: 'Por ' + unit, chart: acc, columns: ['Período', 'Acerto', 'Revisões'], rows: rows.map((r) => [bucketTitle(r.start, bucket), U.pct(r.accuracy), r.reviews]) }),
              FC.charts.card({ title: 'Revisões e erros', subtitle: 'Por ' + unit, chart: revs, legend: [{ label: 'Acertos', color: 'var(--series-1)' }, { label: 'Erros', color: 'var(--series-2)' }], columns: ['Período', 'Acertos', 'Erros'], rows: rows.map((r) => [bucketTitle(r.start, bucket), r.correct, r.errors]) }),
              FC.charts.card({ title: 'Cards aprendidos', subtitle: 'Total acumulado de cards que passaram da primeira aprendizagem', chart: learned, columns: ['Período', 'Novos formados', 'Acumulado'], rows: rows.map((r, i) => [bucketTitle(r.start, bucket), r.learned, cum[i]]) }),
              FC.charts.card({ title: 'Tempo de estudo', subtitle: 'Minutos por ' + unit, chart: time, columns: ['Período', 'Minutos'], rows: rows.map((r) => [bucketTitle(r.start, bucket), Math.round(r.timeMs / 60000)]) }),
            ),
          );
        }
        const fc = S().forecast(cards, now, 30, s.rolloverHour);
        const forecast = FC.charts.bars({
          name: 'Previsão',
          series: [
            { label: 'Previstos', color: 'var(--series-1)' },
            { label: 'Atrasados', color: 'var(--series-2)' },
          ],
          points: fc.map((r) => ({ label: bucketLabel(r.start, 'day'), title: bucketTitle(r.start, 'day'), values: [r.count - r.overdue, r.overdue] })),
        });
        body.appendChild(FC.charts.card({ title: 'Revisões previstas (próximos 30 dias)', subtitle: 'Atrasados contam no dia de hoje', chart: forecast, legend: [{ label: 'Previstos', color: 'var(--series-1)' }, { label: 'Atrasados', color: 'var(--series-2)' }], columns: ['Dia', 'Previstos', 'Atrasados'], rows: fc.map((r) => [bucketTitle(r.start, 'day'), r.count - r.overdue, r.overdue]) }));
        body.appendChild(
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Desempenho por nível' }), h('p', { text: 'Taxa de acerto de todo o histórico. Expanda para achar exatamente onde está o problema.' })), button('Expandir tudo', { size: 'sm', variant: 'ghost', onClick: () => (FC.store.nodes.forEach((n) => openRows.add(n.id)), draw()) })),
            hierarchyTable(scope),
          ),
        );
      };

      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Estatísticas' }), h('p', { text: 'Tudo calculado do seu histórico de revisões neste navegador.' }))),
        h(
          'div',
          { class: 'row', style: { marginBottom: '18px' } },
          FC.ui.seg(
            S().PERIODS.map((p) => ({ value: p.key, label: p.label })),
            period,
            (v) => ((period = v), draw()),
          ),
          scopeSel,
        ),
        body,
      );
      draw();
    },
  };
})(typeof self !== 'undefined' ? self : this);
