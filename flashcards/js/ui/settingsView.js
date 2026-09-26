/*
 * Configurações: aparência, estudo diário, algoritmo, pontos fracos, IA,
 * privacidade, backup e dados.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon, link } = FC.ui;
  const U = FC.util;

  function numberInput(key, min, max, step) {
    const input = h('input', { class: 'input', type: 'number', min: String(min), max: String(max), step: String(step || 1), value: String(FC.settings.get(key)), style: { maxWidth: '140px' } });
    input.addEventListener('change', async () => {
      let v = Number(input.value);
      if (!isFinite(v)) v = FC.settings.DEFAULTS[key];
      v = U.clamp(v, min, max);
      input.value = String(v);
      await FC.settings.set({ [key]: v });
      FC.ui.toast('Salvo.');
    });
    return input;
  }

  function section(title, desc, ...children) {
    return h('section', { class: 'panel stack' }, h('div', null, h('h2', { text: title }), desc ? h('p', { class: 'small ink2', style: { marginTop: '4px' }, text: desc }) : null), children);
  }

  FC.views.settings = {
    title: 'Configurações',
    async render(ctx) {
      const { el } = ctx;
      const s = FC.settings.get();

      // Aparência
      const theme = FC.ui.seg(
        [
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Escuro' },
          { value: 'system', label: 'Sistema' },
        ],
        s.theme,
        (v) => FC.settings.set({ theme: v }),
      );
      const showPath = FC.ui.checkbox('Mostrar área, assunto e tema no topo do card durante a revisão', s.showPathInReview, (v) => FC.settings.set({ showPathInReview: v }));

      // Estudo
      const order = FC.ui.select(
        [
          { value: 'added', label: 'Na ordem em que foram adicionados' },
          { value: 'random', label: 'Aleatória' },
        ],
        s.newOrder,
        { onchange: (e) => FC.settings.set({ newOrder: e.target.value }) },
      );

      // IA
      const aiBox = h('div', { class: 'stack' });
      const drawAI = () => {
        const cur = FC.settings.get();
        FC.ui.clear(aiBox);
        const provider = FC.ui.seg(
          [
            { value: 'manual', label: 'Manual (copiar e colar)' },
            { value: 'anthropic', label: 'Minha chave da API' },
            { value: 'backend', label: 'Servidor' },
          ],
          cur.aiProvider,
          async (v) => {
            await FC.settings.set({ aiProvider: v });
            drawAI();
          },
        );
        FC.ui.add(aiBox, provider, FC.ui.callout(FC.ai.privacyNotice(), '', 'shield'));
        if (cur.aiProvider === 'manual') {
          aiBox.appendChild(h('p', { class: 'small ink2', text: 'O app monta o pedido completo (regras, texto do PDF e formato de resposta). Você cola numa conversa com o Claude e cola a resposta de volta. Não precisa de chave nem de servidor.' }));
        }
        if (cur.aiProvider !== 'manual') {
          const model = FC.ui.select(FC.ai.MODELS.map((m) => ({ value: m.id, label: m.label })), cur.aiModel, { onchange: (e) => FC.settings.set({ aiModel: e.target.value }) });
          const effort = FC.ui.select(
            [
              { value: 'medium', label: 'Médio (mais rápido)' },
              { value: 'high', label: 'Alto (padrão)' },
              { value: 'xhigh', label: 'Muito alto (mais lento)' },
            ],
            cur.aiEffort,
            { onchange: (e) => FC.settings.set({ aiEffort: e.target.value }) },
          );
          aiBox.appendChild(h('div', { class: 'form-grid' }, FC.ui.field('Modelo', model), FC.ui.field('Esforço de raciocínio', effort, 'Não se aplica ao Haiku.')));
        }
        if (cur.aiProvider === 'anthropic') {
          const key = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: FC.settings.getApiKey() ? '•••••••• (chave salva)' : 'sk-ant-…', 'aria-label': 'Chave de API' });
          FC.ui.add(aiBox, 
            FC.ui.field('Chave de API da Anthropic', key, 'Fica só neste navegador (IndexedDB) e nunca entra no backup nem em exportações. Crie em console.anthropic.com. Qualquer pessoa com acesso a este navegador pode usá-la.'),
            h(
              'div',
              { class: 'row' },
              button('Salvar chave', {
                variant: 'primary',
                onClick: async () => {
                  if (!key.value.trim()) return FC.ui.toast('Cole a chave primeiro.', { error: true });
                  await FC.settings.setApiKey(key.value.trim());
                  FC.ui.toast('Chave salva neste navegador.');
                  drawAI();
                },
              }),
              FC.settings.getApiKey()
                ? button('Remover chave', {
                    variant: 'danger',
                    onClick: async () => {
                      await FC.settings.setApiKey('');
                      FC.ui.toast('Chave removida.');
                      drawAI();
                    },
                  })
                : null,
            ),
          );
        }
        if (cur.aiProvider === 'backend') {
          const endpoint = h('input', { class: 'input', value: cur.aiEndpoint || '', placeholder: 'https://seu-servidor/api/flashcards/ai' });
          endpoint.addEventListener('change', () => FC.settings.set({ aiEndpoint: endpoint.value.trim() }));
          FC.ui.add(aiBox, FC.ui.field('Endereço do servidor', endpoint, 'O servidor guarda a chave e chama a IA. Contrato: POST {task, model, system, prompt, schema, maxTokens} → {output} (ver docs/FLASHCARDS.md).'));
        }
        const style = FC.ui.select(
          [
            { value: 'modelo', label: 'Meu modelo (pergunta curta, resposta em tópicos, pronto para o Anki)' },
            { value: 'livre', label: 'Livre' },
          ],
          cur.genStyle,
          { onchange: (e) => FC.settings.set({ genStyle: e.target.value }) },
        );
        aiBox.appendChild(FC.ui.field('Estilo dos cards gerados', style));
      };
      drawAI();

      // Dados
      const dataBox = h('div', { class: 'stack' });
      const est = await FC.db.estimate();
      const persisted = root.navigator && navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
      const last = await FC.backup.lastBackupAt();
      FC.ui.add(dataBox, 
        h(
          'div',
          { class: 'tiles' },
          FC.ui.tile('Cards', U.fmtNum(FC.store.cards.size)),
          FC.ui.tile('Revisões registradas', U.fmtNum(FC.store.logs.length)),
          FC.ui.tile('Espaço usado', est && est.usage != null ? (est.usage / 1048576).toFixed(1).replace('.', ',') + ' MB' : '—', est && est.quota ? 'de ' + Math.round(est.quota / 1048576) + ' MB disponíveis' : null),
          FC.ui.tile('Último backup', last ? U.formatDate(last) : 'nunca'),
        ),
        persisted ? FC.ui.callout('Armazenamento persistente ativo: o navegador não apaga seus dados para liberar espaço.', 'good', 'shield') : FC.ui.callout('O navegador pode apagar dados de sites pouco usados quando falta espaço. Faça backups periódicos (e instale o app na tela inicial, se possível).', 'warn'),
        h(
          'div',
          { class: 'row' },
          button('Exportar backup', {
            variant: 'primary',
            icon: 'download',
            onClick: async (e) => {
              const b = e.currentTarget;
              FC.ui.busy(b, true, 'Preparando…');
              try {
                const json = await FC.backup.exportBackup();
                FC.ui.download('flashcards_backup_' + new Date().toISOString().slice(0, 10) + '.json', json, 'application/json');
                FC.ui.toast('Backup exportado.');
              } catch (err) {
                FC.ui.errorToast(err);
              }
              FC.ui.busy(b, false);
            },
          }),
          button('Importar backup', {
            icon: 'upload',
            onClick: async () => {
              const file = await FC.ui.pickFile('.json,application/json');
              if (!file) return;
              try {
                const parsed = FC.formats.parseJson(await file.text());
                if (parsed.kind !== 'backup') return FC.ui.toast('Este arquivo não é um backup completo. Para cards/baralhos use Importar.', { error: true });
                if (!(await FC.ui.confirm('Restaurar o backup de ' + U.formatDateTime(Date.parse(parsed.data.exportedAt)) + '? Todos os dados atuais deste navegador serão substituídos.', { danger: true, okText: 'Restaurar' }))) return;
                await FC.backup.restore(parsed.data);
                FC.ui.toast('Backup restaurado.');
                FC.app.go('/');
              } catch (err) {
                FC.ui.errorToast(err);
              }
            },
          }),
          link('Importar/exportar cards', '#/importar', { variant: 'ghost', icon: 'upload' }),
        ),
        h('hr', { class: 'divider' }),
        h(
          'div',
          { class: 'row' },
          button('Apagar todos os dados', {
            variant: 'danger',
            icon: 'trash',
            onClick: async () => {
              const typed = await FC.ui.prompt('Apagar tudo', '', { label: 'Isso apaga cards, histórico, baralhos e configurações deste navegador. Digite APAGAR para confirmar.', okText: 'Apagar' });
              if (typed !== 'APAGAR') return typed != null && FC.ui.toast('Nada foi apagado.');
              await FC.db.wipe();
              await FC.settings.load();
              await FC.store.load();
              await FC.decks.ensureDefault();
              FC.cards.invalidateIndex();
              FC.ui.toast('Dados apagados.');
              FC.app.go('/');
            },
          }),
          button('Limpar classificações vazias', {
            variant: 'ghost',
            onClick: async () => {
              const n = await FC.areas.prune();
              FC.ui.toast(n ? U.plural(n, 'item vazio removido', 'itens vazios removidos') : 'Nada para limpar.');
            },
          }),
        ),
      );

      const sources = [...FC.store.sources.values()].sort((a, b) => b.addedAt - a.addedAt);
      const sourcesBox = sources.length
        ? h(
            'div',
            { class: 'list' },
            sources.map((src) =>
              h(
                'div',
                { class: 'list-item' },
                icon('file', 18),
                h('div', { class: 'grow' }, h('div', { text: src.fileName }), h('div', { class: 'tiny muted', text: U.plural(src.pageCount, 'página', 'páginas') + ' · ' + U.formatDate(src.addedAt) + (src.hasPdf ? ' · PDF guardado' : ' · só o texto') })),
                button('Remover', {
                  size: 'sm',
                  variant: 'ghost',
                  onClick: async () => {
                    if (!(await FC.ui.confirm('Remover o texto/PDF de "' + src.fileName + '"? Os cards continuam, só perdem o link para a página.'))) return;
                    await FC.pdf.removeSource(src.id);
                    ctx.rerender();
                  },
                }),
              ),
            ),
          )
        : h('p', { class: 'muted small', text: 'Nenhum PDF usado ainda.' });

      FC.ui.add(el, 
        h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Configurações' }))),
        h(
          'div',
          { class: 'stack loose' },
          section('Aparência', null, h('div', { class: 'row' }, h('span', { class: 'label', text: 'Tema' }), theme), showPath.el),
          section(
            'Estudo diário',
            'Limites da revisão normal. O Quick Review não tem limite.',
            h('div', { class: 'form-grid' }, FC.ui.field('Cards novos por dia', numberInput('newPerDay', 0, 9999)), FC.ui.field('Revisões por dia (máximo)', numberInput('reviewsPerDay', 1, 99999)), FC.ui.field('Ordem dos cards novos', order), FC.ui.field('Virada do dia (hora)', numberInput('rolloverHour', 0, 23), 'Quem estuda depois da meia-noite continua no "dia anterior" até esse horário.')),
          ),
          section(
            'Algoritmo de revisão',
            'Primeira aprendizagem com intervalos fixos: Errei 1 min · Difícil 5 min · Quase 10 min · Bom 1 dia · Fácil 2 dias. Depois disso, FSRS: os intervalos de cada botão são calculados pela estabilidade e dificuldade de cada card.',
            h('div', { class: 'form-grid' }, FC.ui.field('Retenção desejada', numberInput('desiredRetention', 0.7, 0.99, 0.01), 'Chance de lembrar no dia da revisão. 0,90 é o padrão; mais alto = revisões mais frequentes.'), FC.ui.field('Intervalo máximo (dias)', numberInput('maximumInterval', 1, 36500))),
          ),
          section(
            'Pontos fracos',
            'Um tema só é avaliado com dados suficientes; sem isso, a análise sobe para o assunto.',
            h('div', { class: 'form-grid' }, FC.ui.field('Mínimo de revisões', numberInput('weakMinReviews', 3, 500)), FC.ui.field('Mínimo de cards', numberInput('weakMinCards', 1, 100)), FC.ui.field('"Recente" = últimos (dias)', numberInput('weakRecentDays', 3, 90))),
            FC.ui.checkbox('Considerar as respostas do Quick Review na análise de pontos fracos (nunca no agendamento)', s.weakIncludeQuick, (v) => FC.settings.set({ weakIncludeQuick: v })).el,
          ),
          section('IA', 'Usada só para gerar e melhorar cards. Estatísticas e agendamento nunca vêm da IA.', aiBox),
          section(
            'Privacidade',
            null,
            h(
              'ul',
              { class: 'small ink2', style: { margin: 0, paddingLeft: '18px' } },
              h('li', { text: 'Cards, histórico, estatísticas e configurações ficam no banco local deste navegador (IndexedDB). Não há conta nem servidor.' }),
              h('li', { text: 'PDFs são lidos no próprio navegador. O texto só sai daqui quando você manda gerar cards e o modo de IA não é o manual — e o app avisa antes.' }),
              h('li', { text: 'A chave de API fica só neste navegador e não vai para backups.' }),
              h('li', { text: 'Backups e exportações são arquivos que você baixa; guarde-os em local seguro.' }),
            ),
          ),
          section('Fontes (PDFs e textos)', 'Texto guardado para mostrar a página de origem de cada card.', sourcesBox),
          section('Dados e backup', null, dataBox),
          section(
            'Atalhos de teclado',
            null,
            h(
              'div',
              { class: 'grid two small' },
              [
                ['Espaço / Enter', 'Mostrar resposta'],
                ['1 – 5', 'Errei · Difícil · Quase · Bom · Fácil'],
                ['1 – 3 (Quick Review)', 'Não sei · Quase · Sei'],
                ['Z', 'Desfazer última resposta'],
                ['E', 'Editar o card (revisão)'],
                ['/', 'Buscar'],
                ['Ctrl + Enter', 'Salvar no editor de card'],
                ['Esc', 'Fechar janela'],
              ].map(([k, v]) => h('div', { class: 'row' }, h('kbd', { text: k }), h('span', { class: 'ink2', text: v }))),
            ),
          ),
        ),
      );
    },
  };
})(typeof self !== 'undefined' ? self : this);
