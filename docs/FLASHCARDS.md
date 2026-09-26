# Flashcards — plataforma de estudo com revisão espaçada

App web de flashcards para medicina: revisão espaçada (FSRS), Quick Review, organização
hierárquica, análise de pontos fracos no nível mais específico, geração de cards a partir de
PDFs com IA e importação de baralhos do Anki **com o histórico de revisões**.

Fica em [`flashcards/`](../flashcards) e é um app **estático** (HTML + CSS + JavaScript, sem
build): os dados ficam no **IndexedDB do navegador**, sem conta e sem servidor.

## Como abrir

| Onde | Como |
|---|---|
| Publicado com o Projeto Residente | `https://<seu-domínio>/flashcards/index.html` (link "Flashcards" no menu). `npm run build` copia a pasta para `frontend/dist/flashcards`. |
| No computador, sem servidor | Abra `flashcards/index.html` no Chrome/Edge (duplo clique). Tudo funciona, inclusive PDF e Anki. |
| Servidor local | `npx http-server flashcards -p 8080` e abra <http://localhost:8080>. |

Online, um *service worker* guarda o app para abrir sem internet depois da primeira visita.
Os dados são por navegador/aparelho: para levar a coleção para outro lugar use **Backup**
(Configurações) ou exporte baralhos em **JSON com revisões**.

## Estrutura

```
flashcards/
├── index.html, manifest.webmanifest, sw.js
├── css/  style.css · dashboard.css · review.css · responsive.css
├── js/
│   ├── util.js          datas, texto, CSV (puro)
│   ├── database.js      IndexedDB (só persistência)
│   ├── store.js         estado em memória + eventos
│   ├── settings.js      configurações (a chave da IA fica à parte, fora do backup)
│   ├── scheduler.js     ⭐ quando revisar (FSRS-5 + primeira aprendizagem) — puro
│   ├── review.js        sessão de revisão normal (fila, limites, desfazer)
│   ├── quickReview.js   sessão de Quick Review (não toca no scheduler) — puro
│   ├── performance.js   ⭐ desempenho e pontos fracos — puro
│   ├── difficulty.js    dificuldade estimada do conteúdo — puro
│   ├── statistics.js    métricas, séries, sequência, previsão — puro
│   ├── cards.js · decks.js · areas.js   domínio (cards, baralhos, hierarquia)
│   ├── export.js        formatos: modelo Anki CSV, CSV, TXT, JSON (puro)
│   ├── anki.js          leitura de .apkg/.colpkg com agendamento e revlog
│   ├── importer.js      fluxo de importação (prévia → gravação)
│   ├── backup.js        backup/restauração completos
│   ├── pdf.js           PDF → texto por página (pdf.js)
│   ├── ai.js            ⭐ camada de IA (prompts, provedores, validação)
│   ├── sanitize.js      limpeza do HTML dos cards
│   ├── loader.js        carrega as bibliotecas de assets/vendor sob demanda
│   ├── app.js           rotas, layout, tema, atalhos
│   └── ui/              uma tela por arquivo (dashboard, revisão, quick, decks, gerar,
│                        pontos fracos, estatísticas, calendário, busca, importar, config.)
├── assets/vendor/       pdf.js, sql.js, JSZip, fzstd, SDK da Anthropic (ver LICENSES.md)
└── tests/               unit/*.test.js (node --test) · e2e.mjs (Playwright) · fixtures/
```

Os módulos marcados como "puro" não usam DOM nem banco e funcionam no Node (são os testados
em `tests/unit`). A interface só chama as funções dos módulos; o scheduler não conhece a tela
nem a IA.

### Três conceitos separados

| Conceito | Pergunta | Onde |
|---|---|---|
| **Scheduler** | Quando devo revisar este card? | `scheduler.js` (estado `dueDate`, `stability`, `difficulty`, `state`…) |
| **Performance** | Como estou me saindo? | `performance.js` (calculado do histórico de revisões) |
| **Difficulty** | Qual a dificuldade estimada do conteúdo? | `difficulty.js` (atribuída pela IA/manual, ajustada pelo FSRS) |

