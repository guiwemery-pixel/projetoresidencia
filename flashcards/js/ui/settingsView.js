/*
 * Configurações: revisão, estudo diário, algoritmo, pontos fracos, IA,
 * privacidade, sincronização com a conta, backup e dados.
 * O tema segue o do Projeto Residente (botão no topo do site).
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

      const showPath = FC.ui.checkbox('Mostrar área, assunto e tema no topo do card durante a revisão', s.showPathInReview, (v) => FC.settings.set({ showPathInReview: v }));

      // Cronômetro de estudo (ver js/timer.js)
      const timerOn = FC.ui.checkbox('Usar o cronômetro de estudo (relógio no topo dos flashcards)', s.studyTimer, (v) => FC.settings.set({ studyTimer: v }).then(() => ctx.rerender()));
      const timerAuto = FC.ui.checkbox('Iniciar sozinho ao começar uma revisão (e pausar ao sair dela)', s.studyTimerAuto, (v) => FC.settings.set({ studyTimerAuto: v }));
      const timerStudy = FC.ui.checkbox('Ao registrar o estudo no fim da sessão, usar o tempo do cronômetro', s.studyTimerForStudy, (v) => FC.settings.set({ studyTimerForStudy: v }));
      const timerBox = h(
        'div',
        { class: 'stack' },
        timerOn.el,
        s.studyTimer ? h('div', { class: 'stack', style: { paddingLeft: '26px' } }, timerAuto.el, timerStudy.el, h('div', null, FC.ui.button('Abrir o cronômetro', { icon: 'clock', size: 'sm', onClick: () => FC.timerView.openPanel() }))) : null,
      );

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
            FC.ui.field('Chave de API da Anthropic', key, 'Fica só neste navegador: não vai para a sua conta, para backups nem para exportações. Crie em console.anthropic.com. Qualquer pessoa com acesso a este navegador pode usá-la.'),
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

      // Conta e sincronização
      const mb = (bytes) => (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
      const syncBox = h('div', { class: 'stack' });
      const drawSync = (st) => {
        FC.ui.clear(syncBox);
        const statusText =
          st.status === 'syncing' ? 'Sincronizando…' : st.status === 'offline' ? 'Sem conexão' : st.status === 'error' ? 'Com problema' : st.lastSyncAt ? 'Em dia' : 'Aguardando';
        FC.ui.add(
          syncBox,
          h(
            'div',
            { class: 'tiles' },
            FC.ui.tile('Sincronização', statusText, st.lastSyncAt ? 'última: ' + U.formatDateTime(st.lastSyncAt) : null),
            FC.ui.tile('Alterações a enviar', U.fmtNum(st.pending || 0), st.pending ? 'guardadas neste aparelho' : 'tudo na conta'),
            FC.ui.tile('Espaço na conta', st.bytes != null ? mb(st.bytes) : '—', st.quota ? 'de ' + Math.round(st.quota / 1048576) + ' MB' : null),
            st.mediaStore === 'r2' ? FC.ui.tile('Imagens (Cloudflare R2)', st.mediaBytes != null ? mb(st.mediaBytes) : '—', st.mediaQuota ? 'de ' + Math.round(st.mediaQuota / 1048576) + ' MB' : null) : null,
          ),
          st.error && st.status !== 'ok' ? FC.ui.callout(st.error, st.status === 'offline' ? 'warn' : 'crit') : null,
          h(
            'div',
            { class: 'row' },
            button('Sincronizar agora', { icon: 'refresh', onClick: () => FC.sync.now() }),
            h('span', { class: 'small muted', text: 'Seus flashcards ficam na sua conta do Projeto Residente e aparecem em qualquer aparelho em que você entrar. Sem internet, tudo continua funcionando e é enviado quando a conexão voltar.' }),
          ),
        );
      };
      drawSync(FC.sync.status());
      ctx.on('sync', drawSync);

      // Dados
      const dataBox = h('div', { class: 'stack' });
      const est = await FC.db.estimate();
      const last = await FC.backup.lastBackupAt();
      FC.ui.add(dataBox, 
        h(
          'div',
          { class: 'tiles' },
          FC.ui.tile('Cards', U.fmtNum(FC.store.cards.size)),
          FC.ui.tile('Revisões registradas', U.fmtNum(FC.store.logs.length)),
          FC.ui.tile('Cópia neste aparelho', est && est.usage != null ? mb(est.usage) : '—', 'para abrir rápido e sem internet'),
          FC.ui.tile('Último backup', last ? U.formatDate(last) : 'nunca'),
        ),
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
                if (!(await FC.ui.confirm('Restaurar o backup de ' + U.formatDateTime(Date.parse(parsed.data.exportedAt)) + '? Todos os flashcards da sua conta serão substituídos por ele, em todos os aparelhos.', { danger: true, okText: 'Restaurar' }))) return;
                await FC.backup.restore(parsed.data);
                FC.ui.toast(FC.sync.status().pending ? 'Backup restaurado neste aparelho; vai para a conta quando houver conexão.' : 'Backup restaurado na sua conta.');
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
          button('Apagar todos os flashcards', {
            variant: 'danger',
            icon: 'trash',
            onClick: async () => {
              const typed = await FC.ui.prompt('Apagar tudo', '', { label: 'Isso apaga cards, histórico, baralhos e configurações dos flashcards da sua conta, em todos os aparelhos. O resto do Projeto Residente não é afetado. Digite APAGAR para confirmar.', okText: 'Apagar' });
              if (typed !== 'APAGAR') return typed != null && FC.ui.toast('Nada foi apagado.');
              await FC.db.wipe();
              await FC.settings.load();
              await FC.store.load();
              await FC.decks.ensureDefault();
              FC.cards.invalidateIndex();
              await FC.sync.flush();
              FC.ui.toast('Flashcards apagados.');
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
      // O PDF original fica só no aparelho em que foi enviado (o texto vai para a conta)
      const localPdfs = new Set();
      for (const src of sources) if (src.hasPdf && (await FC.db.get('sourceFiles', src.id))) localPdfs.add(src.id);
      const sourcesBox = sources.length
        ? h(
            'div',
            { class: 'list' },
            sources.map((src) =>
              h(
                'div',
                { class: 'list-item' },
                icon('file', 18),
                h('div', { class: 'grow' }, h('div', { text: src.fileName }), h('div', { class: 'tiny muted', text: U.plural(src.pageCount, 'página', 'páginas') + ' · ' + U.formatDate(src.addedAt) + (localPdfs.has(src.id) ? ' · PDF guardado neste aparelho' : ' · só o texto') })),
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
          section('Revisão', 'O tema claro/escuro segue o do Projeto Residente (botão no topo do site).', showPath.el),
          section(
            'Cronômetro de estudo',
            'Opcional. Cronômetro (conta para cima) ou timer (contagem regressiva), com iniciar, pausar, retomar e zerar. O tempo marcado vai para o "Registrar estudo" — e assim entra no seu tempo estudado do Projeto Residente.',
            timerBox,
          ),
          section(
            'Estudo diário',
            'Limites da revisão normal. O Quick Review não tem limite.',
            h('div', { class: 'form-grid' }, FC.ui.field('Cards novos por dia', numberInput('newPerDay', 0, 9999)), FC.ui.field('Revisões por dia (máximo)', numberInput('reviewsPerDay', 1, 99999)), FC.ui.field('Ordem dos cards novos', order), FC.ui.field('Virada do dia (hora)', numberInput('rolloverHour', 0, 23), 'Quem estuda depois da meia-noite continua no "dia anterior" até esse horário.')),
          ),
          section(
            'Algoritmo de revisão',
            'Primeira aprendizagem com intervalos fixos: Errei 1 min · Difícil 5 min · Quase 10 min · Bom 1 dia · Fácil 2 dias. Depois disso, FSRS: os intervalos de cada botão são calculados pela estabilidade e dificuldade de cada card. Ao repetir um card depois de errar numa revisão: Errei 1 min · Difícil 10 min · Quase 1 dia · Bom 2 dias · Fácil 3 dias.',
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
              h('li', { text: 'Cards, histórico, estatísticas e configurações ficam na sua conta do Projeto Residente, visíveis só para você (nem os grupos veem), e numa cópia neste navegador para funcionar sem internet.' }),
              h('li', { text: 'Ao sair da conta, a cópia deste navegador é apagada se tudo já tiver sido enviado.' }),
              h('li', { text: 'PDFs são lidos no próprio navegador: o texto extraído vai para a sua conta; o arquivo original fica só neste aparelho. O texto só vai para a IA quando você manda gerar cards e o modo não é o manual — e o app avisa antes.' }),
              h('li', { text: 'A chave de API fica só neste navegador: não vai para a conta nem para backups.' }),
              h('li', { text: 'Backups e exportações são arquivos que você baixa; guarde-os em local seguro.' }),
            ),
          ),
          section('Fontes (PDFs e textos)', 'Texto guardado para mostrar a página de origem de cada card.', sourcesBox),
          section('Sua conta', null, syncBox),
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
})(typeof self !== 'undefined' ? self : globalThis);
