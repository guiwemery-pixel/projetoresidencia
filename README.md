# Projeto Residente

Plataforma web colaborativa de estudos com **revisão espaçada adaptativa**, feita inicialmente para
estudantes de Medicina (residência / ENAMED), mas com arquitetura pronta para outras áreas.

Cada pessoa tem sua conta e vê **todos os próprios dados em detalhe**: horas, questões, acertos,
revisões, metas, simulados e provas. Do grupo de amigos, cada um vê **apenas um resumo visual**
do progresso dos outros (🟢🟡🟠🔴) e **comparações relativas** (acima, na média ou abaixo da média do
grupo em questões, acertos, tempo, flashcards, constância, revisões e assuntos), nunca os números.

```
GUILHERME
[████████████████░░░░] Progresso geral
📚 Estudos: bom ritmo        🟢
📝 Questões: bom desempenho  🟢
🔄 Revisões: em dia          🟢
🎯 Metas: 75% concluídas     🟢
```

## O que já funciona (MVP)

| Módulo | Destaques |
|---|---|
| **Contas e grupos** | Cadastro/login com sessão segura, avatar, perfil. Página **Administração** (só administradores): cadastrar e-mails de administradores e de acesso liberado, e escolher se qualquer pessoa cria conta ou só os e-mails liberados. Grupos com código/link de convite, vários grupos por pessoa, administração (remover integrante, trocar código). Comparativos de 7 ou 30 dias: destaques, você em relação ao grupo, ritmo do grupo, quadro por integrante e como cada um estuda. |
| **Registro de estudos** | Área → Subárea → Assunto (cria na hora), **vários assuntos no mesmo registro** (ex.: 30 questões de pancreatite aguda, crônica e neoplasias de pâncreas — as questões e o tempo são divididos, ou informados por assunto, e cada assunto recebe a sua própria revisão), vários tipos na mesma sessão (Teoria + Questões…), X/Y com acertos, erros e % calculados, banca, prova, dificuldade, tempo, observações e autoavaliação 😄🙂😐😕😣. |
| **Cronograma** | Importe o PDF do cronograma do cursinho (ou cole o texto): o site lê os módulos/semanas com a data de cada um, as aulas bônus e a área de cada assunto pela legenda de cores, e deixa você escolher quando começa o Módulo 01. Na importação o site pergunta **em quais dias você estuda e quantas horas por dia**: os assuntos de cada semana são **distribuídos de forma regular por esses dias**, na ordem do cronograma (ex.: 7 assuntos de segunda a sexta → 2, 2, 1, 1, 1), e as horas viram o **tempo sugerido** de cada assunto. Cada assunto aparece no seu dia (Cronograma, Revisões, Calendário, Início, folha impressa e Google Agenda); **Estudar** abre o registro já com o assunto e o tempo e, ao salvar, o item fica concluído e as revisões são agendadas. Dá para mudar os dias depois (**Dias de estudo**, que redistribui), mudar o dia de um assunto, pular, empurrar semanas e **excluir o cronograma**; no menu **⋯** de cada assunto (também no Calendário): editar o assunto, tirá-lo do cronograma ou excluí-lo. Semana que termina sem estudo deixa o assunto **atrasado**, como uma revisão. |
| **Importar planilha** | Em Estudos ou Perfil: envie .xlsx ou .csv (uma linha por estudo, ou uma linha por assunto com revisões lado a lado, inclusive com cabeçalho em duas linhas como “1ª REVISÃO” sobre Data · Questões · Acertos). Escolhe a aba com o histórico, entende data realizada × programada, organiza siglas (“NEFRO 2”, “OBS1”) nas grandes áreas e traz também as notas das abas de **simulados** e de **provas por instituição e ano**. Colunas ajustáveis, prévia, reimportação sem duplicar e revisões recalculadas pelo algoritmo. O arquivo é lido no navegador; só os dados vão para a conta de quem importa. |
| **Revisão espaçada adaptativa** | Com questões, os dias saem do percentual de acertos pelas tabelas da planilha de revisões (1ª revisão: 3/10/13/20/23 dias; seguintes: 7/13/18/25/30), ajustados pela quantidade de questões (25 é a referência; as sugestões nunca ficam abaixo de 25–30). Fases D0 → D10 → D21 → D60 → D90+ (reforço D3 abaixo de 60%); sem questões, a data vem da autoavaliação, do tempo, da dificuldade, do método e do histórico do assunto. Cada agendamento tem um **“Por quê?”**. |
| **Revisões e calendário** | Hoje / atrasadas / próximas / histórico, adiar/antecipar, calendário mensal com detalhe do dia e **folha semanal para imprimir/salvar em PDF** (A4, com caixas para marcar, acertos e anotações). **Limite de revisões por dia** (padrão 5; ajustável em Revisões, Calendário ou Perfil: 3, 5, 7, 10, outro número ou sem limite): o que passar vai para o dia anterior ou o seguinte, e volta quando abrir vaga. **Revisão atrasada há 20 dias** volta ao cronograma (“Assuntos para repetir”) para o assunto ser estudado de novo. Cada revisão traz **como estudar**, pelos últimos estudos do assunto: só teoria, aula ou flashcards até aqui → **faça questões**; muitas questões e pouca teoria (ou desempenho baixo) → **reveja a teoria e depois faça questões**; equilibrado → siga o plano da etapa. |
| **Google Agenda** | Em Calendário → **Google Agenda**: um link de agenda (iCal) só seu, que o Google Agenda (e o Calendário da Apple e o Outlook) assina e relê sozinho. Mostra as revisões pendentes (as atrasadas no dia de hoje), os assuntos do cronograma em cada dia de estudo e quantos flashcards há para revisar em cada dia — de dia inteiro ou num horário fixo, uma por assunto ou todas num evento por dia. Dá para gerar um link novo ou desligar. |
| **Dashboard** | Resumo do dia (revisões, atrasadas, questões planejadas, metas), semana, progresso, próximas atividades, estudos recentes, recomendações e comparação com o próprio histórico. **Personalizável**: arraste os balões, troque de coluna ou oculte (salvo por usuário). |
| **Métricas** | Tempo, sessões, dias, sequência; questões por dia/semana/mês; acertos ao longo do tempo; desempenho por área/subárea (com variação em p.p.) e por assunto; revisões. Filtros 7/30/90 dias, 6 meses, 1 ano e personalizado. Gráficos com alternância para tabela. |
| **Metas** | Diárias, semanais, mensais ou com prazo; progresso automático (questões, acertos, horas, dias, sessões, revisões, simulados, zerar atrasadas) ou manual; por área/assunto. |
| **Simulados** | Registro completo, agendamento, resultado por área, gráfico de evolução por banca. |
| **Banco de provas** | Banca → Prova (ex.: ENAMED → ENAMED 2025) → resultados; bancas personalizadas; link para o arquivo. |
| **Notificações** | Revisões do dia, atrasadas, meta perto do prazo, meta concluída, sequência de estudos, queda de desempenho, simulado agendado. |
| **Pesquisa global** | “dengue” → Pediatria · 4 revisões · 2 simulados · 86 questões · 78% de acertos. |
| **Privacidade** | Resumo público montado por lista de permissão, opção de não compartilhar, exportação, **apagar o progresso** (só o histórico, ou tudo voltando à estrutura inicial, sem perder a conta e os grupos) e exclusão da conta. |
| **Interface** | Responsiva (celular, tablet, desktop), modo claro/escuro/sistema, instalável (PWA). **Abre sem internet** com os dados da última vez; o que você registrar offline (estudo, remarcar revisão, item do cronograma) fica no aparelho e é enviado quando a conexão volta. |
| **Flashcards** | Aba do site (`/flashcards`): revisão espaçada FSRS com 5 botões (Errei · Difícil · Quase · Bom · Fácil; primeira aprendizagem 1 min/5 min/10 min/1 dia/2 dias; "Errei" é sempre 1 min, e o card volta na mesma sessão), Quick Review que não mexe no agendamento, hierarquia Área → Subárea → Assunto → Tema → Subtema, **pontos fracos no nível mais específico**, estatísticas, calendário, busca, favoritos, suspensos, geração de cards a partir de PDF com IA (Claude), importação do seu **modelo CSV** e de baralhos do **Anki (.apkg) com o histórico de revisões**, exportação (Anki CSV, CSV, TXT, JSON com revisões) e backup. **Dados na sua conta**, sincronizados entre aparelhos, com cópia local para funcionar offline. Aparece no Início (cards para hoje), no menu (contador), na pesquisa global e no **Registrar estudo** (ao terminar uma sessão). Aba **Cards da plataforma**: baralhos prontos para todos (guardados no Cloudflare R2, publicados por um administrador), para estudar sem entrar nas revisões ou entrando nelas, adicionar à coleção, editar e ocultar só para si. **Lixeira** (30 dias, restaura com o histórico), selecionar todos os cards de uma lista e baralhos/temas **fora da revisão geral** (estudados só quando abertos). **Cronômetro de estudo** opcional (cronômetro ou timer, com pausar, retomar e zerar): o tempo marcado vai para o Registrar estudo e entra no tempo estudado. Também existe uma **versão só de flashcards** em `/cards` (mesma conta e mesmos dados, sem o menu do site, instalável no celular como um app "Flashcards" à parte). Detalhes em [`docs/FLASHCARDS.md`](docs/FLASHCARDS.md). |

