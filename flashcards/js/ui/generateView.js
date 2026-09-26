/*
 * Gerar com IA: PDF (ou texto colado) → configurações → geração por blocos →
 * revisão dos cards antes de entrar na coleção. Também gera cards direcionados
 * a um ponto fraco (#/gerar?weak=<id do tema>).
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  // ── Execução com suporte ao modo manual ────────────────────────────────────
  /**
   * Roda um pedido de IA. No modo manual abre o diálogo "copiar pedido / colar
   * resposta". Retorna o JSON ou null (cancelado).
   */
  async function runAI(req, opts = {}) {
    const res = await FC.ai.run(req, opts.onProgress);
    if (!res || !res.manual) return res;
    return new Promise((resolve) => {
      let result = null;
      const promptBox = h('div', { class: 'prompt-box', text: res.prompt });
      const answer = h('textarea', { class: 'textarea', rows: 8, placeholder: 'Cole aqui a resposta (JSON) do Claude' });
      const copyBtn = button('Copiar pedido', {
        icon: 'copy',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(res.prompt);
            FC.ui.toast('Pedido copiado. Cole no Claude (claude.ai).');
          } catch (e) {
            const range = document.createRange();
            range.selectNodeContents(promptBox);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            FC.ui.toast('Selecionei o texto: use Ctrl+C.');
          }
        },
      });
      const content = h(
        'div',
        { class: 'stack' },
        opts.title ? h('p', { class: 'ink2', text: opts.title }) : null,
        h('ol', { class: 'small ink2', style: { margin: 0, paddingLeft: '18px' } }, h('li', { text: 'Copie o pedido abaixo e cole numa conversa com o Claude.' }), h('li', { text: 'Copie a resposta inteira (o JSON) e cole no campo de baixo.' })),
        promptBox,
        h('div', { class: 'row' }, copyBtn, h('span', { class: 'hint', text: U.fmtNum(res.prompt.length) + ' caracteres' })),
        answer,
      );
      const m = FC.ui.modal({
        title: 'Modo manual',
        size: 'wide',
        sticky: true,
        content,
        onClose: () => resolve(result),
        actions: [
          button(opts.skipLabel || 'Cancelar', { onClick: () => m.close() }),
          button('Usar resposta', {
            variant: 'primary',
            onClick: () => {
              try {
                result = FC.ai.parseResponse(answer.value);
                m.close();
              } catch (e) {
                FC.ui.errorToast(e);
              }
            },
          }),
        ],
      });
    });
  }

  // ── Rascunhos (cards gerados aguardando revisão) ───────────────────────────
  const Drafts = {
    async add(cards, meta) {
      const batchId = U.uid('b');
      const base = FC.store.drafts.length;
      const list = cards.map((c, i) =>
        Object.assign(
          {
            id: U.uid('dr'),
            batchId,
            order: base + i,
            createdAt: Date.now(),
            selected: true,
            deckId: meta.deckId || null,
            batchLabel: meta.label || '',
          },
          c,
        ),
      );
      markDuplicates(list);
      FC.store.drafts.push(...list);
      await FC.db.bulkPut('drafts', list);
      FC.store.emit('drafts');
      return list;
    },
    /** silent: a tela já mostra a mudança (edição no próprio card), sem redesenhar. */
    async update(id, patch, silent) {
      const d = FC.store.drafts.find((x) => x.id === id);
      if (!d) return;
      Object.assign(d, patch);
      if ('front' in patch) markDuplicates([d]);
      await FC.db.put('drafts', d);
      if (!silent) FC.store.emit('drafts');
    },
    async remove(ids) {
      const set = new Set(ids);
      FC.store.drafts = FC.store.drafts.filter((d) => !set.has(d.id));
      await FC.db.bulkDel('drafts', ids);
      FC.store.emit('drafts');
    },
    async insertAfter(id, cards) {
      const idx = FC.store.drafts.findIndex((d) => d.id === id);
      const ref = FC.store.drafts[idx];
      const list = cards.map((c) => Object.assign({ id: U.uid('dr'), batchId: ref.batchId, createdAt: Date.now(), selected: true, deckId: ref.deckId, batchLabel: ref.batchLabel }, c));
      markDuplicates(list);
      FC.store.drafts.splice(idx + 1, 0, ...list);
      FC.store.drafts.forEach((d, i) => (d.order = i));
      await FC.db.bulkPut('drafts', FC.store.drafts);
      FC.store.emit('drafts');
    },
    async commit(ids, deckId) {
      const set = new Set(ids);
      const chosen = FC.store.drafts.filter((d) => set.has(d.id));
      const created = await FC.cards.bulkCreate(
        chosen.map((d) => ({
          front: d.front,
          back: d.back,
          path: d.path,
          tags: d.tags,
          deckId: deckId || d.deckId,
          source: d.source,
          reference: d.reference,
          estDifficulty: d.difficulty,
          estDifficultyBy: 'ia',
          cardType: d.cardType,
          origin: 'ia',
        })),
      );
      await this.remove(ids);
      return created;
    },
  };

  function frontKey(html) {
    return U.normalizeText(U.stripHtml(html)).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function markDuplicates(list) {
    const exact = new Map();
    const bySubject = new Map();
    for (const c of FC.store.cards.values()) {
      const k = frontKey(c.front);
      exact.set(k, c.id);
      const subj = c.subjectId || '_';
      if (!bySubject.has(subj)) bySubject.set(subj, []);
      bySubject.get(subj).push({ id: c.id, words: new Set(k.split(' ').filter((w) => w.length > 2)) });
    }
    const subjectNode = (names) => {
      let node = null;
      for (let i = 0; i < 3; i++) {
        node = FC.areas.findChild(node ? node.id : null, names[i] || '');
        if (!node) return null;
      }
      return node;
    };
    for (const d of list) {
      const k = frontKey(d.front);
      d.dupOf = exact.get(k) || null;
      if (d.dupOf || !d.path || !d.path[2]) continue;
      const node = subjectNode(d.path);
      const pool = node ? bySubject.get(node.id) || [] : [];
      const words = new Set(k.split(' ').filter((w) => w.length > 2));
      for (const other of pool) {
        let inter = 0;
        for (const w of words) if (other.words.has(w)) inter++;
        const union = words.size + other.words.size - inter;
        if (union && inter / union >= 0.8) {
          d.dupOf = other.id;
          break;
        }
      }
    }
  }

  // ── Tela de geração ────────────────────────────────────────────────────────
  const COUNTS = [5, 10, 20, 30, 50, 100];

  /** Baralho padrão da geração: o último usado; senão "Meus cards". */
  function defaultDeckId() {
    const last = FC.settings.get('lastGenDeckId');
    if (last && FC.decks.get(last)) return last;
    const def = FC.decks.findByName(FC.decks.DEFAULT_NAME);
    return def ? def.id : (FC.decks.all()[0] || {}).id;
  }

  function settingsForm(state, opts = {}) {
    const s = FC.settings.get();
    state.count = state.count || s.genCount;
    state.answerSize = state.answerSize || s.genAnswerSize;
    state.cardType = state.cardType || s.genCardType;
    state.difficulty = state.difficulty || s.genDifficulty;
    const custom = h('input', { class: 'input', type: 'number', min: '1', max: '300', value: COUNTS.includes(state.count) ? '' : state.count, placeholder: 'Outro', style: { width: '100px' } });
    custom.addEventListener('input', () => {
      const n = parseInt(custom.value, 10);
      if (n > 0) {
        state.count = Math.min(300, n);
        countSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
    });
    const countSeg = FC.ui.seg(
      COUNTS.map((n) => ({ value: n, label: String(n) })),
      state.count,
      (v) => {
        state.count = v;
        custom.value = '';
      },
    );
    const size = FC.ui.select(FC.ai.ANSWER_SIZES.map((a) => ({ value: a.key, label: a.label })), state.answerSize, { onchange: (e) => (state.answerSize = e.target.value) });
    const type = FC.ui.select(FC.ai.CARD_TYPES.map((a) => ({ value: a.key, label: a.label })), state.cardType, { onchange: (e) => (state.cardType = e.target.value) });
    const diff = FC.ui.select(FC.ai.DIFFICULTIES.map((a) => ({ value: a.key, label: a.label })), state.difficulty, { onchange: (e) => (state.difficulty = e.target.value) });
    const els = [h('div', { class: 'field full' }, h('span', { class: 'label', text: 'Quantidade de cards' }), h('div', { class: 'row' }, countSeg, custom))];
    els.push(FC.ui.field('Tamanho da resposta', size), FC.ui.field('Tipo de card', type), FC.ui.field('Dificuldade', diff));
    if (!opts.noDeck) {
      state.deckId = state.deckId || defaultDeckId();
      const deck = FC.ui.deckSelect(state.deckId, { allowNew: true });
      deck.addEventListener('change', () => deck.value !== '__new__' && (state.deckId = deck.value));
      els.push(FC.ui.field('Baralho de destino', deck));
    }
    return h('div', { class: 'form-grid' }, els);
  }

  function forcedFields(state) {
    const lists = [0, 1, 2].map((level) => [...new Set([...FC.store.nodes.values()].filter((n) => n.level === level).map((n) => n.name))]);
    const mk = (key, label, level, ph) => {
      const id = U.uid('dl');
      const input = h('input', { class: 'input', list: id, value: (state.forced && state.forced[key]) || '', placeholder: ph });
      input.addEventListener('input', () => {
        state.forced = state.forced || {};
        state.forced[key] = input.value.trim();
      });
      return h('div', { class: 'field' }, h('label', { class: 'label', text: label }), input, FC.ui.datalist(id, lists[level]));
    };
    return h(
      'details',
      null,
      h('summary', { class: 'label', style: { cursor: 'pointer' }, text: 'Classificação (opcional: a IA classifica sozinha)' }),
      h('div', { class: 'form-grid', style: { marginTop: '10px' } }, mk('area', 'Grande área', 0, 'Ex.: Cirurgia'), mk('subarea', 'Subárea', 1, 'Ex.: Cirurgia Digestiva'), mk('subject', 'Assunto', 2, 'Ex.: Acalasia'), h('p', { class: 'hint full', text: 'Preencha só se quiser fixar a classificação de todos os cards deste material.' })),
    );
  }

  function providerLine() {
    const p = FC.ai.provider();
    const name = { manual: 'Manual (copiar e colar no Claude)', anthropic: 'Claude pela sua chave de API (' + FC.settings.get('aiModel') + ')', backend: 'Servidor configurado' }[p];
    return h('p', { class: 'small ink2' }, 'Modo de IA: ', h('strong', { text: name }), ' · ', h('a', { href: '#/configuracoes', text: 'mudar' }));
  }

  /** Reparte a quantidade pedida entre os blocos, proporcional ao tamanho do texto. */
  function distribute(total, chunks) {
    const sum = chunks.reduce((s, c) => s + c.text.length, 0) || 1;
    const raw = chunks.map((c) => (total * c.text.length) / sum);
    const counts = raw.map((r) => Math.max(1, Math.floor(r)));
    let diff = total - counts.reduce((a, b) => a + b, 0);
    const byFraction = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; diff > 0; k++, diff--) counts[byFraction[k % byFraction.length][1]]++;
    while (diff < 0) {
      const i = counts.indexOf(Math.max(...counts));
      if (counts[i] <= 1) break;
      counts[i]--;
      diff++;
    }
    return counts;
  }

  FC.views.generate = {
    title: 'Gerar com IA',
    render(ctx) {
      if (ctx.query.weak) return renderWeak(ctx, ctx.query.weak);
      const { el } = ctx;
      const state = { material: null, file: null, from: 1, to: 1, keepPdf: true, deckId: ctx.query.deck || null, forced: null, focus: '' };
      const materialBox = h('div', { class: 'stack' });
      const settingsBox = h('section', { class: 'panel stack hidden' });
      const runBox = h('section', { class: 'panel stack hidden' });

      async function onFile(file) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return FC.ui.toast('Escolha um arquivo PDF.', { error: true });
        FC.ui.clear(materialBox).appendChild(h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { text: 'Lendo "' + file.name + '"…' }), h('span', { class: 'muted num', id: 'pdfprog' })));
        try {
          const ex = await FC.pdf.extract(file, (i, n) => {
            const p = document.getElementById('pdfprog');
            if (p) p.textContent = i + '/' + n + ' páginas';
          });
          state.file = file;
          state.keepPdf = file.size < 60 * 1024 * 1024;
          setMaterial(ex);
        } catch (e) {
          console.error(e);
          FC.ui.clear(materialBox).appendChild(FC.ui.callout('Não foi possível ler o PDF: ' + e.message, 'crit'));
          materialBox.appendChild(pickers());
        }
      }

      function setMaterial(ex) {
        state.material = ex;
        state.from = 1;
        state.to = ex.pageCount;
        FC.ui.clear(materialBox);
        const chars = ex.pages.reduce((s, p) => s + p.length, 0);
        const from = h('input', { class: 'input', type: 'number', min: '1', max: String(ex.pageCount), value: '1', style: { width: '90px' } });
        const to = h('input', { class: 'input', type: 'number', min: '1', max: String(ex.pageCount), value: String(ex.pageCount), style: { width: '90px' } });
        const info = h('span', { class: 'small muted num' });
        const upd = () => {
          state.from = U.clamp(parseInt(from.value, 10) || 1, 1, ex.pageCount);
          state.to = U.clamp(parseInt(to.value, 10) || ex.pageCount, state.from, ex.pageCount);
          const c = ex.pages.slice(state.from - 1, state.to).reduce((s, p) => s + p.length, 0);
          info.textContent = U.fmtNum(c) + ' caracteres selecionados (~' + U.fmtNum(Math.round(c / 3.5)) + ' tokens)';
        };
        from.addEventListener('input', upd);
        to.addEventListener('input', upd);
        upd();
        const keep = FC.ui.checkbox('Guardar o PDF neste navegador (para abrir a fonte na página certa)', state.keepPdf, (v) => (state.keepPdf = v));
        FC.ui.add(materialBox, 
          h('div', { class: 'row between' }, h('div', { class: 'row' }, icon('file', 20), h('div', null, h('strong', { text: ex.fileName }), h('div', { class: 'small muted', text: U.plural(ex.pageCount, 'página', 'páginas') + ' · ' + U.fmtNum(chars) + ' caracteres' }))), button('Trocar', { size: 'sm', variant: 'ghost', onClick: () => (FC.ui.clear(materialBox).appendChild(pickers()), settingsBox.classList.add('hidden')) })),
          ex.emptyPages > ex.pageCount / 2 ? FC.ui.callout('Muitas páginas sem texto: o PDF parece digitalizado (imagem). Sem OCR, a IA só vê o texto que existe.', 'warn') : null,
          ex.pasted ? null : h('div', { class: 'row' }, h('span', { class: 'label', text: 'Páginas' }), from, h('span', { text: 'até' }), to, info),
          ex.pasted ? null : keep.el,
        );
        settingsBox.classList.remove('hidden');
      }

      function pickers() {
        const text = h('textarea', { class: 'textarea', rows: 8, placeholder: 'Cole aqui um texto (resumo, capítulo, aula)…' });
        const name = h('input', { class: 'input', placeholder: 'Nome da fonte (ex.: Aula de esôfago)' });
        let mode = 'pdf';
        const pdfPane = FC.ui.dropzone({ label: 'Arraste um PDF ou clique para escolher', hint: 'O texto é extraído neste navegador. Nada é enviado até você mandar gerar.', accept: 'application/pdf,.pdf', icon: 'file', onFile });
        const textPane = h(
          'div',
          { class: 'stack hidden' },
          name,
          text,
          button('Usar este texto', {
            variant: 'primary',
            onClick: () => {
              if (text.value.trim().length < 200) return FC.ui.toast('Cole pelo menos um parágrafo de texto.', { error: true });
              state.file = null;
              setMaterial(FC.pdf.fromText(text.value, name.value.trim() || 'Texto colado'));
            },
          }),
        );
        return h(
          'div',
          { class: 'stack' },
          FC.ui.tabs(
            [
              { key: 'pdf', label: 'PDF' },
              { key: 'text', label: 'Colar texto' },
            ],
            mode,
            (k) => {
              mode = k;
              pdfPane.classList.toggle('hidden', k !== 'pdf');
              textPane.classList.toggle('hidden', k !== 'text');
            },
          ),
          pdfPane,
          textPane,
        );
      }

      const focus = h('input', { class: 'input', placeholder: 'Opcional. Ex.: foque em tratamento e condutas de prova' });
      focus.addEventListener('input', () => (state.focus = focus.value.trim()));
      const genBtn = button('Gerar cards', { variant: 'primary', size: 'lg', icon: 'sparkles', onClick: () => generate() });
      FC.ui.add(settingsBox, h('h2', { text: '2. Como gerar' }), settingsForm(state), forcedFields(state), FC.ui.field('Foco (opcional)', focus), h('hr', { class: 'divider' }), FC.ui.callout(FC.ai.privacyNotice(), '', 'shield'), providerLine(), h('div', { class: 'row' }, genBtn));

      async function generate() {
        if (!state.material) return;
        const ex = state.material;
        let chunks = FC.pdf.chunk(ex.pages, state.from, state.to);
        if (!chunks.length) return FC.ui.toast('As páginas selecionadas não têm texto.', { error: true });
        if (state.count < chunks.length) {
          const total = chunks.reduce((s, c) => s + c.text.length, 0);
          chunks = FC.pdf.chunk(ex.pages, state.from, state.to, Math.min(400000, Math.ceil(total / state.count) + 5000));
        }
        const counts = distribute(state.count, chunks);
        genBtn.disabled = true;
        runBox.classList.remove('hidden');
        FC.ui.clear(runBox).appendChild(h('h2', { text: '3. Gerando' }));
        const status = h('p', { class: 'ink2' });
        const bar = h('div');
        FC.ui.add(runBox, status, bar);
        let source = null;
        try {
          source = await FC.pdf.saveSource(ex, state.file, state.keepPdf);
        } catch (e) {
          console.warn('Fonte não guardada', e);
        }
        let total = 0;
        const errors = [];
        for (let i = 0; i < chunks.length; i++) {
          const ch = chunks[i];
          status.textContent = 'Bloco ' + (i + 1) + ' de ' + chunks.length + ' (páginas ' + ch.fromPage + '–' + ch.toPage + ') · ' + counts[i] + ' cards…';
          FC.ui.clear(bar).appendChild(FC.ui.progressBar(i / chunks.length));
          const req = FC.ai.buildGenerate({ text: ch.text, fileName: ex.fileName, fromPage: ch.fromPage, toPage: ch.toPage, count: counts[i], answerSize: state.answerSize, cardType: state.cardType, difficulty: state.difficulty, forced: state.forced, focus: state.focus });
          try {
            const data = await runAI(req, {
              title: 'Bloco ' + (i + 1) + ' de ' + chunks.length + ' (páginas ' + ch.fromPage + '–' + ch.toPage + ')',
              skipLabel: 'Pular bloco',
              onProgress: (p) => (status.textContent = 'Bloco ' + (i + 1) + ' de ' + chunks.length + ' · recebendo… ' + U.fmtNum(p.received) + ' caracteres'),
            });
            if (!data) continue;
            const cards = FC.ai.normalizeCards(data, { fileName: ex.fileName, sourceId: source ? source.id : null, difficulty: state.difficulty, forced: state.forced });
            await Drafts.add(cards, { deckId: state.deckId, label: ex.fileName + ' (p. ' + ch.fromPage + '–' + ch.toPage + ')' });
            total += cards.length;
          } catch (e) {
            console.error(e);
            errors.push('Bloco ' + (i + 1) + ': ' + e.message);
            FC.ui.errorToast(e);
            if (/chave|conexão|servidor|Limite/i.test(e.message)) break;
          }
        }
        FC.ui.clear(bar).appendChild(FC.ui.progressBar(1));
        genBtn.disabled = false;
        status.textContent = total ? U.plural(total, 'card gerado', 'cards gerados') + '. Revise antes de adicionar à coleção.' : 'Nenhum card gerado.';
        if (errors.length) runBox.appendChild(FC.ui.callout(errors.join(' · '), 'crit'));
        if (total) {
          runBox.appendChild(h('div', { class: 'row' }, link('Revisar cards gerados', '#/gerar/revisao', { variant: 'primary', icon: 'arrow' })));
          FC.app.go('/gerar/revisao');
        }
      }

      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Gerar com IA' }), h('p', { text: 'Transforme um PDF em perguntas de recordação ativa, já classificadas por área, assunto e tema. Você revisa tudo antes de entrar na coleção.' })), FC.store.drafts.length ? link('Cards aguardando revisão (' + FC.store.drafts.length + ')', '#/gerar/revisao', { icon: 'list' }) : null),
        h('div', { class: 'stack loose' }, h('section', { class: 'panel stack' }, h('h2', { text: '1. Material' }), materialBox), settingsBox, runBox),
      );
      materialBox.appendChild(pickers());
    },
  };

  // ── Ponto fraco → cards direcionados ───────────────────────────────────────
  function sourceContextFor(nodeId, maxChars = 40000) {
    const seen = new Set();
    const parts = [];
    let size = 0;
    for (const card of FC.areas.cardsIn(nodeId)) {
      const src = FC.pdf.findSource(card);
      if (!src || !card.source.page) continue;
      for (let p = card.source.page - 1; p <= card.source.page + 1; p++) {
        const key = src.id + ':' + p;
        if (seen.has(key) || p < 1 || p > src.pageCount) continue;
        seen.add(key);
        const text = '[[Página ' + p + ' — ' + src.fileName + ']]\n' + src.pages[p - 1] + '\n';
        if (size + text.length > maxChars) break;
        parts.push(text);
        size += text.length;
      }
    }
    return { text: parts.join('\n'), pages: seen.size };
  }

  function renderWeak(ctx, nodeId) {
    const { el } = ctx;
    const node = FC.areas.get(nodeId);
    if (!node) return FC.app.go('/gerar');
    const title = FC.areas.title(nodeId);
    ctx.setTitle('Gerar cards · ' + title);
    const { aggs } = FC.analysis.context();
    const agg = aggs.get(nodeId);
    const path = FC.areas.pathNames(nodeId);
    const state = { count: 10, answerSize: 'curta', cardType: 'auto', difficulty: 'auto', deckId: null, topics: [] };
    const cards = FC.areas.cardsIn(nodeId);
    state.deckId = cards[0] ? cards[0].deckId : null;
    const context = sourceContextFor(nodeId);
    const extra = h('textarea', { class: 'textarea', rows: 4, placeholder: 'Opcional: cole um trecho de material de apoio sobre o tema' });
    const statsText = agg ? U.pct(agg.accuracy) + ' de acerto em ' + agg.n + ' revisões de ' + agg.reviewedCards + ' cards; ' + agg.recentErrors + ' erros nos últimos ' + FC.settings.get('weakRecentDays') + ' dias' : 'sem revisões';
    const errorsOf = (c) => FC.store.cardLogs(c.id).filter((l) => l.rating === 1).length;
    const cardInfo = cards.map((c) => ({ front: c.front, errors: errorsOf(c) })).sort((a, b) => b.errors - a.errors);
    const sugBox = h('div', { class: 'stack' });
    const custom = h('input', { class: 'input', placeholder: 'Adicionar tema próprio e Enter (ex.: Indicações de POEM)' });
    custom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && custom.value.trim()) {
        addTopic({ title: custom.value.trim(), why: 'Adicionado por você' }, true);
        custom.value = '';
      }
    });
    function addTopic(s, checked) {
      const c = FC.ui.checkbox(s.title, checked, (v) => {
        if (v) state.topics.push(s.title);
        else state.topics = state.topics.filter((t) => t !== s.title);
      });
      if (checked) state.topics.push(s.title);
      sugBox.appendChild(h('div', null, c.el, s.why ? h('p', { class: 'hint', style: { marginLeft: '26px' }, text: s.why }) : null));
    }
    const contextText = () => [context.text, extra.value.trim()].filter(Boolean).join('\n\n');
    const suggestBtn = button('Sugerir temas', {
      icon: 'sparkles',
      onClick: async () => {
        FC.ui.busy(suggestBtn, true, 'Pensando…');
        try {
          const data = await runAI(FC.ai.buildSuggest({ pathText: path.join(' › '), statsText, cards: cardInfo, contextText: contextText() }), { title: 'Sugestões para: ' + title });
          if (data) for (const s of FC.ai.normalizeSuggestions(data)) addTopic(s, true);
        } catch (e) {
          FC.ui.errorToast(e);
        }
        FC.ui.busy(suggestBtn, false);
      },
    });
    const genBtn = button('Gerar cards', {
      variant: 'primary',
      icon: 'sparkles',
      onClick: async () => {
        FC.ui.busy(genBtn, true, 'Gerando…');
        try {
          const forced = { area: path[0], subarea: path[1], subject: path[2], topic: path[3] };
          const data = await runAI(FC.ai.buildTargeted({ pathText: path.join(' › '), topics: state.topics, count: state.count, answerSize: state.answerSize, difficulty: state.difficulty, forced, cards: cardInfo, contextText: contextText() }), { title: 'Cards para: ' + title });
          if (data) {
            const list = FC.ai.normalizeCards(data, { difficulty: state.difficulty, forced });
            for (const c of list) if (!c.reference && !context.text) c.reference = '';
            await Drafts.add(list, { deckId: state.deckId, label: 'Ponto fraco: ' + title });
            FC.ui.toast(U.plural(list.length, 'card gerado', 'cards gerados') + '.');
            FC.app.go('/gerar/revisao');
          }
        } catch (e) {
          FC.ui.errorToast(e);
        }
        FC.ui.busy(genBtn, false);
      },
    });
    FC.ui.add(el, 
      h('div', { class: 'page-head' }, h('div', null, h('p', { class: 'crumb', text: FC.areas.breadcrumb(nodeId) }), h('h1', { text: 'Gerar cards para: ' + title }), h('p', { text: 'Dados reais: ' + statsText + '.' })), link('Voltar ao ponto fraco', '#/pontos-fracos/' + nodeId, { variant: 'ghost' })),
      h(
        'div',
        { class: 'stack loose' },
        h(
          'section',
          { class: 'panel stack' },
          h('h2', { text: '1. Temas para reforçar' }),
          context.pages
            ? FC.ui.callout('A IA vai usar o texto de ' + U.plural(context.pages, 'página', 'páginas') + ' das suas fontes (PDFs deste tema) como base.', 'good', 'file')
            : FC.ui.callout('Não há texto de fonte guardado para este tema: a IA usará conhecimento médico consolidado e só citará diretrizes que tem certeza de que existem. Confira as respostas antes de adicionar.', 'warn'),
          extra,
          h('div', { class: 'row' }, suggestBtn),
          sugBox,
          custom,
        ),
        h('section', { class: 'panel stack' }, h('h2', { text: '2. Gerar' }), settingsForm(state), FC.ui.callout(FC.ai.privacyNotice(), '', 'shield'), providerLine(), h('div', { class: 'row' }, genBtn)),
      ),
    );
  }

  // ── Revisão dos cards gerados ──────────────────────────────────────────────
  function editDraftPath(d, done) {
    const picker = FC.ui.pathPicker(d.path || []);
    const tags = h('input', { class: 'input', value: (d.tags || []).join(' ') });
    const diff = FC.ui.select(
      [
        { value: 'facil', label: 'Fácil' },
        { value: 'media', label: 'Média' },
        { value: 'dificil', label: 'Difícil' },
      ],
      d.difficulty || 'media',
    );
    const srcName = h('input', { class: 'input', value: (d.source && d.source.fileName) || '' });
    const srcPage = h('input', { class: 'input', type: 'number', min: '1', value: (d.source && d.source.page) || '' });
    const reference = h('input', { class: 'input', value: d.reference || '' });
    const m = FC.ui.modal({
      title: 'Classificação, tags e fonte',
      size: 'wide',
      content: h('div', { class: 'stack loose' }, picker.el, h('div', { class: 'form-grid' }, FC.ui.field('Tags', tags), FC.ui.field('Dificuldade', diff), FC.ui.field('Fonte (arquivo)', srcName), FC.ui.field('Página', srcPage), h('div', { class: 'full' }, FC.ui.field('Referência', reference)))),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Salvar', {
          variant: 'primary',
          onClick: async () => {
            await Drafts.update(d.id, {
              path: picker.get(),
              tags: FC.cards.normalizeTags(tags.value),
              difficulty: diff.value,
              reference: reference.value.trim(),
              source: srcName.value.trim() || srcPage.value ? Object.assign({}, d.source || {}, { fileName: srcName.value.trim(), page: parseInt(srcPage.value, 10) || null }) : null,
            });
            m.close();
            done();
          },
        }),
      ],
    });
  }

  async function draftAI(d, action, btn, done) {
    FC.ui.busy(btn, true, '…');
    try {
      const ctxText = d.source ? FC.pdf.contextFor({ source: d.source }) : '';
      const data = await runAI(FC.ai.buildCardAction(action, { front: d.front, back: d.back, path: d.path, source: d.source }, ctxText), { title: { regenerate: 'Refazer card', simplify: 'Simplificar card', detail: 'Detalhar card', complement: 'Cards complementares' }[action] });
      if (data) {
        const list = FC.ai.normalizeCards(data, { fileName: d.source ? d.source.fileName : null, sourceId: d.source ? d.source.sourceId : null, forced: { area: d.path[0], subarea: d.path[1], subject: d.path[2] } });
        if (!list.length) throw new Error('A resposta não trouxe cards.');
        if (action === 'complement') {
          await Drafts.insertAfter(d.id, list.map((c) => Object.assign(c, { source: c.source && c.source.page ? c.source : d.source })));
          FC.ui.toast(U.plural(list.length, 'card complementar adicionado', 'cards complementares adicionados') + '.');
        } else {
          const c = list[0];
          await Drafts.update(d.id, { front: c.front, back: c.back, tags: c.tags.length ? c.tags : d.tags, difficulty: c.difficulty || d.difficulty, reference: c.reference || d.reference, source: c.source && c.source.page ? Object.assign({}, d.source, { page: c.source.page }) : d.source });
        }
      }
    } catch (e) {
      FC.ui.errorToast(e);
    }
    FC.ui.busy(btn, false);
    done();
  }

  function draftCard(d, refresh) {
    const check = h('input', { type: 'checkbox', checked: d.selected !== false, 'aria-label': 'Incluir este card' });
    check.addEventListener('change', async () => {
      await Drafts.update(d.id, { selected: check.checked }, true);
      refresh(true);
    });
    const editable = (html, key, cls) => {
      const el = h('div', { class: 'editable rich ' + cls, contenteditable: 'true', role: 'textbox', 'aria-label': key === 'front' ? 'Pergunta' : 'Resposta' });
      el.innerHTML = FC.sanitize(html);
      el.addEventListener('blur', async () => {
        const v = FC.sanitize(el.innerHTML);
        if (v !== d[key]) await Drafts.update(d.id, { [key]: v }, true);
      });
      return el;
    };
    const aiBtn = (label, action) => {
      const b = button(label, { size: 'sm', variant: 'ghost' });
      b.addEventListener('click', () => draftAI(d, action, b, () => refresh()));
      return b;
    };
    const path = (d.path || []).filter(Boolean);
    return h(
      'div',
      { class: 'draft' + (d.selected === false ? ' unselected' : '') },
      h('div', { style: { paddingTop: '2px' } }, check),
      h(
        'div',
        { style: { minWidth: 0 } },
        editable(d.front, 'front', 'q'),
        editable(d.back, 'back', 'a'),
        h(
          'div',
          { class: 'row tight', style: { marginTop: '10px' } },
          h('button', { type: 'button', class: 'link-btn small', onclick: () => editDraftPath(d, () => refresh()) }, icon('folder', 14), ' ', path.length ? path.join(' › ') : 'Sem classificação'),
          FC.ui.diffBadge(d.difficulty),
          (d.tags || []).map((t) => h('span', { class: 'tag', text: '#' + t })),
          d.source && (d.source.page || d.source.fileName) ? h('button', { type: 'button', class: 'link-btn tiny', onclick: () => FC.cardDetail.showSource({ source: d.source, front: d.front }) }, 'Fonte: ' + (d.source.fileName || '') + (d.source.page ? ', p. ' + d.source.page : '')) : null,
          d.reference ? h('span', { class: 'tiny muted', text: d.reference }) : null,
          d.dupOf ? h('button', { type: 'button', class: 'badge warn', onclick: () => FC.cardDetail.open(d.dupOf), text: 'Possível duplicata — ver' }) : null,
        ),
        h(
          'div',
          { class: 'draft-actions' },
          button('Editar', { size: 'sm', variant: 'ghost', icon: 'edit', onClick: () => editFull(d, refresh) }),
          aiBtn('Refazer', 'regenerate'),
          aiBtn('Simplificar', 'simplify'),
          aiBtn('Detalhar', 'detail'),
          aiBtn('Card complementar', 'complement'),
          button('Duplicar', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: async () => { await Drafts.insertAfter(d.id, [{ front: d.front, back: d.back, path: d.path, tags: d.tags, difficulty: d.difficulty, cardType: d.cardType, reference: d.reference, source: d.source }]); refresh(); } }),
          button('Excluir', { size: 'sm', variant: 'ghost', icon: 'trash', onClick: async () => { await Drafts.remove([d.id]); refresh(); } }),
        ),
      ),
    );
  }

  function editFull(d, refresh) {
    const front = FC.cardEditor.richEditor(d.front);
    const back = FC.cardEditor.richEditor(d.back);
    const m = FC.ui.modal({
      title: 'Editar card gerado',
      size: 'wide',
      content: h('div', { class: 'stack loose' }, h('div', { class: 'field' }, h('span', { class: 'label', text: 'Pergunta' }), front.el), h('div', { class: 'field' }, h('span', { class: 'label', text: 'Resposta' }), back.el), button('Classificação, tags e fonte…', { variant: 'ghost', icon: 'folder', onClick: () => (m.close(), editDraftPath(d, refresh)) })),
      actions: [
        button('Cancelar', { onClick: () => m.close() }),
        button('Salvar', {
          variant: 'primary',
          onClick: async () => {
            await Drafts.update(d.id, { front: front.get(), back: back.get() });
            m.close();
            refresh();
          },
        }),
      ],
    });
  }

  FC.views.drafts = {
    title: 'Revisar cards gerados',
    render(ctx) {
      const { el } = ctx;
      let deckId = null;
      const draw = (keepScroll) => {
        const y = window.scrollY;
        FC.ui.clear(el);
        const drafts = FC.store.drafts;
        if (!drafts.length) {
          el.appendChild(h('div', { class: 'panel' }, FC.ui.empty({ icon: 'sparkles', title: 'Nenhum card aguardando revisão', text: 'Os cards gerados pela IA aparecem aqui antes de entrar na coleção.', actions: [link('Gerar com IA', '#/gerar', { variant: 'primary', icon: 'sparkles' })] })));
          return;
        }
        const selected = drafts.filter((d) => d.selected !== false);
        deckId = deckId || (drafts[0].deckId && FC.decks.get(drafts[0].deckId) ? drafts[0].deckId : defaultDeckId());
        const deck = FC.ui.deckSelect(deckId, { allowNew: true });
        deck.addEventListener('change', () => deck.value !== '__new__' && (deckId = deck.value));
        const add = async (ids) => {
          if (!ids.length) return FC.ui.toast('Nenhum card selecionado.', { error: true });
          const created = await Drafts.commit(ids, deckId);
          FC.settings.set({ lastGenDeckId: deckId });
          FC.ui.toast(U.plural(created.length, 'card adicionado', 'cards adicionados') + ' à coleção.', { action: { label: 'Ver', run: () => FC.app.go('/decks/baralho/' + deckId) } });
          draw();
        };
        FC.ui.add(el, 
          h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Revisar cards gerados' }), h('p', { text: U.plural(drafts.length, 'card', 'cards') + ' · ' + selected.length + ' selecionados. Clique no texto para editar.' })), link('Gerar mais', '#/gerar', { icon: 'sparkles' })),
          h(
            'section',
            { class: 'panel row', style: { position: 'sticky', top: '64px', zIndex: '6', marginBottom: '16px' } },
            h('div', { class: 'field', style: { minWidth: '220px' } }, h('span', { class: 'label', text: 'Baralho de destino' }), deck),
            h('span', { class: 'grow' }),
            button('Selecionar todos', { size: 'sm', variant: 'ghost', onClick: async () => { for (const d of drafts) d.selected = true; await FC.db.bulkPut('drafts', drafts); draw(); } }),
            button('Nenhum', { size: 'sm', variant: 'ghost', onClick: async () => { for (const d of drafts) d.selected = false; await FC.db.bulkPut('drafts', drafts); draw(); } }),
            button('Descartar não selecionados', { size: 'sm', variant: 'ghost', onClick: async () => { const ids = drafts.filter((d) => d.selected === false).map((d) => d.id); if (ids.length && (await FC.ui.confirm('Descartar ' + ids.length + ' cards?', { danger: true, okText: 'Descartar' }))) { await Drafts.remove(ids); draw(); } } }),
            button('Adicionar selecionados (' + selected.length + ')', { variant: 'primary', icon: 'check', onClick: () => add(selected.map((d) => d.id)) }),
            button('Adicionar todos', { onClick: () => add(drafts.map((d) => d.id)) }),
          ),
        );
        const groups = U.groupBy(drafts, (d) => d.batchId);
        for (const [, list] of groups) {
          el.appendChild(h('h3', { class: 'ink2', style: { margin: '18px 0 8px' }, text: (list[0].batchLabel || 'Lote') + ' · ' + U.plural(list.length, 'card', 'cards') }));
          el.appendChild(h('div', { class: 'stack' }, list.map((d) => draftCard(d, draw))));
        }
        if (keepScroll) window.scrollTo(0, y);
      };
      draw();
      ctx.on('drafts', U.debounce(() => draw(true), 50));
    },
  };

  FC.generate = { runAI, Drafts };
})(typeof self !== 'undefined' ? self : this);