## Modelo de dados

```js
// card
{ id, front, back, deckId,
  nodeId,                                   // nível mais profundo da hierarquia
  areaId, subareaId, subjectId, topicId, subtopicId,   // derivados de nodeId
  tags: [], source: { fileName, page, sourceId }, reference,
  createdAt, updatedAt,
  state: 'new' | 'learning' | 'review', dueDate, lastReview,
  stability, difficulty, repetitions, lapses, scheduledDays,
  estDifficulty: 'facil' | 'media' | 'dificil', estDifficultyBy: 'ia' | 'manual' | 'import',
  favorite, suspended, cardType, origin, externalId }

// registro de revisão (tabela logs, indexada por cardId e data)
{ id, cardId, date, rating (1–5), previousInterval, newInterval, responseTime,
  stateBefore, stateAfter, stabilityBefore/After, difficultyBefore/After,
  retrievability, elapsedDays, sessionId, source: 'review' | 'anki' | 'import' }

// nó da hierarquia
{ id, name, level: 0 área · 1 subárea · 2 assunto · 3 tema · 4 subtema, parentId }
```

O histórico fica numa tabela própria (`logs`) em vez de dentro do card: as estatísticas
varrem todas as revisões por data, e cada card busca as suas pelo índice `cardId`.
Outras tabelas: `decks`, `quickSessions`, `sessions`, `sources` (texto dos PDFs),
`sourceFiles` (PDF original, opcional), `media` (imagens do Anki), `drafts` (cards gerados
aguardando revisão), `kv` (configurações).

## Algoritmo de revisão

**Primeira aprendizagem** (card novo até "formar"), intervalos exatos:

| Errei | Difícil | Quase | Bom | Fácil |
|---|---|---|---|---|
| 1 min | 5 min | 10 min | 1 dia | 2 dias |

"Bom" ou "Fácil" formam o card; depois disso vale o **FSRS-5** (19 parâmetros padrão,
retenção desejada 90%, configurável). O FSRS tem 4 notas; as 5 respostas entram assim:

| Resposta | Nota FSRS | Efeito |
|---|---|---|
| Errei | Again (1) | esquecimento: conta lapso, estabilidade pós-lapso, mínimo 1 dia |
| Difícil | Hard (2) | penalidade de "Hard" |
| Quase | 2,5 | metade da penalidade de "Hard" (média geométrica) |
| Bom | Good (3) | — |
| Fácil | Easy (4) | bônus de "Easy" |

Os intervalos mostrados embaixo de cada botão são os que serão aplicados, sempre em ordem
(Difícil < Quase < Bom < Fácil). Mesmo durante a primeira aprendizagem a estabilidade e a
dificuldade FSRS são atualizadas (fórmula de curto prazo), então o card chega ao agendamento
normal com um estado de memória coerente. O dia de estudo vira às 4h (ajustável).

**Revisão normal** mostra só o que o scheduler liberou: aprendizagem vencida → revisões
vencidas (limite diário) → cards novos (limite diário), respeitando suspensões e baralhos
arquivados/suspensos. "Z" desfaz a última resposta (restaura o card e apaga o registro).

## Quick Review

Revisa **todos** os cards da seleção (baralhos, áreas, subáreas, assuntos, temas, tags ou
favoritos), vencidos ou não, com três respostas. Não altera `dueDate`, intervalo,
estabilidade, dificuldade, estado nem o histórico principal — só grava o resumo em
`quickSessions`. Reapresentação na própria sessão:

- **Não sei** → volta depois de 2 cards · **Quase** → depois de 6 cards
- **Sei** → sai se acertou de primeira; se já tinha errado, o espaçamento dobra (10, 20…) e
  sai após dois "Sei" seguidos.

