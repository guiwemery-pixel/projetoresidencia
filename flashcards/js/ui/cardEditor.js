/*
 * Criar / editar card: editor com formatação simples (negrito, itálico, listas,
 * sub/sobrescrito) e opção de editar o HTML; baralho, classificação, tags,
 * dificuldade estimada, fonte e referência.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, field } = FC.ui;

  /** Editor rico. Retorna { el, get(), set(html), focus() } */
  function richEditor(html, placeholder) {
    const area = h('div', { class: 'editor-area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-placeholder': placeholder || '' });
    area.innerHTML = FC.sanitize(html || '');
    const code = h('textarea', { class: 'textarea hidden', spellcheck: 'false', 'aria-label': 'HTML' });
    let htmlMode = false;
    const cmd = (name, value) => () => {
      if (htmlMode) return;
      area.focus();
      document.execCommand(name, false, value || null);
    };
    const tb = (label, title, fn, style) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: fn, style: style || null, text: label });
    const toggle = tb('</>', 'Editar HTML', () => {
      htmlMode = !htmlMode;
      if (htmlMode) {
        code.value = area.innerHTML;
        area.classList.add('hidden');
        code.classList.remove('hidden');
        code.focus();
      } else {
        area.innerHTML = FC.sanitize(code.value);
        code.classList.add('hidden');
        area.classList.remove('hidden');
        area.focus();
      }
    });
    const toolbar = h(
      'div',
      { class: 'editor-toolbar', role: 'toolbar' },
      tb('B', 'Negrito (Ctrl+B)', cmd('bold')),
      tb('I', 'Itálico (Ctrl+I)', cmd('italic'), { fontStyle: 'italic' }),
      tb('U', 'Sublinhado (Ctrl+U)', cmd('underline'), { textDecoration: 'underline' }),
      tb('x₂', 'Subscrito', cmd('subscript')),
      tb('x²', 'Sobrescrito', cmd('superscript')),
      tb('•', 'Lista', cmd('insertUnorderedList')),
      tb('1.', 'Lista numerada', cmd('insertOrderedList')),
      tb('→', 'Inserir seta', cmd('insertText', '→')),
      tb('×', 'Inserir ×', cmd('insertText', '×')),
      tb('⌫', 'Limpar formatação', cmd('removeFormat')),
      h('span', { style: { flex: 1 } }),
      toggle,
    );
    // Colar como texto limpo (evita trazer estilos de outros sites)
    area.addEventListener('paste', (e) => {
      const htmlData = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      e.preventDefault();
      if (htmlData) document.execCommand('insertHTML', false, FC.sanitize(htmlData).replace(/ style="[^"]*"/g, ''));
      else document.execCommand('insertText', false, text);
    });
    const el = h('div', { class: 'editor' }, toolbar, area, code);
    return {
      el,
      area,
      get: () => (htmlMode ? FC.sanitize(code.value) : FC.sanitize(area.innerHTML)).replace(/^(<br>)+|(<br>)+$/g, '').trim(),
      set: (value) => {
        area.innerHTML = FC.sanitize(value || '');
        code.value = area.innerHTML;
      },
      focus: () => area.focus(),
    };
  }

  let lastDefaults = { deckId: null, path: [] };

  /**
   * Abre o editor. opts: { card?, deckId?, path? (nomes), nodeId? } → Promise<card|null>
   */
  function open(opts = {}) {
    return new Promise((resolve) => {
      const card = opts.card || null;
      const path = card ? FC.areas.pathNames(card.nodeId) : opts.path || (opts.nodeId ? FC.areas.pathNames(opts.nodeId) : lastDefaults.path);
      const deckId = card ? card.deckId : opts.deckId || lastDefaults.deckId || (FC.decks.all()[0] || {}).id;
      const front = richEditor(card ? card.front : '', 'Ex.: Classificação de Borrmann?');
      const back = richEditor(card ? card.back : '', 'Ex.: - 1: polipoide<br>- 2: ulcerado…');
      const deck = FC.ui.deckSelect(deckId, { allowNew: true });
      const picker = FC.ui.pathPicker(path);
      const tags = h('input', { class: 'input', value: card ? (card.tags || []).join(' ') : '', placeholder: 'ENARE revisar alta-prioridade' });
      const diff = FC.ui.select(
        [
          { value: '', label: 'Não definida' },
          { value: 'facil', label: 'Fácil' },
          { value: 'media', label: 'Média' },
          { value: 'dificil', label: 'Difícil' },
        ],
        card ? card.estDifficulty || '' : '',
      );
      const srcName = h('input', { class: 'input', value: card && card.source ? card.source.fileName || '' : '', placeholder: 'Tratado_de_Cirurgia.pdf' });
      const srcPage = h('input', { class: 'input', type: 'number', min: '1', value: card && card.source && card.source.page ? card.source.page : '', placeholder: '327' });
      const reference = h('input', { class: 'input', value: card ? card.reference || '' : '', placeholder: 'Ex.: Diretriz da SBC 2023' });
      const more = h(
        'details',
        { open: !!(card && (card.source || card.reference)) },
        h('summary', { class: 'label', style: { cursor: 'pointer' }, text: 'Fonte e referência' }),
        h('div', { class: 'form-grid', style: { marginTop: '10px' } }, field('Arquivo de origem', srcName), field('Página', srcPage), h('div', { class: 'full' }, field('Referência', reference))),
      );
      const content = h(
        'div',
        { class: 'stack loose' },
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Frente (pergunta)' }), front.el),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Verso (resposta)' }), back.el),
        h('div', { class: 'form-grid' }, field('Baralho', deck), field('Dificuldade estimada', diff, 'Separada do seu desempenho: diz o quão difícil é o conteúdo.')),
        h('div', { class: 'stack tight' }, h('span', { class: 'label', text: 'Classificação' }), picker.el),
        field('Tags', tags, 'Separe por espaço. Ex.: ENAMED erro-frequente'),
        more,
      );
      let result = null;
      const save = async (again) => {
        const f = front.get();
        const b = back.get();
        if (!FC.util.stripHtml(f).trim() && !/<img/i.test(f)) {
          FC.ui.toast('Escreva a pergunta (frente).', { error: true });
          front.focus();
          return;
        }
        if (deck.value === '__new__') return;
        const data = {
          front: f,
          back: b,
          deckId: deck.value,
          path: picker.get(),
          tags: tags.value,
          estDifficulty: diff.value || null,
          reference: reference.value.trim(),
          source: srcName.value.trim() || srcPage.value ? { fileName: srcName.value.trim(), page: parseInt(srcPage.value, 10) || null, sourceId: card && card.source ? card.source.sourceId : null } : null,
        };
        try {
          if (card) {
            if (card.estDifficulty === data.estDifficulty) delete data.estDifficulty;
            result = await FC.cards.update(card.id, data);
            FC.ui.toast('Card salvo.');
          } else {
            const created = await FC.cards.create(Object.assign({ origin: 'manual' }, data, { estDifficultyBy: data.estDifficulty ? 'manual' : null }));
            result = created;
            FC.ui.toast('Card criado.');
          }
          lastDefaults = { deckId: data.deckId, path: data.path };
          if (again) {
            front.set('');
            back.set('');
            front.focus();
            return;
          }
          m.close();
        } catch (e) {
          FC.ui.errorToast(e);
        }
      };
      const actions = [];
      if (card) {
        actions.push(
          h(
            'div',
            { class: 'left' },
            button('Excluir', {
              variant: 'danger',
              icon: 'trash',
              onClick: async () => {
                if (!(await FC.ui.confirm('Excluir este card e o histórico dele?', { danger: true, okText: 'Excluir' }))) return;
                await FC.cards.remove(card.id);
                FC.ui.toast('Card excluído.');
                result = null;
                m.close();
              },
            }),
          ),
        );
      }
      actions.push(button('Cancelar', { onClick: () => m.close() }));
      if (!card) actions.push(button('Salvar e criar outro', { onClick: () => save(true) }));
      actions.push(button(card ? 'Salvar' : 'Criar card', { variant: 'primary', onClick: () => save(false) }));
      const m = FC.ui.modal({ title: card ? 'Editar card' : 'Novo card', size: 'wide', content, actions, sticky: true, onClose: () => resolve(result) });
      m.el.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          save(false);
        }
      });
      setTimeout(() => front.focus(), 40);
    });
  }

  FC.cardEditor = { open, richEditor };
})(typeof self !== 'undefined' ? self : this);
