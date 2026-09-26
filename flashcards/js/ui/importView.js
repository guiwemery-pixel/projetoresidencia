/*
 * Importar e exportar.
 * Importa: CSV/TXT no modelo Anki (ou planilha), JSON (baralho deste app com
 * agendamento e histórico) e baralhos do Anki .apkg/.colpkg com as informações
 * de revisão. Exporta: modelo Anki (CSV), CSV, TXT e JSON, escolhendo os campos.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  const KIND_TEXT = {
    text: 'Arquivo de texto (CSV/TXT)',
    json: 'Pacote JSON',
    anki: 'Baralho do Anki',
    backup: 'Backup completo',
  };

  function slug(s) {
    return (
      U.stripAccents(String(s || 'flashcards'))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'flashcards'
    );
  }

  const today = () => new Date().toISOString().slice(0, 10);

  // ── Exportação ─────────────────────────────────────────────────────────────
  const FORMATS = [
    { value: 'anki', label: 'Anki — modelo CSV (Pergunta/Resposta, cabeçalho do assunto, tags hierárquicas)', ext: 'csv' },
    { value: 'csv', label: 'CSV (planilha, campos escolhidos)', ext: 'csv' },
    { value: 'txt', label: 'TXT (texto legível)', ext: 'txt' },
    { value: 'json-sched', label: 'JSON — baralho com agendamento e histórico de revisões', ext: 'json' },
    { value: 'json', label: 'JSON — só os cards (campos escolhidos)', ext: 'json' },
  ];

  function exportCtx() {
    return {
      pathNames: (id) => FC.areas.pathNames(id),
      deckName: (id) => {
        const d = FC.decks.get(id);
        return d ? d.name : '';
      },
      logsOf: (id) => FC.store.cardLogs(id),
    };
  }

  function buildExport(cards, format, fields, keepHtml) {
    const ctx = exportCtx();
    if (format === 'anki') return { content: FC.formats.toAnkiCsv(cards, ctx), mime: 'text/csv;charset=utf-8' };
    if (format === 'csv') return { content: FC.formats.toPlainCsv(cards, fields, ctx, keepHtml), mime: 'text/csv;charset=utf-8' };
    if (format === 'txt') return { content: FC.formats.toTxt(cards, fields, ctx), mime: 'text/plain;charset=utf-8' };
    if (format === 'json-sched') return { content: FC.formats.toDeckPackage(cards, ctx, true), mime: 'application/json' };
    return { content: FC.formats.toDeckPackage(cards, ctx, false, fields), mime: 'application/json' };
  }

  /** label pode ser texto ou função (nome do arquivo conforme o escopo escolhido). */
  function exportForm(getCards, label, onDone) {
    let format = 'anki';
    const fields = new Set(FC.settings.get('exportFields') || []);
    const fmtSel = FC.ui.select(FORMATS, format);
    const keepHtml = FC.ui.checkbox('Manter formatação HTML', true);
    const fieldsBox = h(
      'div',
      { class: 'row' },
      FC.formats.EXPORT_FIELDS.map((f) => {
        const c = FC.ui.checkbox(f.label, fields.has(f.key), (v) => (v ? fields.add(f.key) : fields.delete(f.key)));
        return c.el;
      }),
    );
    const fieldsWrap = h('div', { class: 'stack tight hidden' }, h('span', { class: 'label', text: 'Campos' }), fieldsBox, keepHtml.el);
    const note = h('p', { class: 'hint' });
    const update = () => {
      format = fmtSel.value;
      fieldsWrap.classList.toggle('hidden', !(format === 'csv' || format === 'txt' || format === 'json'));
      keepHtml.el.classList.toggle('hidden', format !== 'csv');
      note.textContent =
        {
          anki: 'Mesmo formato dos seus flashcards: no Anki use Arquivo → Importar. O agendamento não vai junto (o Anki não importa revisões de CSV).',
          csv: 'Separador ponto e vírgula, abre no Excel/Planilhas.',
          txt: 'Lista numerada de perguntas e respostas, boa para ler ou imprimir.',
          'json-sched': 'Leva tudo: classificação, baralho, tags, fonte, agendamento (próxima revisão, estabilidade, dificuldade) e histórico. Importe em outro navegador/aparelho para continuar de onde parou.',
          json: 'Lista de cards com os campos escolhidos, sem agendamento.',
        }[format] || '';
    };
    fmtSel.addEventListener('change', update);
    update();
    const go = () => {
      const cards = getCards();
      if (!cards.length) return FC.ui.toast('Nenhum card para exportar.', { error: true });
      const list = [...fields];
      if ((format === 'csv' || format === 'txt' || format === 'json') && !list.includes('front')) list.unshift('front');
      if ((format === 'csv' || format === 'txt' || format === 'json') && !list.includes('back')) list.splice(1, 0, 'back');
      FC.settings.set({ exportFields: list });
      const out = buildExport(cards, format, list, keepHtml.input.checked);
      const ext = FORMATS.find((f) => f.value === format).ext;
      FC.ui.download('flashcards_' + slug(typeof label === 'function' ? label() : label) + '_' + today() + '.' + ext, out.content, out.mime);
      FC.ui.toast(U.plural(cards.length, 'card exportado', 'cards exportados') + '.');
      if (onDone) onDone();
    };
    return { el: h('div', { class: 'stack' }, FC.ui.field('Formato', fmtSel), note, fieldsWrap), go };
  }

  function exportDialog(opts) {
    let getCards;
    if (opts.cardIds) getCards = () => opts.cardIds.map((id) => FC.cards.get(id)).filter(Boolean);
    else if (opts.deckId) getCards = () => FC.decks.cardsIn(opts.deckId);
    else if (opts.nodeId) getCards = () => FC.areas.cardsIn(opts.nodeId);
    else getCards = () => FC.cards.all();
    const form = exportForm(getCards, opts.label || 'flashcards', () => m.close());
    const m = FC.ui.modal({
      title: 'Exportar ' + U.plural(getCards().length, 'card', 'cards') + (opts.label ? ' · ' + opts.label : ''),
      content: form.el,
      actions: [button('Cancelar', { onClick: () => m.close() }), button('Baixar arquivo', { variant: 'primary', icon: 'download', onClick: form.go })],
    });
  }

  // ── Importação ─────────────────────────────────────────────────────────────
  function planSummary(plan) {
    const st = plan.stats;
    const lines = [U.plural(st.cards || 0, 'card', 'cards')];
    if (plan.kind === 'anki') {
      lines.push(U.plural(st.withHistory || 0, 'card com histórico', 'cards com histórico'));
      lines.push(U.plural(st.logs || 0, 'revisão registrada', 'revisões registradas'));
      lines.push(U.plural(st.new || 0, 'novo', 'novos'));
      if (st.suspended) lines.push(U.plural(st.suspended, 'suspenso', 'suspensos'));
      if (st.media) lines.push(U.plural(st.media, 'imagem', 'imagens'));
    } else if (plan.kind === 'json') {
      if (st.logs) lines.push(U.plural(st.logs, 'revisão registrada', 'revisões registradas'));
      if (plan.meta.includesScheduling) lines.push('com agendamento');
    } else if (plan.kind === 'text') {
      if (st.withHeader) lines.push(st.withHeader + ' no modelo (cabeçalho de assunto)');
    }
    return lines.join(' · ');
  }

  function previewTable(plan, options) {
    const rows = FC.importer.preview(plan, options, 6);
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', { text: 'Pergunta' }), h('th', { text: 'Classificação' }), h('th', { text: 'Baralho' }), h('th', { text: 'Revisão' }))),
        h(
          'tbody',
          null,
          rows.map((r) =>
            h(
              'tr',
              null,
              h('td', { text: FC.ui.plain(r.front, 90) }),
              h('td', { class: 'small', text: r.path.join(' › ') || '—' }),
              h('td', { class: 'small', text: r.deck.split('::').join(' › ') }),
              h('td', { class: 'small', text: options.keepScheduling && r.state !== 'new' ? { learning: 'Aprendendo', review: 'Em revisão' }[r.state] + (r.logs ? ' · ' + r.logs + ' rev.' : '') : 'Novo' }),
            ),
          ),
        ),
      ),
    );
  }

  function importPanel(presetDeckId) {
    const box = h('div', { class: 'stack' });
    const start = () => {
      FC.ui.add(FC.ui.clear(box), 
        FC.ui.dropzone({
          label: 'Arraste um arquivo ou clique para escolher',
          hint: 'CSV/TXT (modelo Anki ou planilha) · JSON (baralho com revisões) · .apkg/.colpkg do Anki (com agendamento e histórico) · backup',
          accept: '.csv,.txt,.tsv,.json,.apkg,.colpkg,text/csv,text/plain,application/json',
          onFile: read,
        }),
      );
    };
    async function read(file) {
      FC.ui.clear(box).appendChild(h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { id: 'impstatus', text: 'Lendo "' + file.name + '"…' })));
      try {
        const plan = await FC.importer.read(file, (msg) => {
          const s = document.getElementById('impstatus');
          if (s) s.textContent = msg;
        });
        showPlan(plan);
      } catch (e) {
        console.error(e);
        FC.ui.add(FC.ui.clear(box), FC.ui.callout('Não foi possível ler o arquivo: ' + e.message, 'crit'), button('Escolher outro', { onClick: start }));
      }
    }
    function showPlan(plan) {
      FC.ui.clear(box);
      if (plan.kind === 'backup') {
        FC.ui.add(box, 
          h('div', { class: 'row' }, icon('database', 20), h('strong', { text: plan.fileName })),
          FC.ui.callout('Este arquivo é um backup completo (' + U.plural(plan.stats.cards, 'card', 'cards') + ', ' + U.plural(plan.stats.logs, 'revisão', 'revisões') + '). Restaurar substitui TODOS os dados deste navegador.', 'warn'),
          h(
            'div',
            { class: 'row' },
            button('Restaurar backup', {
              variant: 'danger',
              onClick: async () => {
                if (!(await FC.ui.confirm('Substituir todos os cards, histórico e configurações deste navegador pelo backup?', { danger: true, okText: 'Restaurar' }))) return;
                try {
                  await FC.backup.restore(plan.backup, (m) => FC.ui.toast(m, { duration: 1500 }));
                  FC.ui.toast('Backup restaurado.');
                  FC.app.go('/');
                } catch (e) {
                  FC.ui.errorToast(e);
                }
              },
            }),
            button('Cancelar', { onClick: start }),
          ),
        );
        return;
      }
      if (!plan.rows.length) {
        FC.ui.add(box, FC.ui.callout('Nenhum card encontrado no arquivo.', 'warn'), button('Escolher outro', { onClick: start }));
        return;
      }
      const o = FC.importer.defaults(plan);
      if (presetDeckId && FC.decks.get(presetDeckId)) {
        o.deckMode = 'single';
        o.deckName = FC.decks.get(presetDeckId).name;
      }
      const preview = h('div');
      const refresh = () => FC.ui.clear(preview).appendChild(previewTable(plan, o));
      const areaList = [...new Set([...FC.store.nodes.values()].filter((n) => n.level === 0).map((n) => n.name).concat(['Clínica Médica', 'Cirurgia', 'Pediatria', 'Ginecologia e Obstetrícia', 'Medicina Preventiva']))];
      const subList = [...new Set([...FC.store.nodes.values()].filter((n) => n.level === 1).map((n) => n.name))];
      const areaIn = h('input', { class: 'input', value: o.areaName, list: 'imp-area' });
      const subIn = h('input', { class: 'input', value: o.subareaName, list: 'imp-sub' });
      areaIn.addEventListener('input', () => ((o.areaName = areaIn.value.trim()), refresh()));
      subIn.addEventListener('input', () => ((o.subareaName = subIn.value.trim()), refresh()));
      const classify = FC.ui.select(
        [
          { value: 'auto', label: 'Automático (cabeçalho do card → tags hierárquicas → nomes dos baralhos)' },
          { value: 'header', label: 'Pelo cabeçalho do card (Assunto › Tema › Subtema do modelo)' },
          { value: 'tags', label: 'Pelas tags hierárquicas (Assunto::Tema::Subtema)' },
          { value: 'deck', label: 'Pelos nomes dos baralhos (Área::Subárea::Assunto::Tema)' },
          { value: 'file', label: 'Pelas colunas/caminho do arquivo' },
          { value: 'none', label: 'Só grande área e subárea abaixo' },
        ],
        o.classify,
        { onchange: (e) => ((o.classify = e.target.value), baseFields.classList.toggle('hidden', o.classify === 'deck'), refresh()) },
      );
      const baseFields = h('div', { class: 'form-grid' + (o.classify === 'deck' ? ' hidden' : '') }, h('div', { class: 'field' }, h('label', { class: 'label', text: 'Grande área' }), areaIn, FC.ui.datalist('imp-area', areaList)), h('div', { class: 'field' }, h('label', { class: 'label', text: 'Subárea' }), subIn, FC.ui.datalist('imp-sub', subList)));
      const deckMode = FC.ui.select(
        [
          { value: 'file', label: 'Usar o baralho do arquivo' + (FC.importer.preview(plan, Object.assign({}, o, { deckMode: 'file' }), 1)[0] ? ' ("' + FC.importer.preview(plan, Object.assign({}, o, { deckMode: 'file' }), 1)[0].deck + '")' : '') },
          { value: 'single', label: 'Colocar todos em um baralho:' },
        ],
        o.deckMode,
        { onchange: (e) => ((o.deckMode = e.target.value), deckName.classList.toggle('hidden', o.deckMode !== 'single'), refresh()) },
      );
      const deckName = h('input', { class: 'input' + (o.deckMode === 'single' ? '' : ' hidden'), value: o.deckName, list: 'imp-decks' });
      deckName.addEventListener('input', () => ((o.deckName = deckName.value.trim()), refresh()));
      const hasSched = plan.kind === 'anki' || (plan.kind === 'json' && plan.meta.includesScheduling);
      const keep = FC.ui.checkbox('Manter as informações de revisão (agendamento, estabilidade/dificuldade, esquecimentos, suspensão e histórico)', o.keepScheduling, (v) => ((o.keepScheduling = v), refresh()));
      const dup = FC.ui.select(
        [
          { value: 'skip', label: 'Pular cards que já existem' },
          { value: 'update', label: 'Atualizar os que já existem (conteúdo e revisões)' },
          { value: 'keep', label: 'Importar mesmo assim (duplicar)' },
        ],
        o.duplicates,
        { onchange: (e) => (o.duplicates = e.target.value) },
      );
      const diff = FC.ui.select(
        [
          { value: '', label: 'Não definir' },
          { value: 'facil', label: 'Fácil' },
          { value: 'media', label: 'Média' },
          { value: 'dificil', label: 'Difícil' },
        ],
        '',
        { onchange: (e) => (o.difficulty = e.target.value) },
      );
      const extraTags = h('input', { class: 'input', placeholder: 'Ex.: tutoria ENARE' });
      extraTags.addEventListener('input', () => (o.extraTags = extraTags.value));
      const importBtn = button('Importar ' + U.plural(plan.rows.length, 'card', 'cards'), { variant: 'primary', size: 'lg', icon: 'upload' });
      importBtn.addEventListener('click', async () => {
        if (o.classify !== 'deck' && (!o.areaName || !o.subareaName)) return FC.ui.toast('Informe a grande área e a subárea.', { error: true });
        FC.ui.busy(importBtn, true, 'Importando…');
        try {
          const res = await FC.importer.execute(plan, o, (msg) => (importBtn.querySelector('span:last-child').textContent = msg));
          FC.ui.add(FC.ui.clear(box), 
            FC.ui.callout(
              h(
                'div',
                { class: 'stack tight' },
                h('strong', { text: 'Importação concluída' }),
                h('span', { text: [U.plural(res.created, 'card importado', 'cards importados'), res.updated ? U.plural(res.updated, 'atualizado', 'atualizados') : null, res.skipped ? U.plural(res.skipped, 'já existente pulado', 'já existentes pulados') : null, res.logs ? U.plural(res.logs, 'revisão do histórico', 'revisões do histórico') : null, res.media ? U.plural(res.media, 'imagem', 'imagens') : null].filter(Boolean).join(' · ') }),
              ),
              'good',
              'check',
            ),
            h('div', { class: 'row' }, link('Ver na hierarquia', '#/decks', { variant: 'primary' }), link('Revisar', '#/revisar'), button('Importar outro', { variant: 'ghost', onClick: start })),
          );
        } catch (e) {
          console.error(e);
          FC.ui.busy(importBtn, false);
          FC.ui.errorToast(e);
        }
      });
      FC.ui.add(box, 
        h('div', { class: 'row between' }, h('div', { class: 'row' }, icon(plan.kind === 'anki' ? 'layers' : 'file', 20), h('div', null, h('strong', { text: plan.fileName }), h('div', { class: 'small muted', text: KIND_TEXT[plan.kind] + ' · ' + planSummary(plan) }))), button('Trocar arquivo', { size: 'sm', variant: 'ghost', onClick: start })),
        plan.warnings && plan.warnings.length ? FC.ui.callout(plan.warnings.slice(0, 3).join(' · ') + (plan.warnings.length > 3 ? ' …' : ''), 'warn') : null,
        hasSched ? keep.el : null,
        h('div', { class: 'form-grid' }, FC.ui.field('Classificação', classify), h('div', { class: 'field' }, h('label', { class: 'label', text: 'Baralho' }), deckMode, deckName, FC.ui.datalist('imp-decks', FC.decks.all().map((d) => d.name)))),
        baseFields,
        h('div', { class: 'form-grid' }, FC.ui.field('Cards repetidos', dup), FC.ui.field('Dificuldade estimada (opcional)', diff), h('div', { class: 'full' }, FC.ui.field('Tags extras (opcional)', extraTags))),
        h('h3', { text: 'Prévia' }),
        preview,
        h('div', { class: 'row' }, importBtn),
      );
      refresh();
    }
    start();
    return box;
  }

  FC.views.importExport = {
    title: 'Importar e exportar',
    render(ctx) {
      const { el, query } = ctx;
      let scope = 'all';
      let scopeId = '';
      const scopeSel = FC.ui.select(
        [
          { value: 'all', label: 'Toda a coleção' },
          { value: 'deck', label: 'Um baralho' },
          { value: 'node', label: 'Uma área, assunto ou tema' },
          { value: 'fav', label: 'Favoritos' },
        ],
        scope,
      );
      const targetBox = h('div');
      const drawTarget = () => {
        FC.ui.clear(targetBox);
        if (scope === 'deck') {
          const sel = FC.ui.deckSelect(scopeId, { includeArchived: true });
          scopeId = sel.value;
          sel.addEventListener('change', () => (scopeId = sel.value));
          targetBox.appendChild(sel);
        } else if (scope === 'node') {
          const opts = [...FC.store.nodes.values()].map((n) => ({ value: n.id, label: FC.areas.breadcrumb(n.id) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
          if (!opts.length) return targetBox.appendChild(h('p', { class: 'muted', text: 'Sem classificação ainda.' }));
          const sel = FC.ui.select(opts, scopeId || opts[0].value);
          scopeId = sel.value;
          sel.addEventListener('change', () => (scopeId = sel.value));
          targetBox.appendChild(sel);
        }
      };
      scopeSel.addEventListener('change', () => {
        scope = scopeSel.value;
        scopeId = '';
        drawTarget();
      });
      const getCards = () => {
        if (scope === 'deck') return FC.decks.cardsIn(scopeId);
        if (scope === 'node') return FC.areas.cardsIn(scopeId);
        if (scope === 'fav') return FC.cards.select({ favorites: true, suspended: 'include', includeBlockedDecks: true });
        return FC.cards.all();
      };
      const labelOf = () => (scope === 'deck' ? (FC.decks.get(scopeId) || {}).name : scope === 'node' ? (FC.areas.get(scopeId) || {}).name : scope === 'fav' ? 'favoritos' : 'colecao');
      const form = exportForm(getCards, labelOf, null);
      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Importar e exportar' }), h('p', { text: 'Traga cards de CSV, JSON ou do Anki (com o histórico de revisões) e leve seus cards para onde quiser.' }))),
        h(
          'div',
          { class: 'stack loose' },
          h('section', { class: 'panel stack' }, h('h2', { text: 'Importar' }), importPanel(query.deck || null)),
          h(
            'section',
            { class: 'panel stack' },
            h('h2', { text: 'Exportar' }),
            h('div', { class: 'form-grid' }, FC.ui.field('O que exportar', scopeSel), h('div', { class: 'field' }, h('span', { class: 'label', text: ' ' }), targetBox)),
            form.el,
            h('div', { class: 'row' }, button('Baixar arquivo', { variant: 'primary', icon: 'download', onClick: form.go })),
          ),
          h(
            'section',
            { class: 'panel stack' },
            h('h2', { text: 'Backup completo' }),
            h('p', { class: 'ink2', text: 'Um único arquivo com tudo (cards, baralhos, hierarquia, histórico, estatísticas, configurações). Use para trocar de navegador/aparelho ou guardar uma cópia.' }),
            h('div', { class: 'row' }, link('Abrir em Configurações', '#/configuracoes', { icon: 'database' })),
          ),
        ),
      );
      drawTarget();
    },
  };

  FC.importView = { exportDialog, buildExport, slug };
})(typeof self !== 'undefined' ? self : this);
