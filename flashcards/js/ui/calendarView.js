/*
 * Calendário de revisões: cards previstos por dia (cor mais forte = mais carga),
 * atrasados no dia de hoje e, nos dias passados, as revisões feitas.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button } = FC.ui;
  const U = FC.util;

  let cursor = null;

  function dayDetail(date) {
    const s = FC.settings.get();
    const start = U.dayStart(date.getTime() + 12 * U.HOUR, s.rolloverHour);
    const end = U.addDays(start, 1);
    const today = U.dayStart(Date.now(), s.rolloverHour);
    const cards = FC.cards.all().filter((c) => {
      if (c.suspended || !c.state || c.state === 'new' || c.dueDate == null) return false;
      const due = c.dueDate < today ? today : c.dueDate;
      return due >= start && due < end;
    });
    const logs = FC.store.logs.filter((l) => l.date >= start && l.date < end);
    const groups = U.groupBy(cards, (c) => (c.subjectId ? FC.areas.title(c.subjectId) : FC.areas.title(c.nodeId)));
    const content = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'ink2', text: U.plural(cards.length, 'card previsto', 'cards previstos') + (logs.length ? ' · ' + U.plural(logs.length, 'revisão feita', 'revisões feitas') + ' (' + U.pct(logs.filter((l) => l.rating >= 2).length / logs.length) + ' de acerto)' : '') }),
      cards.length
        ? h(
            'div',
            { class: 'list' },
            [...groups.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([title, list]) => h('div', { class: 'list-item' }, h('span', { class: 'grow', text: title }), h('strong', { class: 'num', text: String(list.length) }))),
          )
        : null,
    );
    const m = FC.ui.modal({
      title: date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
      content,
      actions: [button('Fechar', { onClick: () => m.close() }), cards.length ? button('Quick Review destes', { variant: 'primary', icon: 'zap', onClick: () => (m.close(), FC.launch.quickIds(U.shuffle(cards.map((c) => c.id)), 'Previstos para ' + U.formatDate(start, false))) }) : null].filter(Boolean),
    });
  }

  FC.views.calendar = {
    title: 'Calendário',
    render(ctx) {
      const { el } = ctx;
      if (!cursor) {
        const d = new Date();
        cursor = { y: d.getFullYear(), m: d.getMonth() };
      }
      const body = h('div');
      const draw = () => {
        const s = FC.settings.get();
        const now = Date.now();
        const data = FC.statistics.calendarMonth(FC.cards.all(), FC.store.logs, cursor.y, cursor.m, now, s.rolloverHour);
        const todayKey = U.dayKey(now, s.rolloverHour);
        const max = Math.max(1, ...[...data.values()].map((d) => d.due));
        const level = (n) => (!n ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
        const first = new Date(cursor.y, cursor.m, 1);
        const startDow = first.getDay();
        const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
        const grid = h('div', { class: 'cal-grid' }, U.WEEKDAYS.map((w) => h('div', { class: 'cal-dow', text: w })));
        for (let i = 0; i < startDow; i++) grid.appendChild(h('div'));
        let monthDue = 0;
        let heavy = null;
        for (let d = 1; d <= days; d++) {
          const date = new Date(cursor.y, cursor.m, d);
          const key = cursor.y + '-' + String(cursor.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const info = data.get(key) || { due: 0, overdue: 0, done: 0 };
          const isPast = key < todayKey;
          monthDue += isPast ? 0 : info.due;
          if (!isPast && (!heavy || info.due > heavy.due)) heavy = { d, due: info.due };
          grid.appendChild(
            h(
              'button',
              { type: 'button', class: 'cal-day' + (key === todayKey ? ' today' : ''), dataset: { level: String(isPast ? 0 : level(info.due)) }, onclick: () => dayDetail(date), 'aria-label': d + ': ' + info.due + ' previstos' + (info.done ? ', ' + info.done + ' feitas' : '') },
              h('span', { class: 'd', text: String(d) }),
              info.overdue ? h('span', { class: 'badge crit over', text: info.overdue + ' atras.' }) : null,
              isPast ? (info.done ? h('span', { class: 'n', text: String(info.done) }) : null) : info.due ? h('span', { class: 'n', text: String(info.due) }) : null,
              isPast ? (info.done ? h('span', { class: 's', text: 'feitas' }) : null) : info.due ? h('span', { class: 's', text: 'previstos' }) : null,
            ),
          );
        }
        FC.ui.add(FC.ui.clear(body), 
          h(
            'div',
            { class: 'cal-head' },
            button('', { icon: 'left', variant: 'ghost', title: 'Mês anterior', onClick: () => ((cursor.m = cursor.m === 0 ? 11 : cursor.m - 1), cursor.m === 11 && cursor.y--, draw()) }),
            h('h2', { text: U.MONTHS_LONG[cursor.m] + ' ' + cursor.y }),
            button('', { icon: 'right', variant: 'ghost', title: 'Próximo mês', onClick: () => ((cursor.m = cursor.m === 11 ? 0 : cursor.m + 1), cursor.m === 0 && cursor.y++, draw()) }),
            button('Hoje', { size: 'sm', variant: 'ghost', onClick: () => ((cursor = null), ctx.rerender()) }),
            h('span', { class: 'grow' }),
            h('span', { class: 'cal-scale' }, 'menos', [1, 2, 3, 4].map((l) => h('i', { style: { background: 'color-mix(in srgb, var(--accent) ' + [10, 22, 38, 56][l - 1] + '%, var(--surface))' } })), 'mais'),
          ),
          h('div', { class: 'panel' }, grid),
          h('p', { class: 'small ink2', style: { marginTop: '10px' }, text: U.plural(monthDue, 'revisão prevista', 'revisões previstas') + ' no restante do mês' + (heavy && heavy.due ? ' · dia mais carregado: ' + heavy.d + ' (' + heavy.due + ')' : '') + '. Clique num dia para ver a carga por assunto.' }),
        );
      };
      FC.ui.add(el, h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Calendário de revisões' }), h('p', { text: 'Carga prevista pelo scheduler. Atrasados aparecem no dia de hoje.' }))), body);
      draw();
    },
  };
})(typeof self !== 'undefined' ? self : this);