## Stack

- **Backend:** Node.js 22 · TypeScript · Express 5 · Prisma · PostgreSQL 16 · Zod
- **Frontend:** React 18 · Vite · TypeScript · Tailwind CSS · TanStack Query · React Router · Recharts
- **Testes:** Vitest + Supertest (motor de revisão + integração com banco real, incluindo privacidade/IDOR)

Detalhes e justificativas: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) ·
Algoritmo: [`docs/ALGORITMO-REVISAO.md`](docs/ALGORITMO-REVISAO.md)

## Como rodar

### Publicar na internet (Vercel)

Passo a passo em [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md): importar o repositório no
Vercel (raiz do projeto), conectar um banco Neon e fazer *Redeploy*.

### Opção 1 — Docker (mais simples)

```bash
docker compose up -d --build
# abra http://localhost:3333
```

Para popular com dados de demonstração (o PostgreSQL do compose fica exposto em `localhost:5432`):

```bash
npm install
cp backend/.env.example backend/.env   # já aponta para o banco do compose
npm run db:seed
```

### Opção 2 — Desenvolvimento local

Pré-requisitos: Node.js 22 e PostgreSQL 16 (ou `docker compose up -d db`).

```bash
npm install
cp backend/.env.example backend/.env      # ajuste DATABASE_URL se necessário
npm run db:migrate                         # cria as tabelas
npm run db:seed                            # (opcional) dados de demonstração
npm run dev                                # API em :3333 e frontend em :5173
```

