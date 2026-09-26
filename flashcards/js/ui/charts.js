/*
 * Gráficos em SVG (sem bibliotecas): linha, colunas (empilhadas ou não) e sparkline.
 * Marcas finas (linha 2px, colunas ≤ 24px com topo arredondado de 4px e 2px de
 * espaço entre segmentos), grade discreta, rótulo só no último ponto, tooltip no
 * hover/teclado e tabela alternativa (os valores nunca dependem só do hover).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, icon } = FC.ui;
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    return el;
  }

  /** Escala "redonda": passo 1/2/2,5/5 × 10^n (inteiro quando os dados são contagens). */
  function niceScale(dataMax, integer) {
    if (!(dataMax > 0)) return integer ? { max: 4, step: 1 } : { max: 1, step: 0.25 };
    const rough = dataMax / 4;
    const exp = Math.pow(10, Math.floor(Math.log10(rough)));
    let step = null;
    for (const c of [1, 2, 2.5, 5, 10]) {
      const cand = c * exp;
      if (integer && !Number.isInteger(Math.round(cand * 1e9) / 1e9)) continue;
      if (cand >= rough) {
        step = cand;
        break;
      }
    }
    if (step == null) step = 10 * exp;
    if (integer) step = Math.max(1, step);
    return { max: Math.ceil(dataMax / step - 1e-9) * step, step };
  }

  const niceMax = (max, integer) => niceScale(max, integer).max;

  function ticks(scale) {
    const out = [];
    for (let v = 0; v <= scale.max + scale.step / 1000; v += scale.step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function tickLabel(v, scale, fmt) {
    if (scale.step < 1 && scale.max > 1) return FC.util.fmtNum(v, 1);
    return fmt(v, true);
  }

  /** Monta o contêiner que se redesenha quando muda de largura. */
  function responsive(draw, height) {
    const wrap = h('div', { class: 'chart' });
    const tip = h('div', { class: 'chart-tip hidden' });
    let lastW = 0;
    const render = () => {
      const w = Math.max(240, Math.round(wrap.clientWidth || 600));
      if (w === lastW) return;
      lastW = w;
      wrap.querySelectorAll('svg').forEach((x) => x.remove());
      const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + height, width: w, height, role: 'img' });
      wrap.insertBefore(svg, tip);
      draw(svg, w, height, tip, wrap);
    };
    wrap.appendChild(tip);
    if (root.ResizeObserver) new ResizeObserver(() => render()).observe(wrap);
    requestAnimationFrame(render);
    return wrap;
  }

  function showTip(tip, wrap, x, y, title, rows) {
    tip.innerHTML = '';
    tip.appendChild(h('div', { class: 't', text: title }));
    for (const r of rows) tip.appendChild(h('div', { class: 'r' }, h('span', { class: 'key', style: { background: r.color } }), h('strong', { text: r.value }), h('span', { class: 'muted', text: r.label })));
    tip.classList.remove('hidden');
    const ww = wrap.clientWidth;
    const tw = tip.offsetWidth;
    let left = x + 12;
    if (left + tw > ww) left = x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, y - 10) + 'px';
  }

  const hideTip = (tip) => tip.classList.add('hidden');

  /**
   * Linha única. opts: { points:[{label, value|null}], format(v), max (fixo, ex.: 1 para %),
   *  height, color, name }
   */
  function line(opts) {
    const H = opts.height || 190;
    const color = opts.color || 'var(--series-1)';
    const fmt = opts.format || ((v) => String(v));
    return responsive((svg, W, _H, tip, wrap) => {
      const pts = opts.points;
      const pad = { l: 40, r: 44, t: 14, b: 26 };
      const pw = W - pad.l - pad.r;
      const ph = H - pad.t - pad.b;
      const values = pts.map((p) => p.value).filter((v) => v != null);
      const scale = opts.max != null ? { max: opts.max, step: opts.max / 4 } : niceScale(Math.max(...values, 0), opts.integer);
      const max = scale.max;
      const x = (i) => pad.l + (pts.length <= 1 ? pw / 2 : (pw * i) / (pts.length - 1));
      const y = (v) => pad.t + ph - (ph * v) / max;
      svg.setAttribute('aria-label', (opts.name || 'Gráfico') + ': ' + values.length + ' pontos');
      for (const t of ticks(scale)) {
        svg.appendChild(s('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'grid-line' }));
        const lab = s('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text' });
        lab.textContent = tickLabel(t, scale, fmt);
        svg.appendChild(lab);
      }
      const every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(pw / 70))));
      pts.forEach((p, i) => {
        if (i % every !== 0 && i !== pts.length - 1) return;
        if (i !== pts.length - 1 && pts.length - 1 - i < every * 0.6) return;
        const t = s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'axis-text' });
        t.textContent = p.label;
        svg.appendChild(t);
      });
      if (opts.spanGaps) {
        // Liga os pontos com dados (dias sem revisão não viram zero) e marca cada ponto
        const idx = pts.map((p, i) => (p.value == null ? -1 : i)).filter((i) => i >= 0);
        const d2 = idx.map((i, k) => (k ? 'L' : 'M') + x(i) + ',' + y(pts[i].value)).join('');
        svg.appendChild(s('path', { d: d2, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        if (idx.length <= 45) for (const i of idx) svg.appendChild(s('circle', { cx: x(i), cy: y(pts[i].value), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      }
      // Segmentos (quebra nos buracos)
      let d = '';
      let area = '';
      let segStart = null;
      pts.forEach((p, i) => {
        if (p.value == null) {
          if (segStart != null) area += 'L' + x(i - 1) + ',' + y(0) + 'Z';
          segStart = null;
          return;
        }
        if (segStart == null) {
          d += 'M' + x(i) + ',' + y(p.value);
          area += 'M' + x(i) + ',' + y(0) + 'L' + x(i) + ',' + y(p.value);
          segStart = i;
        } else {
          d += 'L' + x(i) + ',' + y(p.value);
          area += 'L' + x(i) + ',' + y(p.value);
        }
        if (i === pts.length - 1) area += 'L' + x(i) + ',' + y(0) + 'Z';
      });
      if (!opts.spanGaps) {
        if (opts.area !== false) svg.appendChild(s('path', { d: area, fill: color, 'fill-opacity': '0.1', stroke: 'none' }));
        svg.appendChild(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
      // Pontos isolados (sem vizinhos) viram marcadores
      if (!opts.spanGaps) pts.forEach((p, i) => {
        if (p.value == null) return;
        const prev = pts[i - 1];
        const next = pts[i + 1];
        if ((!prev || prev.value == null) && (!next || next.value == null)) svg.appendChild(s('circle', { cx: x(i), cy: y(p.value), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      });
      // Rótulo no último valor
      let lastIdx = -1;
      for (let i = pts.length - 1; i >= 0; i--)
        if (pts[i].value != null) {
          lastIdx = i;
          break;
        }
      if (lastIdx >= 0) {
        svg.appendChild(s('circle', { cx: x(lastIdx), cy: y(pts[lastIdx].value), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
        const lab = s('text', { x: x(lastIdx) + 8, y: y(pts[lastIdx].value) + 4, class: 'end-label' });
        lab.textContent = fmt(pts[lastIdx].value);
        svg.appendChild(lab);
      }
      // Hover / teclado
      const cross = s('line', { y1: pad.t, y2: pad.t + ph, class: 'crosshair', visibility: 'hidden' });
      const dot = s('circle', { r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
      svg.appendChild(cross);
      svg.appendChild(dot);
      const overlay = s('rect', { x: pad.l - 10, y: 0, width: pw + 20, height: H, class: 'hit' });
      svg.appendChild(overlay);
      svg.setAttribute('tabindex', '0');
      let idx = lastIdx;
      const show = (i) => {
        idx = Math.max(0, Math.min(pts.length - 1, i));
        const p = pts[idx];
        cross.setAttribute('x1', x(idx));
        cross.setAttribute('x2', x(idx));
        cross.setAttribute('visibility', 'visible');
        if (p.value != null) {
          dot.setAttribute('cx', x(idx));
          dot.setAttribute('cy', y(p.value));
          dot.setAttribute('visibility', 'visible');
        } else dot.setAttribute('visibility', 'hidden');
        showTip(tip, wrap, x(idx), p.value != null ? y(p.value) : pad.t, p.title || p.label, [{ color, value: p.value == null ? 'sem dados' : fmt(p.value), label: p.sub || opts.name || '' }]);
      };
      const hide = () => {
        cross.setAttribute('visibility', 'hidden');
        dot.setAttribute('visibility', 'hidden');
        hideTip(tip);
      };
      overlay.addEventListener('pointermove', (e) => {
        const r = svg.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        show(Math.round(((px - pad.l) / pw) * (pts.length - 1)));
      });
      overlay.addEventListener('pointerleave', hide);
      svg.addEventListener('focus', () => show(idx < 0 ? 0 : idx));
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') show(idx + 1);
        else if (e.key === 'ArrowLeft') show(idx - 1);
      });
    }, H);
  }

  function roundedTopRect(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (hgt <= 0) return '';
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }

  /**
   * Colunas. opts: { points:[{label, title, values:[n...]}], series:[{label, color}],
   *  format(v), height, stacked (padrão true) }
   */
  function bars(opts) {
    const H = opts.height || 190;
    const fmt = opts.format || ((v) => FC.util.fmtNum(v));
    return responsive((svg, W, _H, tip, wrap) => {
      const pts = opts.points;
      const pad = { l: 40, r: 12, t: 14, b: 26 };
      const pw = W - pad.l - pad.r;
      const ph = H - pad.t - pad.b;
      const totals = pts.map((p) => p.values.reduce((a, b) => a + (b || 0), 0));
      const scale = niceScale(Math.max(...totals, 0), opts.integer !== false);
      const max = scale.max;
      const y = (v) => pad.t + ph - (ph * v) / max;
      svg.setAttribute('aria-label', opts.name || 'Gráfico de colunas');
      for (const t of ticks(scale)) {
        svg.appendChild(s('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'grid-line' }));
        const lab = s('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-text' });
        lab.textContent = tickLabel(t, scale, fmt);
        svg.appendChild(lab);
      }
      const band = pw / Math.max(1, pts.length);
      const bw = Math.max(2, Math.min(24, band - 2));
      const every = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(pw / 70))));
      pts.forEach((p, i) => {
        const cx = pad.l + band * i + band / 2;
        const g = s('g', { class: 'bar-group', tabindex: '0' });
        let base = 0;
        const parts = p.values.map((v, k) => ({ v: v || 0, k })).filter((x) => x.v > 0);
        parts.forEach((part, j) => {
          const top = y(base + part.v);
          const bottom = y(base);
          const gap = j > 0 ? 2 : 0;
          const hgt = Math.max(0, bottom - top - gap);
          const isTop = j === parts.length - 1;
          const d = isTop ? roundedTopRect(cx - bw / 2, top, bw, hgt, 4) : 'M' + (cx - bw / 2) + ',' + top + 'h' + bw + 'v' + hgt + 'h' + -bw + 'Z';
          if (d) g.appendChild(s('path', { d, fill: opts.series[part.k].color, class: 'bar-mark' }));
          base += part.v;
        });
        const hit = s('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ph, class: 'hit' });
        g.insertBefore(hit, g.firstChild);
        const rows = opts.series.map((ser, k) => ({ color: ser.color, value: fmt(p.values[k] || 0), label: ser.label }));
        const onShow = () => showTip(tip, wrap, cx, y(totals[i]), p.title || p.label, rows);
        g.addEventListener('pointerenter', onShow);
        g.addEventListener('focus', onShow);
        g.addEventListener('pointerleave', () => hideTip(tip));
        g.addEventListener('blur', () => hideTip(tip));
        svg.appendChild(g);
        if (i % every === 0 || i === pts.length - 1) {
          if (i !== pts.length - 1 && pts.length - 1 - i < every * 0.6) return;
          const t = s('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis-text' });
          t.textContent = p.label;
          svg.appendChild(t);
        }
      });
    }, H);
  }

  function sparkline(values, opts = {}) {
    const W = opts.width || 120;
    const H = opts.height || 28;
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true', class: 'spark' });
    const vals = values.map((v) => (v == null ? null : v));
    const nums = vals.filter((v) => v != null);
    if (nums.length < 2) return svg;
    const max = opts.max != null ? opts.max : Math.max(...nums);
    const min = opts.min != null ? opts.min : Math.min(0, ...nums);
    const x = (i) => 2 + ((W - 4) * i) / (vals.length - 1);
    const y = (v) => H - 3 - ((H - 6) * (v - min)) / (max - min || 1);
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += (pen ? 'L' : 'M') + x(i) + ',' + y(v);
      pen = true;
    });
    svg.appendChild(s('path', { d, fill: 'none', stroke: opts.color || 'var(--axis)', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const last = vals.length - 1;
    if (vals[last] != null) svg.appendChild(s('circle', { cx: x(last), cy: y(vals[last]), r: 2.5, fill: 'var(--accent)' }));
    return svg;
  }

  /** Painel com título, legenda, gráfico e alternância para tabela. */
  function card(opts) {
    const table = h(
      'div',
      { class: 'table-wrap hidden' },
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, opts.columns.map((c, i) => h('th', { class: i ? 'num' : '', text: c })))),
        h('tbody', null, opts.rows.map((r) => h('tr', null, r.map((v, i) => h('td', { class: i ? 'num' : '', text: v }))))),
      ),
    );
    const toggle = FC.ui.button('Tabela', { size: 'sm', variant: 'ghost', icon: 'list' });
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      const showTable = table.classList.contains('hidden');
      table.classList.toggle('hidden', !showTable);
      opts.chart.classList.toggle('hidden', showTable);
      toggle.setAttribute('aria-pressed', String(showTable));
      toggle.querySelector('span').textContent = showTable ? 'Gráfico' : 'Tabela';
    });
    const legend = opts.legend && opts.legend.length > 1 ? h('div', { class: 'legend' }, opts.legend.map((l) => h('span', null, h('i', { class: l.line ? 'line' : '', style: { background: l.color } }), l.label))) : null;
    return h(
      'section',
      { class: 'panel chart-card' },
      h('div', { class: 'panel-head' }, h('div', null, h('h3', { text: opts.title }), opts.subtitle ? h('p', { text: opts.subtitle }) : null), toggle),
      legend ? h('div', { style: { marginBottom: '8px' } }, legend) : null,
      opts.chart,
      table,
    );
  }

  FC.charts = { line, bars, sparkline, card, niceMax, niceScale };
  void icon;
})(typeof self !== 'undefined' ? self : this);