O relatório conta a primeira resposta de cada card (Sei + Quase + Não sei = revisados;
aproveitamento = Sei / revisados) e aponta a maior dificuldade da sessão.

## Pontos fracos

Para cada nível da hierarquia soma-se o histórico real dos cards (acerto = qualquer resposta
diferente de "Errei"):

- **acerto suavizado**: revisões recentes pesam mais (meia-vida de 30 dias) e, com poucos
  dados, a taxa fica perto da sua média geral (força 8) — 33% em 3 revisões não passa na
  frente de 55% em 80;
- **necessidade de revisão** = 40% (1 − acerto suavizado) + 15% taxa de erro recente
  (14 dias) + 10% esquecimentos/revisões + 10% dificuldade FSRS média + 10% (1 − memória
  estimada hoje) + 10% cards errados 2+ vezes seguidas + 5% tendência de piora;
- **dados mínimos**: 10 revisões e 3 cards (configurável). A lista mostra o **nível mais
  específico** com dados suficientes; sem dados no tema, sobe para o assunto, e assim por
  diante. Sem dados em lugar nenhum: "Dados insuficientes".
- **tendência**: primeira × segunda metade das últimas até 60 revisões, teste de duas
  proporções (|z| ≥ 1,96 = melhora/piora significativa); "estável" só se não oscila.

Indicadores: maior dificuldade atual (maior necessidade), recente (pior acerto dos últimos
14 dias), maior evolução e maior piora recente (tendências significativas). "O que eu
preciso estudar novamente?" lista os primeiros com os motivos em números — nada disso vem
da IA. A prioridade analítica de cada card (erros, erros recentes, estabilidade baixa,
dificuldade alta) só ordena listas; não mexe no agendamento.

## Importação

| Formato | O que traz |
|---|---|
| **CSV/TXT no modelo Anki** (`#separator`, `#html`, `#deck`, `#columns`, `#tags column`) | Frente/verso. O bloco `assunto-tag` (Assunto + "Tema › Subtema") vira a classificação e é tirado da frente; "Pergunta:"/"Resposta:" também. |
| Planilha CSV com títulos | Colunas reconhecidas: Frente/Pergunta, Verso/Resposta, Tags, Baralho, Grande área, Subárea, Assunto, Tema, Subtema, Fonte, Página, Dificuldade, Referência. |
| **JSON de baralho** (exportado por este app) | Cards, classificação, baralho, tags, fonte e — se exportado "com agendamento" — estado FSRS e histórico completo. |
| **Anki `.apkg` / `.colpkg`** | Coleções antigas (`collection.anki2/anki21`, JSON) e novas (`collection.anki21b`, zstd + protobuf). Modelos renderizados (campos, seções, `{{FrontSide}}`, cloze), imagens, tags, sub-baralhos, suspensão, vencimento, intervalo, repetições, esquecimentos e o **revlog** inteiro. Estabilidade/dificuldade: as do FSRS do próprio Anki quando existem; senão, recalculadas repassando o histórico (como o Anki faz ao ativar o FSRS). Respostas: De novo→Errei, Difícil→Difícil, Bom→Bom, Fácil→Fácil. |
| Backup completo | Restaura tudo (substitui os dados do navegador). |

Classificação "Automático": cabeçalho do card → caminho/colunas do arquivo → tag hierárquica
(`Assunto::Tema::Subtema`) → baralho com `::` → grande área/subárea escolhidas na prévia.
Cards repetidos (mesmo id externo ou mesmo texto) são pulados, atualizados (conteúdo +
agendamento + revisões que faltam) ou duplicados, conforme a opção.

## Exportação

Modelo Anki CSV (idêntico ao seu padrão: cabeçalhos, `assunto-tag`, "Pergunta:", "Resposta:",
tags `CancerGastrico::Epidemiologia::BrasilINCA`), CSV com os campos escolhidos, TXT legível,
JSON só dos cards ou **JSON com agendamento e histórico**. Por coleção, baralho, nó da
hierarquia, favoritos, resultados de busca ou seleção.