Abra <http://localhost:5173>. Com o seed, entre com `guilherme@demo.com`, `joao@demo.com` ou
`maria@demo.com` — senha `estudos123` (os três estão no grupo “Residência 2027”).

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) + frontend (Vite) |
| `npm test` | Testes do backend (usa `TEST_DATABASE_URL`, um banco separado que é limpo a cada teste) |
| `npm run typecheck` | Verificação de tipos do backend e do frontend |
| `npm run build` | Build de produção (API em `backend/dist`, frontend em `frontend/dist`, com os flashcards) |
| `npm run test:flashcards` | Testes unitários dos flashcards (agendamento, pontos fracos, formatos; sem banco) |
| `npm run test:flashcards:e2e` | Teste de ponta a ponta da aba Flashcards no Chromium (Playwright): sobe a API com `TEST_DATABASE_URL` e o frontend compilado, e testa inclusive a sincronização entre dois aparelhos |
| `npm start` | Sobe a API compilada, que também serve o frontend |
| `npm run db:migrate` / `db:seed` | Migrations / dados de demonstração |

## Estrutura

```
backend/
  prisma/               schema.prisma, migrations, seed de demonstração
  src/
    app.ts, index.ts    servidor Express, rotas e job de notificações
    config/ lib/ middleware/
    modules/
      scheduler/        ⭐ motor de revisão espaçada (puro, sem banco, testado)
      reviews/          ponte banco ↔ motor, calendário, reagendamento, config do algoritmo
      studies/          registro de estudos e questões
      taxonomy/         áreas, subáreas, assuntos e templates (medicina, vazio…)
      progress/         indicador de progresso + resumo público (fronteira de privacidade)
      flashcards/       cópia dos flashcards na conta (sincronização entre aparelhos, resumo, busca)
      metrics/ goals/ mock-exams/ exams/ notifications/ insights/ search/ dashboard/
      auth/ users/ groups/
  tests/                testes de integração
frontend/
  src/
    api/                cliente HTTP e tipos
    components/         ui, layout, study (registro/“Por quê?”), charts
    pages/              uma página por aba (Flashcards.tsx monta o motor dos flashcards)
    flashcards/         ponte React ↔ motor dos flashcards, resumo do dia, limpeza ao sair
  public/flashcards/    bibliotecas de terceiros dos flashcards (pdf.js, sql.js, JSZip…)
flashcards/             motor da aba Flashcards (JS/CSS sem framework, testes) — ver docs/FLASHCARDS.md
docs/                   arquitetura, algoritmo e flashcards
```

## Próximos passos sugeridos

Importação de questões, IA para análise de desempenho e geração de questões,
ranking opcional, tags avançadas, notificações push (PWA), IA dos flashcards pelo servidor.
Veja em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md#preparado-para-crescer) onde cada uma se encaixa.
