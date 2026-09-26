/*
 * Kit de interface: criação de elementos, ícones, diálogos, avisos, menus,
 * conteúdo rico dos cards (com imagens locais) e seletores reutilizáveis.
 * Textos vindos de dados sempre entram como texto (textContent), nunca como HTML;
 * o HTML dos cards passa antes pelo sanitizador.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const U = FC.util;
  FC.views = FC.views || {}; // cada tela (js/ui/*View.js) se registra aqui

  // ── Elementos ──────────────────────────────────────────────────────────────
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  /** Como Element.append, mas ignora null/false (o nativo escreveria "null"). */
  const add = (el, ...children) => append(el, children);

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // ── Ícones (traço 1,8px, 24×24) ────────────────────────────────────────────
  const ICONS = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    play: 'M7 4.5v15l12-7.5z',
    zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
    layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
    sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
    upload: 'M12 16V4m0 0-5 5m5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
    download: 'M12 4v12m0 0-5-5m5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    pause: 'M8 5v14M16 5v14',
    settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8.4 4.6-1.9-.6a6.8 6.8 0 0 0 0-2l1.9-.6-1.6-2.8-1.9.6a7 7 0 0 0-1.7-1l-.4-2H11l-.4 2a7 7 0 0 0-1.7 1l-1.9-.6-1.6 2.8 1.9.6a6.8 6.8 0 0 0 0 2l-1.9.6 1.6 2.8 1.9-.6a7 7 0 0 0 1.7 1l.4 2h3.2l.4-2a7 7 0 0 0 1.7-1l1.9.6z',
    chart: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
    target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    plus: 'M12 5v14M5 12h14',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
    copy: 'M8 8h11v12H8zM5 16H4V4h11v1',
    x: 'M6 6l12 12M18 6 6 18',
    right: 'm9 5 7 7-7 7',
    left: 'm15 5-7 7 7 7',
    down: 'm5 9 7 7 7-7',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    check: 'm5 12 5 5 9-10',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8h.01',
    alert: 'M12 3 2 20h20zM12 10v4m0 3h.01',
    file: 'M6 3h8l5 5v13H6zM14 3v5h5',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    refresh: 'M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4',
    folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
    flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
    up: 'M4 17l6-6 4 4 6-6M14 9h6v6',
    downTrend: 'M4 7l6 6 4-4 6 6M14 15h6V9',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    menu: 'M4 6h16M4 12h16M4 18h16',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
    database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  };

  function icon(name, size = 18) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', name === 'play' || name === 'star-fill' ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name] || ICONS.info);
    svg.appendChild(path);
    return svg;
  }

  function starIcon(filled, size = 18) {
    const svg = icon('star', size);
    if (filled) {
      svg.setAttribute('fill', 'currentColor');
      svg.style.color = 'var(--warn)';
    }
    return svg;
  }

  function button(label, opts = {}) {
    const cls = ['btn', opts.variant || '', opts.size || '', opts.block ? 'block' : '', !label && opts.icon ? 'icon' : ''].filter(Boolean).join(' ');
    return h('button', { type: opts.type || 'button', class: cls, onclick: opts.onClick, title: opts.title || null, 'aria-label': opts.ariaLabel || (!label ? opts.title : null), disabled: opts.disabled || null }, opts.icon ? icon(opts.icon, opts.iconSize || 17) : null, label ? h('span', null, label) : null);
  }

  function link(label, href, opts = {}) {
    return h('a', { class: ['btn', opts.variant || '', opts.size || ''].filter(Boolean).join(' '), href }, opts.icon ? icon(opts.icon, 17) : null, h('span', null, label));
  }

  // ── Avisos ─────────────────────────────────────────────────────────────────
  let toastBox = null;
  function toast(message, opts = {}) {
    if (!toastBox) {
      toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    const el = h('div', { class: 'toast' + (opts.error ? ' error' : '') }, h('span', null, message));
    if (opts.action) {
      el.appendChild(
        h('button', {
          type: 'button',
          text: opts.action.label,
          onclick: () => {
            opts.action.run();
            el.remove();
          },
        }),
      );
    }
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), opts.duration || (opts.action ? 6000 : 3200));
    return el;
  }

  const errorToast = (err) => toast(err && err.message ? err.message : String(err), { error: true, duration: 6000 });

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const openModals = [];

  function modal(opts) {
    const previous = document.activeElement;
    const close = (value) => {
      backdrop.remove();
      openModals.splice(openModals.indexOf(api), 1);
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus) previous.focus();
      if (opts.onClose) opts.onClose(value);
    };
    const onKey = (e) => {
      if (openModals[openModals.length - 1] !== api) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
      if (e.key === 'Tab') {
        const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const titleId = U.uid('t');
    const body = h('div', { class: 'modal-body' });
    const foot = h('div', { class: 'modal-foot' });
    const dialog = h(
      'div',
      { class: 'modal ' + (opts.size || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'modal-head' }, h('h2', { id: titleId, text: opts.title || '' }), button('', { icon: 'x', variant: 'ghost', title: 'Fechar', onClick: () => close(null) })),
      body,
      foot,
    );
    const backdrop = h('div', {
      class: 'modal-backdrop',
      onmousedown: (e) => {
        if (e.target === backdrop && !opts.sticky) close(null);
      },
    });
    backdrop.appendChild(dialog);
    const api = { el: dialog, body, foot, close };
    openModals.push(api);
    if (opts.content) append(body, [opts.content]);
    if (opts.actions) append(foot, opts.actions);
    else foot.remove();
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => {
      const target = dialog.querySelector('[autofocus], input, textarea, select, .editor-area') || dialog.querySelector('.modal-foot .btn.primary') || dialog;
      if (target && target.focus) target.focus();
    }, 20);
    return api;
  }

  const anyModalOpen = () => openModals.length > 0;

  function confirm(message, opts = {}) {
    return new Promise((resolve) => {
      let result = false;
      const m = modal({
        title: opts.title || 'Confirmar',
        size: 'narrow',
        content: h('p', { class: 'ink2', text: message }),
        onClose: () => resolve(result),
        actions: [
          button('Cancelar', { onClick: () => m.close() }),
          button(opts.okText || 'Confirmar', {
            variant: opts.danger ? 'danger' : 'primary',
            onClick: () => {
              result = true;
              m.close();
            },
          }),
        ],
      });
    });
  }

  function prompt(title, value = '', opts = {}) {
    return new Promise((resolve) => {
      let result = null;
      const input = h('input', { class: 'input', value, placeholder: opts.placeholder || '', autofocus: true });
      if (opts.list) input.setAttribute('list', U.uid('dl'));
      const submit = () => {
        result = input.value.trim();
        m.close();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      const content = h('div', { class: 'stack' }, opts.label ? h('label', { class: 'label', text: opts.label }) : null, input, opts.list ? datalist(input.getAttribute('list'), opts.list) : null, opts.hint ? h('p', { class: 'hint', text: opts.hint }) : null);
      const m = modal({ title, size: 'narrow', content, onClose: () => resolve(result || null), actions: [button('Cancelar', { onClick: () => m.close() }), button(opts.okText || 'Salvar', { variant: 'primary', onClick: submit })] });
      setTimeout(() => input.select(), 30);
    });
  }

  function datalist(id, values) {
    return h('datalist', { id }, [...new Set(values)].map((v) => h('option', { value: v })));
  }

  // ── Menu de ações ──────────────────────────────────────────────────────────
  function menu(anchor, items) {
    closeMenus();
    const el = h('div', { class: 'menu', role: 'menu' });
    for (const item of items) {
      if (item === '-') {
        el.appendChild(h('hr'));
        continue;
      }
      if (!item) continue;
      el.appendChild(
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: item.danger ? 'danger' : '',
            onclick: () => {
              closeMenus();
              item.run();
            },
          },
          item.icon ? icon(item.icon, 16) : null,
          h('span', null, item.label),
        ),
      );
    }
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = r.bottom + 4;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const first = el.querySelector('button');
    if (first) first.focus();
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', escClose, true);
    });
    function outside(e) {
      if (!el.contains(e.target)) closeMenus();
    }
    function escClose(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenus();
        anchor.focus();
      }
    }
    el._cleanup = () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', escClose, true);
    };
    return el;
  }

  function closeMenus() {
    document.querySelectorAll('.menu').forEach((m) => {
      if (m._cleanup) m._cleanup();
      m.remove();
    });
  }

  function moreButton(items, title = 'Mais ações') {
    const b = button('', { icon: 'more', variant: 'ghost', size: 'sm', title });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      menu(b, typeof items === 'function' ? items() : items);
    });
    return b;
  }

  // ── Conteúdo dos cards ─────────────────────────────────────────────────────
  const mediaCache = new Map();

  async function mediaUrl(name) {
    if (mediaCache.has(name)) return mediaCache.get(name);
    const p = (async () => {
      const row = await FC.db.get('media', name);
      if (!row || !row.blob) return null;
      return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.readAsDataURL(row.blob);
      });
    })();
    mediaCache.set(name, p);
    return p;
  }

  /** Elemento com o HTML do card já limpo; imagens do Anki carregadas do banco local. */
  function rich(html, cls) {
    const el = h('div', { class: 'rich' + (cls ? ' ' + cls : '') });
    el.innerHTML = FC.sanitize(html || '');
    for (const img of el.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (src && !/^(https?:|data:)/i.test(src)) {
        img.removeAttribute('src');
        img.alt = img.alt || src;
        mediaUrl(decodeURIComponent(src)).then((url) => {
          if (url) img.src = url;
        });
      }
    }
    return el;
  }

  const plain = (html, max) => (max ? U.truncate(U.stripHtml(html), max) : U.stripHtml(html));

  // ── Caminho na hierarquia ──────────────────────────────────────────────────
  function crumb(nodeId, opts = {}) {
    const names = FC.areas.pathNames(nodeId);
    if (!names.length) return h('span', { class: 'crumb', text: opts.empty || 'Sem classificação' });
    const parts = [];
    names.forEach((n, i) => {
      if (i) parts.push(' › ');
      parts.push(i === names.length - 1 ? h('b', { text: n }) : n);
    });
    return h('span', { class: 'crumb' }, parts);
  }

  /**
   * Seletor de caminho: 5 campos com sugestões dos nomes que já existem.
   * value: nomes; onChange(nomes). Retorna { el, get(), set(names) }.
   */
  function pathPicker(value, opts = {}) {
    const inputs = [];
    const lists = [];
    const wrap = h('div', { class: 'form-grid' });
    const labels = FC.areas.LEVEL_LABELS;
    const findNode = (level) => {
      let parent = null;
      for (let i = 0; i <= level; i++) {
        const name = inputs[i].value.trim();
        if (!name) return undefined;
        parent = FC.areas.findChild(parent ? parent.id : null, name);
        if (!parent) return undefined;
      }
      return parent;
    };
    const refresh = () => {
      for (let level = 0; level < labels.length; level++) {
        const parent = level === 0 ? null : findNode(level - 1);
        let names = [];
        if (level === 0) names = FC.areas.roots().map((n) => n.name);
        else if (parent) names = FC.areas.children(parent.id).map((n) => n.name);
        else names = [...FC.store.nodes.values()].filter((n) => n.level === level).map((n) => n.name);
        clear(lists[level]);
        for (const n of [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'))) lists[level].appendChild(h('option', { value: n }));
      }
    };
    labels.forEach((label, level) => {
      const id = U.uid('p');
      const listId = U.uid('dl');
      const input = h('input', { class: 'input', id, list: listId, value: (value && value[level]) || '', placeholder: level === 4 ? 'Opcional' : '', autocomplete: 'off' });
      input.addEventListener('input', () => {
        refresh();
        if (opts.onChange) opts.onChange(get());
      });
      const list = h('datalist', { id: listId });
      inputs.push(input);
      lists.push(list);
      wrap.appendChild(h('div', { class: 'field' + (level === 4 ? '' : '') }, h('label', { for: id, text: label }), input, list));
    });
    function get() {
      const out = [];
      for (const i of inputs) {
        const v = i.value.trim();
        if (!v) break;
        out.push(v);
      }
      return out;
    }
    function set(names) {
      inputs.forEach((i, idx) => (i.value = (names && names[idx]) || ''));
      refresh();
    }
    refresh();
    return { el: wrap, get, set, inputs };
  }

  function deckSelect(selectedId, opts = {}) {
    const sel = h('select', { class: 'select', id: opts.id || null });
    if (opts.allowAll) sel.appendChild(h('option', { value: '', text: opts.allLabel || 'Todos os baralhos' }));
    for (const d of FC.decks.all()) {
      if (d.archived && !opts.includeArchived) continue;
      sel.appendChild(h('option', { value: d.id, text: d.name.split('::').join(' › '), selected: d.id === selectedId }));
    }
    if (opts.allowNew) sel.appendChild(h('option', { value: '__new__', text: '+ Novo baralho…' }));
    if (opts.allowNew) {
      sel.addEventListener('change', async () => {
        if (sel.value !== '__new__') return;
        const name = await prompt('Novo baralho', '', { label: 'Nome (use "::" para sub-baralhos)', okText: 'Criar' });
        if (!name) {
          sel.value = selectedId || (sel.options[0] && sel.options[0].value) || '';
          return;
        }
        const deck = await FC.decks.create(name);
        sel.insertBefore(h('option', { value: deck.id, text: deck.name.split('::').join(' › ') }), sel.lastChild);
        sel.value = deck.id;
        sel.dispatchEvent(new Event('change'));
      });
    }
    return sel;
  }

  // ── Arquivos ───────────────────────────────────────────────────────────────
  function download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, multiple: !!multiple, style: { display: 'none' } });
      input.addEventListener('change', () => {
        resolve(multiple ? [...input.files] : input.files[0] || null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function dropzone(opts) {
    const el = h(
      'div',
      { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': opts.label },
      h('div', { class: 'empty-icon', style: { margin: '0 auto 10px', width: '48px', height: '48px', borderRadius: '14px', background: 'var(--accent-wash)', color: 'var(--accent)', display: 'grid', placeItems: 'center' } }, icon(opts.icon || 'upload', 24)),
      h('div', { style: { fontWeight: 600 }, text: opts.label }),
      opts.hint ? h('div', { class: 'hint', style: { marginTop: '4px' }, text: opts.hint }) : null,
    );
    const choose = async () => {
      const f = await pickFile(opts.accept);
      if (f) opts.onFile(f);
    };
    el.addEventListener('click', choose);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) opts.onFile(f);
    });
    return el;
  }

  // ── Pequenos componentes ───────────────────────────────────────────────────
  function empty(opts) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon(opts.icon || 'info', 24)),
      h('h3', { text: opts.title }),
      opts.text ? h('p', { text: opts.text }) : null,
      opts.actions ? h('div', { class: 'row' }, opts.actions) : null,
    );
  }

  function tile(label, value, sub, extra) {
    return h('div', { class: 'tile' }, h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }), sub ? h('span', { class: 'sub', text: sub }) : null, extra || null);
  }

  function seg(options, value, onChange) {
    const el = h('div', { class: 'seg', role: 'group' });
    for (const o of options) {
      el.appendChild(
        h('button', {
          type: 'button',
          'aria-pressed': String(o.value === value),
          text: o.label,
          onclick: () => {
            el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
            el.querySelector('[data-v="' + CSS.escape(String(o.value)) + '"]').setAttribute('aria-pressed', 'true');
            onChange(o.value);
          },
          dataset: { v: String(o.value) },
        }),
      );
    }
    return el;
  }

  function tabs(items, active, onChange) {
    const el = h('div', { class: 'tabs', role: 'tablist' });
    for (const it of items) {
      el.appendChild(
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(it.key === active),
          text: it.label,
          onclick: () => {
            el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', 'false'));
            el.querySelector('[data-k="' + CSS.escape(it.key) + '"]').setAttribute('aria-selected', 'true');
            onChange(it.key);
          },
          dataset: { k: it.key },
        }),
      );
    }
    return el;
  }

  function progressBar(fraction) {
    return h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((fraction || 0) * 100)) }, h('span', { style: { width: Math.round(U.clamp(fraction || 0, 0, 1) * 100) + '%' } }));
  }

  function meter(fraction, cls) {
    return h('div', { class: 'meter ' + (cls || '') }, h('span', { style: { width: Math.round(U.clamp(fraction || 0, 0, 1) * 100) + '%' } }));
  }

  function callout(text, kind, iconName) {
    return h('div', { class: 'callout ' + (kind || '') }, icon(iconName || (kind === 'warn' || kind === 'crit' ? 'alert' : 'info'), 18), h('div', null, text));
  }

  function field(label, control, hint) {
    const id = control.id || U.uid('f');
    control.id = id;
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);
  }

  function select(options, value, attrs) {
    const sel = h('select', Object.assign({ class: 'select' }, attrs || {}));
    for (const o of options) sel.appendChild(h('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) }));
    return sel;
  }

  function checkbox(label, checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!checked });
    if (onChange) input.addEventListener('change', () => onChange(input.checked));
    return { el: h('label', { class: 'check' }, input, h('span', null, label)), input };
  }

  function busy(btn, on, text) {
    if (on) {
      btn._label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '';
      btn.appendChild(h('span', { class: 'spinner' }));
      btn.appendChild(h('span', { text: text || 'Aguarde…' }));
    } else {
      btn.disabled = false;
      if (btn._label != null) btn.innerHTML = btn._label;
    }
  }

  function diffBadge(key) {
    if (!key) return null;
    const cls = { facil: 'good', media: 'warn', dificil: 'serious' }[key];
    return h('span', { class: 'badge ' + cls, text: FC.cards.EST_DIFFICULTY[key] });
  }

  function stateBadge(card) {
    if (card.suspended) return h('span', { class: 'badge', text: 'Suspenso' });
    const state = card.state || 'new';
    if (state === 'new') return h('span', { class: 'badge accent', text: 'Novo' });
    if (state === 'learning') return h('span', { class: 'badge warn', text: 'Aprendendo' });
    const due = card.dueDate;
    if (due != null && due <= Date.now()) return h('span', { class: 'badge crit', text: 'Para revisar' });
    return h('span', { class: 'badge', text: 'Revisão em ' + U.formatDate(due, false) });
  }

  FC.ui = {
    h,
    append,
    add,
    clear,
    icon,
    starIcon,
    button,
    link,
    toast,
    errorToast,
    modal,
    anyModalOpen,
    confirm,
    prompt,
    datalist,
    menu,
    closeMenus,
    moreButton,
    rich,
    mediaUrl,
    plain,
    crumb,
    pathPicker,
    deckSelect,
    download,
    pickFile,
    dropzone,
    empty,
    tile,
    seg,
    tabs,
    progressBar,
    meter,
    callout,
    field,
    select,
    checkbox,
    busy,
    diffBadge,
    stateBadge,
  };
})(typeof self !== 'undefined' ? self : this);