## IA

`ai.js` monta os pedidos (regras de active recall, uma unidade por card, o que priorizar e
evitar, o estilo do seu modelo, classificação na hierarquia, tamanho da resposta, tipo de card
e dificuldade) e valida as respostas com **structured outputs** (esquema JSON). Tarefas:
gerar de um bloco de texto, refazer, simplificar, detalhar, card complementar, sugerir temas
para um ponto fraco e gerar cards direcionados.

Regras de fonte: com texto (PDF), a IA só pode usar o texto e informa a página pelas marcas
`[[Página N]]`; sem texto, só cita diretriz/revisão que tem certeza de que existe e nunca
inventa DOI. PDFs grandes são divididos em blocos de ~100 mil caracteres e a quantidade de
cards é repartida proporcionalmente.

| Provedor | Como funciona | Chave |
|---|---|---|
| **Manual** (padrão) | O app mostra o pedido para copiar no Claude e um campo para colar o JSON de volta. | nenhuma |
| **Minha chave da API** | Chamada direta do navegador com o SDK oficial `@anthropic-ai/sdk` (streaming, `output_config.format`, esforço configurável). Modelo padrão `claude-opus-5` com `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) para o caso de recusa. | guardada só no IndexedDB deste navegador; nunca vai para backup/exportação |
| **Servidor** | `POST` para um endpoint seu, que guarda a chave. Recomendado para uso multiusuário. | no servidor |

Contrato do servidor (para implementar depois, por exemplo em `backend/src/modules/ai`):

```http
POST /api/flashcards/ai          (cookies de sessão enviados: credentials: 'include')
Content-Type: application/json

{ "task": "generate" | "regenerate" | "simplify" | "detail" | "complement" | "suggest" | "targeted",
  "model": "claude-opus-5", "system": "...", "prompt": "...",
  "schema": { ...JSON Schema... }, "maxTokens": 64000 }

200 → { "output": { "cards": [...] } }   ou   { "text": "<JSON>" }
```

O servidor deve autenticar o usuário, limitar uso e chamar a API com `output_config.format`
usando o `schema` recebido. Se o Projeto Residente for servido pelo backend Express, a CSP já
libera `connect-src https://api.anthropic.com` para o modo "Minha chave".

## Privacidade

Cards, histórico, estatísticas e configurações ficam no navegador. PDFs são lidos localmente;
o texto só sai quando você manda gerar com um provedor que não seja o manual, e a tela avisa
antes o que será enviado e para onde. O app pede armazenamento persistente ao navegador e
lembra de fazer backup.

## Testes

```bash
npm run test:flashcards          # unitários (node --test): scheduler, Quick Review,
                                 # pontos fracos, formatos, conversão do Anki, estatísticas
npm run test:flashcards:e2e      # ponta a ponta no Chromium (Playwright): importa o CSV modelo
                                 # e os .apkg de teste, revisa, desfaz, Quick Review sem mudar o
                                 # agendamento, pontos fracos, PDF → IA (API simulada), JSON com
                                 # revisões, backup, file://, celular e tema escuro
node flashcards/tests/e2e.mjs <pasta>   # idem, salvando screenshots
node flashcards/tests/fixtures/make-apkg.js   # regenera os pacotes do Anki de teste
```

## Limitações e próximos passos

- PDFs digitalizados (imagem) não têm texto: falta OCR.
- Dados por navegador; sincronização em nuvem/login usariam a mesma interface de
  `database.js` apontando para uma API (o resto do app não muda).
- Endpoint de IA no backend (contrato acima), otimização dos parâmetros do FSRS pelo
  histórico, gestos de swipe no celular e integração com o registro de estudos do Projeto
  Residente.
