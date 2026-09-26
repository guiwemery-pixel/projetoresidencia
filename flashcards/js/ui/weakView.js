/*
 * Pontos fracos: "Onde estou tendo mais dificuldade?", "O que eu preciso estudar
 * novamente?", indicadores (maior dificuldade atual/recente, maior evolução e
 * maior piora), tendências e o detalhe de cada tema. Tudo vem do histórico real.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  let tab = 'current';

  function trendText(t) {
    if (!t) return { text: 'Dados insuficientes para tendência', cls: 'muted' };
    const seq = t.points.map((p) => U.pct(p)).join(' → ');
    if (t.direction === 'up') return { text: 'Antes ' + U.pct(t.before) + ' · Agora ' + U.pct(t.now) + ' · ↑ melhora significativa', cls: 'trend-up', seq };
    if (t.direction === 'down') return { text: 'Antes ' + U.pct(t.before) + ' · Agora ' + U.pct(t.now) + ' · ↓ queda recente', cls: 'trend-down', seq };
    if (t.direction === 'uncertain') return { text: U.pct(t.before) + ' → ' + U.pct(t.now) + ' · variação ainda sem significância', cls: 'ink2', seq };
    return { text: seq + ' · desempenho estável', cls: 'ink2', seq };
  }

  function indicatorBox(label, iconName, agg, valueFn, empty) {
    return h(
      'button',
      { type: 'button', class: 'indicator', style: { cursor: agg ? 'pointer' : 'default', textAlign: 'left', font: 'inherit', color: 'inherit' }, onclick: () => agg && FC.app.go('/pontos-fracos/' + agg.nodeId), disabled: !agg },
      h('span', { class: 'k' }, icon(iconName, 15), label),
      h('span', { class: 'v', text: agg ? FC.areas.title(agg.nodeId) : empty || 'Dados insuficientes' }),
      agg ? h('span', { class: 'small ink2', text: valueFn(agg) }) : null,
    );
  }

  function weakRow(agg, rank) {
    const path = FC.areas.path(agg.nodeId);
    const node = path[path.length - 1];
    const tr = trendText(agg.trend);
    return h(
      'button',
      { type: 'button', class: 'weak-item', onclick: () => FC.app.go('/pontos-fracos/' + agg.nodeId) },
      h('span', { class: 'weak-rank', text: String(rank) }),
      h(
        'span',
        { style: { minWidth: 0 } },
        h('div', { class: 'weak-title', text: FC.areas.title(agg.nodeId) }),
        h('div', { class: 'weak-sub', text: path.slice(0, -1).map((n) => n.name).join(' › ') + ' · ' + FC.areas.LEVEL_LABELS[node.level] }),
        h('div', { class: 'weak-sub ' + tr.cls, text: agg.recentErrors + ' erros recentes · ' + (agg.trend ? tr.text : agg.n + ' revisões em ' + agg.reviewedCards + ' cards') }),
      ),
      h('span', { class: 'weak-value' }, h('strong', { text: U.pct(agg.accuracy) }), h('div', { class: 'tiny muted', text: agg.n + ' revisões' }), FC.ui.meter(agg.accuracy)),
    );
  }

  function studyAgainPanel() {
    const res = FC.analysis.studyAgain();
    const panel = h('section', { class: 'panel focus-card stack' }, h('div', { class: 'row' }, icon('target', 18), h('h2', { text: 'O que eu preciso estudar novamente?' })));
    if (!res.enoughData) {
      panel.appendChild(h('p', { class: 'ink2', text: 'Dados insuficientes para avaliar os temas. Continue revisando: cada tema precisa de pelo menos ' + FC.settings.get('weakMinReviews') + ' revisões em ' + FC.settings.get('weakMinCards') + ' cards.' }));
      return panel;
    }
    if (!res.items.length) {
      panel.appendChild(FC.ui.callout('Nenhum tema com necessidade clara de revisão agora.', 'good', 'check'));
      return panel;
    }
    FC.ui.add(panel, 
      h('p', { class: 'ink2', text: 'Você apresenta maior necessidade de revisão em:' }),
      h(
        'ol',
        { style: { margin: 0, paddingLeft: '20px' }, class: 'stack tight' },
        res.items.map((it) => h('li', null, h('a', { href: '#/pontos-fracos/' + it.agg.nodeId, text: it.title }), h('div', { class: 'small muted', text: it.reasons.join(' · ') }))),
      ),
      h('div', { class: 'row' }, h('span', { class: 'ink2', text: 'Recomendação principal:' }), h('strong', { text: 'Revisar ' + res.main.title })),
      h('div', { class: 'row' }, button('Revisar agora', { variant: 'primary', icon: 'zap', onClick: () => FC.launch.quick({ nodeIds: [res.main.agg.nodeId] }, 'Ponto fraco · ' + res.main.title, 'hardest') }), link('Ver detalhes', '#/pontos-fracos/' + res.main.agg.nodeId, { variant: 'ghost' })),
      h('p', { class: 'hint', text: 'Recomendação calculada pelos seus dados (acerto, erros recentes, esquecimentos, dificuldade, memória estimada e tendência), não por opinião da IA.' }),
    );
    return panel;
  }

  FC.views.weak = {
    title: 'Pontos fracos',
    render(ctx) {
      const { el } = ctx;
      const body = h('div', { class: 'stack loose' });
      const draw = () => {
        FC.ui.clear(body);
        const { ctx: actx, aggs } = FC.analysis.context();
        const ind = FC.analysis.indicators();
        body.appendChild(
          h(
            'div',
            { class: 'grid four' },
            indicatorBox('Maior dificuldade atual', 'target', ind.current, (a) => U.pct(a.accuracy) + ' em ' + a.n + ' revisões'),
            indicatorBox('Maior dificuldade recente', 'clock', ind.recent, (a) => U.pct(a.recentAccuracy) + ' nos últimos ' + actx.opts.recentDays + ' dias (' + a.recentN + ')'),
            indicatorBox('Maior evolução', 'up', ind.improved, (a) => U.pct(a.trend.before) + ' → ' + U.pct(a.trend.now), 'Sem melhora significativa ainda'),
            indicatorBox('Maior piora recente', 'downTrend', ind.worsened, (a) => U.pct(a.trend.before) + ' → ' + U.pct(a.trend.now), 'Nenhuma queda significativa'),
          ),
        );
        if (tab === 'current') {
          body.appendChild(studyAgainPanel());
          const weak = FC.performance.weakPoints(actx, aggs, 25);
          const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Onde estou tendo mais dificuldade?' }), h('p', { text: 'Nível mais específico com dados suficientes, ordenado pela necessidade de revisão.' }))));
          if (!weak.enoughData) panel.appendChild(h('p', { class: 'ink2', text: 'Dados insuficientes para avaliar os temas ainda.' }));
          else if (!weak.items.length) panel.appendChild(FC.ui.callout('Nenhum tema com dificuldade clara. ' + weak.eligibleCount + ' temas avaliados.', 'good', 'check'));
          else panel.appendChild(h('div', { class: 'weak-list' }, weak.items.map((a, i) => weakRow(a, i + 1))));
          body.appendChild(panel);
        } else if (tab === 'recent') {
          const minRecent = Math.max(5, Math.ceil(actx.opts.minReviews / 2));
          const list = FC.performance.deepestEligible(actx, aggs, (a) => a.recentN >= minRecent).sort((a, b) => a.recentSmoothed - b.recentSmoothed).slice(0, 25);
          const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', { text: 'Desempenho recente' }), h('p', { text: 'Últimos ' + actx.opts.recentDays + ' dias, temas com pelo menos ' + minRecent + ' revisões no período.' }))));
          if (!list.length) panel.appendChild(h('p', { class: 'ink2', text: 'Dados insuficientes no período.' }));
          else
            panel.appendChild(
              h(
                'div',
                { class: 'weak-list' },
                list.map((a, i) =>
                  h(
                    'button',
                    { type: 'button', class: 'weak-item', onclick: () => FC.app.go('/pontos-fracos/' + a.nodeId) },
                    h('span', { class: 'weak-rank', text: String(i + 1) }),
                    h('span', { style: { minWidth: 0 } }, h('div', { class: 'weak-title', text: FC.areas.title(a.nodeId) }), h('div', { class: 'weak-sub', text: FC.areas.breadcrumb(a.nodeId) })),
                    h('span', { class: 'weak-value' }, h('strong', { text: U.pct(a.recentAccuracy) }), h('div', { class: 'tiny muted', text: a.recentN + ' revisões · ' + a.recentErrors + ' erros' }), FC.ui.meter(a.recentAccuracy)),
                  ),
                ),
              ),
            );
          body.appendChild(panel);
        } else {
          const list = FC.performance.deepestEligible(actx, aggs, (a) => a.trend && a.eligible);
          const up = list.filter((a) => a.trend.direction === 'up').sort((a, b) => b.trend.diff - a.trend.diff);
          const down = list.filter((a) => a.trend.direction === 'down').sort((a, b) => a.trend.diff - b.trend.diff);
          const stable = list.filter((a) => a.trend.direction === 'stable' || a.trend.direction === 'uncertain');
          const section = (title, items, emptyText) =>
            h(
              'section',
              { class: 'panel' },
              h('h2', { text: title, style: { marginBottom: '10px' } }),
              items.length
                ? h(
                    'div',
                    { class: 'list' },
                    items.map((a) => {
                      const t = trendText(a.trend);
                      return h('div', { class: 'list-item clickable', onclick: () => FC.app.go('/pontos-fracos/' + a.nodeId) }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 }, text: FC.areas.title(a.nodeId) }), h('div', { class: 'small ' + t.cls, text: t.text })), h('span', { class: 'small muted num', text: a.trend.n + ' revisões' }));
                    }),
                  )
                : h('p', { class: 'muted', text: emptyText }),
            );
          FC.ui.add(body, 
            section('↑ Melhora', up, 'Nenhuma melhora estatisticamente significativa ainda.'),
            section('↓ Piora', down, 'Nenhuma queda significativa.'),
            section('Estáveis ou sem variação significativa', stable, 'Nenhum tema com dados suficientes (mínimo 16 revisões).'),
            h('p', { class: 'hint', text: 'Tendência: compara a primeira e a segunda metade das últimas (até 60) revisões de cada tema com teste de duas proporções (|z| ≥ 1,96).' }),
          );
        }
        body.appendChild(
          h(
            'details',
            { class: 'panel flat' },
            h('summary', { class: 'label', style: { cursor: 'pointer' }, text: 'Como a dificuldade é calculada' }),
            h(
              'div',
              { class: 'stack tight small ink2', style: { marginTop: '10px' } },
              h('p', { text: 'Para cada nível da hierarquia (grande área, subárea, assunto, tema, subtema) o app soma o histórico real das revisões dos cards.' }),
              h('p', { text: 'A taxa de acerto é suavizada: com poucos dados ela fica perto da sua média geral, e revisões recentes pesam mais (meia-vida de 30 dias). Assim, 33% em 3 revisões não passa na frente de 55% em 80 revisões.' }),
              h('p', { text: 'A necessidade de revisão combina: acerto suavizado (40%), erros recentes (15%), esquecimentos (10%), dificuldade FSRS média (10%), memória estimada hoje (10%), cards errados duas vezes seguidas (10%) e tendência de piora (5%).' }),
              h('p', { text: 'Só aparece o nível mais específico com dados suficientes (mínimo de ' + FC.settings.get('weakMinReviews') + ' revisões e ' + FC.settings.get('weakMinCards') + ' cards, ajustável em Configurações). Sem dados no tema, sobe para o assunto, e assim por diante.' }),
            ),
          ),
        );
      };
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Pontos fracos' }), h('p', { text: 'Onde revisar primeiro, no nível mais específico possível.' }))),
        FC.ui.tabs(
          [
            { key: 'current', label: 'Atual' },
            { key: 'recent', label: 'Recentes' },
            { key: 'evolution', label: 'Evolução' },
          ],
          tab,
          (k) => ((tab = k), draw()),
        ),
        body,
      );
      if (!FC.store.logs.length) {
        FC.ui.clear(body).appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'target', title: 'Sem revisões ainda', text: 'Os pontos fracos aparecem depois que você revisar cards. A análise usa só o seu histórico real.', actions: [link('Começar revisão', '#/revisar', { variant: 'primary' })] })));
        return;
      }
      draw();
    },
  };

  // ── Detalhe de um tema ─────────────────────────────────────────────────────
  FC.views.weakDetail = {
    title: 'Ponto fraco',
    render(ctx) {
      const { el } = ctx;
      const nodeId = ctx.params.id;
      const node = FC.areas.get(nodeId);
      if (!node) return FC.app.go('/pontos-fracos');
      const title = FC.areas.title(nodeId);
      ctx.setTitle(title);
      const { ctx: actx, aggs } = FC.analysis.context();
      const agg = aggs.get(nodeId);
      const path = FC.areas.path(nodeId);
      const cards = FC.areas.cardsIn(nodeId);
      const now = Date.now();
      const reports = new Map(cards.map((c) => [c.id, FC.performance.cardReport(c, FC.store.cardLogs(c.id), now, actx.opts)]));
      const missed = cards.filter((c) => reports.get(c.id).errors > 0).sort((a, b) => FC.performance.cardPriority(b, reports.get(b.id)) - FC.performance.cardPriority(a, reports.get(a.id)));
      const subject = path.find((n) => n.level === 2);
      const levels = h(
        'div',
        { class: 'stack tight' },
        path.map((n) => h('div', { class: 'row between small' }, h('span', { class: 'muted', text: FC.areas.LEVEL_LABELS[n.level] + ':' }), h('a', { href: '#/pontos-fracos/' + n.id, text: n.name }))),
      );
      const tr = trendText(agg && agg.trend);
      const enough = agg && agg.eligible;
      const figures = h(
        'div',
        { class: 'stack tight' },
        h('div', { class: 'row between' }, h('span', { class: 'ink2', text: 'Desempenho' }), h('strong', { class: 'hero', style: { fontSize: '2.2rem' }, text: agg && agg.n ? U.pct(agg.accuracy) : '—' })),
        FC.ui.meter(agg ? agg.accuracy : 0, 'lg'),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Cards' }), h('span', { class: 'num', text: U.fmtNum(cards.length) })),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Revisões' }), h('span', { class: 'num', text: U.fmtNum(agg ? agg.n : 0) })),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Erros recentes (' + actx.opts.recentDays + ' dias)' }), h('span', { class: 'num', text: U.fmtNum(agg ? agg.recentErrors : 0) })),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Esquecimentos' }), h('span', { class: 'num', text: U.fmtNum(agg ? agg.lapses : 0) })),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Memória estimada hoje' }), h('span', { class: 'num', text: agg && agg.meanR != null ? U.pct(agg.meanR) : '—' })),
        h('div', { class: 'row between small' }, h('span', { class: 'muted', text: 'Dificuldade FSRS média' }), h('span', { class: 'num', text: agg && agg.meanD != null ? U.fmtNum(agg.meanD, 1) + ' / 10' : '—' })),
        h('p', { class: 'small ' + tr.cls, text: tr.text }),
        !enough ? FC.ui.callout('Dados insuficientes para avaliar este tópico (mínimo ' + actx.opts.minReviews + ' revisões e ' + actx.opts.minCards + ' cards).', 'warn') : null,
      );
      const children = FC.areas.children(nodeId).map((k) => aggs.get(k.id)).filter(Boolean);
      const childTable = children.length
        ? h(
            'section',
            { class: 'panel' },
            h('h2', { text: 'Por ' + FC.areas.LEVEL_LABELS[node.level + 1].toLowerCase(), style: { marginBottom: '10px' } }),
            h(
              'div',
              { class: 'tree' },
              children
                .sort((a, b) => (a.accuracy == null) - (b.accuracy == null) || (a.accuracy || 0) - (b.accuracy || 0))
                .map((a) =>
                  h(
                    'div',
                    { class: 'tree-row' + (a.isWeak ? ' perf-weak' : '') },
                    h('div', { class: 'tree-name' }, h('a', { class: 'label-btn', href: '#/pontos-fracos/' + a.nodeId, text: FC.areas.get(a.nodeId).name }), a.isWeak ? h('span', { class: 'badge serious', text: 'ponto fraco' }) : null),
                    h('div', { class: 'tree-stats' }, h('span', { class: 'hide-sm', text: a.n + ' revisões' }), h('span', { class: 'perf' }, h('span', { class: 'bar-cell' }, h('span', { style: { width: Math.round((a.accuracy || 0) * 100) + '%' } })), h('span', { text: a.n ? U.pct(a.accuracy) : '—' }))),
                  ),
                ),
            ),
          )
        : null;
      const repeated = missed.filter((c) => reports.get(c.id).errors >= 2).length;
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('p', { class: 'crumb', text: FC.areas.breadcrumb(nodeId) }), h('h1', { text: title }))),
        h(
          'div',
          { class: 'row', style: { marginBottom: '16px' } },
          button('Revisar cards que errei (' + missed.length + ')', { variant: 'primary', icon: 'refresh', disabled: !missed.length, onClick: () => FC.launch.quickIds(missed.map((c) => c.id), 'Erros · ' + title) }),
          button('Revisar todo o tema', { icon: 'zap', onClick: () => FC.launch.quick({ nodeIds: [nodeId] }, 'Tema · ' + title, 'hardest') }),
          subject && subject.id !== nodeId ? button('Revisar assunto completo', { icon: 'layers', onClick: () => FC.launch.quick({ nodeIds: [subject.id] }, 'Assunto · ' + subject.name) }) : null,
          link('Gerar novos cards', '#/gerar?weak=' + nodeId, { icon: 'sparkles' }),
          link('Ver estatísticas', '#/estatisticas?node=' + nodeId, { icon: 'chart', variant: 'ghost' }),
        ),
        repeated >= 2 && agg && agg.isWeak ? h('div', { style: { marginBottom: '16px' } }, FC.ui.callout(h('span', null, 'Você errou este tema várias vezes (' + repeated + ' cards com 2+ erros). ', h('a', { href: '#/gerar?weak=' + nodeId, text: 'Gerar cards complementares' }), ' direcionados ao que você mais erra.'), 'warn', 'sparkles')) : null,
        h('div', { class: 'grid two', style: { marginBottom: '16px' } }, h('section', { class: 'panel stack' }, h('h2', { text: 'Classificação' }), levels), h('section', { class: 'panel' }, figures)),
        childTable ? h('div', { style: { marginBottom: '16px' } }, childTable) : null,
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', { text: 'Cards (mais críticos primeiro)' })),
          FC.cardList.create({
            cards: () => FC.areas.cardsIn(nodeId).sort((a, b) => FC.performance.cardPriority(b, reports.get(b.id) || {}) - FC.performance.cardPriority(a, reports.get(a.id) || {})),
            label: title,
            extra: (c) => {
              const r = reports.get(c.id);
              if (!r || !r.n) return h('span', { class: 'tiny muted', text: 'sem revisões' });
              return h('span', { class: 'tiny ' + (r.accuracy < 0.6 ? 'trend-down' : 'ink2'), text: r.correct + '/' + r.n + ' acertos' + (r.consecutiveErrors >= 2 ? ' · ' + r.consecutiveErrors + ' erros seguidos' : '') });
            },
          }).el,
        ),
      );
    },
  };
})(typeof self !== 'undefined' ? self : this);
