# Flashcards — aba do Projeto Residente

Flashcards de medicina dentro do Projeto Residente: revisão espaçada (FSRS), Quick Review,
organização hierárquica, análise de pontos fracos no nível mais específico, geração de cards a
partir de PDFs com IA e importação de baralhos do Anki **com o histórico de revisões**.

É uma aba do site (**Flashcards** no menu, endereço `/flashcards`), com o mesmo login, menu e tema.
Os dados ficam **na sua conta** e aparecem em qualquer aparelho em que você entrar; cada aparelho
guarda uma cópia para abrir na hora e funcionar sem internet.

## Onde aparece no site

| Lugar | O quê |
|---|---|
| Menu lateral | **Flashcards**, com o número de cards para hoje (revisões que vencem hoje + novos liberados). |
| `/flashcards/...` | A aba: Início, Revisar, Quick Review, Decks, **Cards da plataforma**, Gerar com IA, Importar, Pontos fracos, Estatísticas, Calendário e ⚙ Configurações. Cada tela tem endereço próprio (`/flashcards/decks`, `/flashcards/revisar`…) e o voltar do navegador funciona. |
| Início do site | Balão **Flashcards** (para revisar hoje, novos, revisados hoje com % de acerto, sequência, "Revisar agora"). Pode ser movido/ocultado em *Personalizar*. |
| Registrar estudo | Ao terminar uma revisão ou Quick Review, **Registrar estudo** abre o diálogo do site com o método *Flashcards*, o tempo da sessão, um resumo nas observações e o **assunto** já escolhido quando existe na plataforma um assunto com o mesmo nome do assunto mais frequente da sessão. Assim a sessão entra no histórico, nas métricas, nas metas e no agendamento de revisões do assunto. |
| Cronômetro de estudo | Opcional (⚙ Configurações → *Cronômetro de estudo*). Relógio no topo da aba, com **cronômetro** (conta para cima) ou **timer** (contagem regressiva), iniciar · pausar · retomar · zerar. O tempo marcado vai para o **Registrar estudo** e entra no tempo estudado do site. Ver [Cronômetro de estudo](#cronômetro-de-estudo). |
| Pesquisa global | Seção **Flashcards** com os cards que contêm o termo (frente, verso ou tags). |
| Tema | Claro/escuro do site (botão no topo) vale para os flashcards. |

Endereços da versão anterior (`/flashcards/index.html#/decks`) levam à tela equivalente.

## Versão só de flashcards (`/cards`)

Os mesmos flashcards, na mesma conta, numa tela própria sem o menu do Projeto Residente — para
quem quer abrir direto nos cards. O que você faz numa versão aparece na outra (é a mesma coleção).

| | Aba do site | Só flashcards |
|---|---|---|
| Endereço | `/flashcards`, `/flashcards/revisar`… | `/cards`, `/cards/revisar`… |
| Menu do site, Início, busca global | sim | não (barra própria com "Projeto Residente ↗", tema, perfil e sair) |
| Nome e ícone ao instalar | Projeto Residente | **Flashcards** (manifesto `cards.webmanifest`, ícones `icons/flashcards-*`) |
| Registrar estudo, sincronização, offline | sim | sim |

- **Alternar:** menu ⋯ dos flashcards → "Abrir só os flashcards (app separado)" ou "Abrir dentro do
  Projeto Residente", na mesma tela.
- **Instalar no celular:** abra `https://<seu-site>/cards` → *Adicionar à tela inicial* (Safari:
  compartilhar; Chrome: menu ⋮ → *Instalar app*). Fica um ícone "Flashcards" separado do
  "Projeto Residente". O `theme-init.js` troca nome, ícone e manifesto antes de a página abrir.
- **Login:** entrando por `/cards`, a tela de login aparece como "Entrar nos Flashcards" e volta
  para o app depois de entrar (a mesma conta vale para os dois).
- **Domínio próprio (opcional):** no Vercel, *Settings → Domains* → adicione outro domínio ao mesmo
  projeto, começando por `flashcards` (ex.: `flashcards-seunome.vercel.app`). Nesse domínio, a página
  inicial abre direto a versão só de flashcards. É outro endereço, então o login é separado (mesma
  conta e senha).

## Estrutura

```
flashcards/                 motor da aba (JavaScript sem framework; testado à parte)
├── css/  style.css · dashboard.css · review.css · responsive.css · embed.css
│         (tudo dentro de .fc-root: nada vaza para o resto do site)
├── js/
│   ├── util.js          datas, texto, CSV (puro)
│   ├── database.js      banco local por usuário (IndexedDB) + fila de envio (outbox)
│   ├── sync.js          ⭐ sincronização com a conta (envio, recebimento, recomeço, offline)
│   ├── platform.js      cards da plataforma: catálogo, o que é só do usuário, coleção, sessões, publicar
│   ├── summary.js       resumo do dia para o Início e o menu do site
│   ├── legacy.js        leva para a conta os dados da versão anterior (só no navegador)
│   ├── store.js         estado em memória + eventos
│   ├── settings.js      configurações (a chave da IA fica à parte, fora do backup)
│   ├── timer.js         cronômetro/timer de estudo (estado neste aparelho) — sem DOM
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
│   ├── loader.js        carrega as bibliotecas de terceiros sob demanda
│   ├── app.js           mount/unmount na página do site, abas, rotas internas, atalhos
│   └── ui/              uma tela por arquivo (dashboard, revisão, quick, decks, gerar,
│                        pontos fracos, estatísticas, calendário, busca, importar, config.)
└── tests/               unit/*.test.js (node --test) · e2e.mjs (Playwright) · fixtures/

frontend/src/pages/Flashcards.tsx     página /flashcards/*: carrega e monta o motor
frontend/src/pages/FlashcardsApp.tsx  versão só de flashcards (/cards): barra própria + o mesmo motor
frontend/src/flashcards/              engine.ts (importa o motor na ordem), today.ts (números
                                      do dia a partir do resumo), local.ts (limpeza ao sair),
                                      standalone.ts (endereço /cards, domínio próprio, nome/ícone)
frontend/public/flashcards/vendor/    pdf.js, sql.js, JSZip, fzstd, SDK da Anthropic (LICENSES.md)
backend/src/modules/flashcards/       cópia na conta: sincronização, resumo, busca; platform.ts
                                      (cards da plataforma no Cloudflare R2)
```

O motor é carregado só quando a aba abre (um pedaço separado do build, ~100 KB comprimido). O
React é dono da URL, do menu, do tema e do login: `FC.app.go('/decks')` pede a navegação ao React,
que avisa de volta (`FC.app.onLocation`). Janelas, avisos e menus do app ficam num contêiner
`.fc-root` no fim da página.

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
`sourceFiles` (PDF original, opcional, só no aparelho), `media` (imagens do Anki), `drafts`
(cards gerados aguardando revisão), `kv` (configurações), `trash` (lixeira, abaixo), e as de
controle do aparelho: `outbox` (o que falta enviar) e `meta` (cursor, epoch).

### Lixeira

Excluir cards, um baralho ou uma área/tema (menu ⋯ → Excluir) manda tudo para a **Lixeira**
(menu ⋯ da barra de abas → Lixeira), onde fica **30 dias** e pode ser restaurado — com o
histórico de revisões. Depois de excluir aparece o aviso "… foi para a lixeira · Desfazer".
Cada exclusão é um lote; cada item é um registro do store `trash`, sincronizado com a conta
(`js/trash.js`):

```js
{ id: 't:<store>:<id>', batch, label, deletedAt, store: 'cards' | 'decks' | 'nodes',
  value,        // o registro como era
  logs,         // card: o histórico, que volta junto
  cardIds }     // área excluída "mantendo os cards": onde cada card estava
```

Ao restaurar: área/baralho que voltou a existir com o mesmo nome recebe os cards; o que perdeu
o "pai" volta para o primeiro nível; card cujo baralho não existe mais vai para um baralho que
existe. Cards da plataforma vão para a conta sem frente/verso (como no store `cards`) e são
completados ao restaurar. "Excluir de vez" e "Esvaziar lixeira" não têm volta; lotes com mais
de 30 dias saem sozinhos na abertura do app.

Ao excluir um baralho ou uma área, o padrão é levar os cards junto (para a lixeira); dá para
escolher mover os cards para outro baralho ou mantê-los no nível de cima. Cards sem área
aparecem em **Sem classificação** (aba Decks), com ▶ Estudar, "Excluir todos" e a lista para
selecionar todos e mover.

### Cronômetro de estudo

Opcional e desligado por padrão: ⚙ **Configurações → Cronômetro de estudo → "Usar o cronômetro
de estudo"**. Com ele ligado, aparece um relógio no topo da aba (ao lado de "Salvo na conta");
tocar nele abre o painel:

| | |
|---|---|
| **Cronômetro** | Conta para cima: **Iniciar**, **Pausar**, **Retomar**, **Zerar** (com "Desfazer"). |
| **Timer** | Contagem regressiva de 5, 10, 15, 25, 30, 45, 60 ou 90 min (ou outro valor, 1 a 360). No fim: som, vibração no celular e o aviso "⏰ Tempo esgotado: N min de estudo · Registrar estudo". Para trocar entre cronômetro e timer, zere antes (os tempos não se misturam). |
| **Registrar estudo com este tempo** | Abre o **Registrar estudo** do site com o método *Flashcards* e a duração marcada. |
| Iniciar sozinho | (padrão: ligado) começa a contar ao abrir uma revisão, um Quick Review ou um estudo dos cards da plataforma, e pausa ao sair dela. |
| Usar no fim da sessão | (padrão: ligado) com pelo menos 1 minuto marcado, o **Registrar estudo** do resumo da sessão usa o tempo do cronômetro no lugar da duração da sessão. |

É assim que o tempo entra na **estatística de tempo estudado** do site: vira um estudo
(método Flashcards) com essa duração — métricas, metas e histórico passam a contar esse tempo.
O cronômetro **pausa** ao abrir o registro e só **zera** quando o estudo é salvo (ou fica na fila
sem internet); se o registro for cancelado, o tempo continua lá.

O estado (`js/timer.js`) fica neste aparelho (`localStorage`, uma chave por usuário) e é
calculado pelo relógio: trocar de aba, bloquear a tela ou recarregar a página não perde tempo, e
um timer que terminou com a página fechada avisa na próxima abertura. A tela fica em
`js/ui/timerView.js`.

## Dados na conta e sincronização

As regras (FSRS, filas, análises) rodam no navegador, como antes; o servidor guarda uma cópia de
cada registro e distribui as mudanças entre os aparelhos. Nada do motor precisou mudar além de
`database.js`: toda gravação continua passando por `FC.db`.

**No servidor** (`backend/src/modules/flashcards`, tabelas `flashcard_records` e `flashcard_sync`):
cada registro é um documento JSON identificado por (usuário, tabela, id), com uma **versão**. As
versões de um usuário são distribuídas com a linha de `flashcard_sync` travada até o fim da
transação, então são confirmadas em ordem — um aparelho nunca pula uma gravação.

| Rota | O que faz |
|---|---|
| `GET /api/flashcards/sync?since=&epoch=` | O que mudou depois do cursor, em ordem de versão, em páginas de até ~2,5 MB (exclusões vêm como `d: null`). Pede `reset` se o cursor não serve mais. |
| `POST /api/flashcards/sync` `{epoch, ops:[{s, id, d \| del}]}` | Grava um lote (até ~1,2 MB; imagens até ~2,5 MB). Última gravação vence. |
| `POST /api/flashcards/reset` | Substitui a coleção (restaurar backup, apagar tudo): apaga e muda o **epoch**. |
| `GET/PUT /api/flashcards/summary` | Resumo do dia calculado pelo app (widget do Início e menu). |
| `GET /api/flashcards/search?q=` | Busca nos cards (também incluída em `/api/search`). |
| `GET /api/flashcards/media?name=` | Arquivo de uma imagem do próprio usuário (do R2 ou do banco). Sempre como download opaco (`application/octet-stream`, `Content-Disposition: attachment`, CSP `sandbox`), para uma imagem SVG de um baralho nunca rodar como página do site. |

**No aparelho** (`database.js` + `sync.js`): um banco local por usuário (`fc:<id>`). Cada gravação
registra, na mesma transação, a chave na fila `outbox`; 1,5 s depois o app envia (sempre o conteúdo
mais recente) e só tira da fila o que o servidor confirmou e não mudou nesse meio-tempo. Depois
de enviar, baixa o que os outros aparelhos gravaram — primeiro envia, depois recebe, para o que foi
feito offline chegar antes. Uma alteração local ainda não enviada vence a que chega.

- **Quando sincroniza:** ao abrir a aba (aparelho novo: baixa tudo antes de mostrar, com
  progresso), 1,5 s depois de cada alteração, ao voltar para a aba do navegador, ao reconectar e
  a cada 5 min — inclusive fora da aba Flashcards.
- **Durante uma revisão** a tela não muda: o que chega de outro aparelho é aplicado ao terminar.
- **Offline:** tudo funciona; o cabeçalho mostra "Offline · N pendentes" e envia quando a conexão volta.
- **Recomeço:** se a coleção foi substituída em outro aparelho (backup restaurado, "apagar tudo"),
  o aparelho descarta a cópia local e baixa a da conta.
- **Fica só no aparelho:** o PDF original (o texto extraído vai para a conta), a chave de API da IA e
  imagens maiores que ~2,5 MB.
- **Imagens (Anki):** sobem como data URL. Com o **Cloudflare R2** configurado (`R2_*`, ver
  [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md#imagens-dos-flashcards-no-cloudflare-r2-opcional)) o servidor
  grava o arquivo no bucket (chave `flashcards/<usuário>/<hash do nome>`) e o registro fica só com
  `{name, type, size, stored: 'r2'}`; os outros aparelhos baixam o arquivo por `/api/flashcards/media`
  — em segundo plano depois de sincronizar (para funcionar offline) ou na hora de mostrar. Cota
  própria (`FLASHCARDS_MEDIA_QUOTA_MB`, padrão 1024). Sem R2, a imagem fica dentro do registro no
  banco, como antes; imagens antigas vão para o R2 pelo job diário, sem mudar de versão.
- **Cota:** `FLASHCARDS_QUOTA_MB` por usuário (padrão 100). Passando dela, as alterações novas ficam
  no aparelho e a aba avisa.
- **Quanto ocupa no banco** (medido, com índices): ~0,6 KB por revisão e ~1 KB por card (cards com
  textos longos, mais). Ex.: 5 mil cards com 50 mil revisões ≈ 40 MB. O que mais pesa são imagens de
  baralhos do Anki.
- **Faxina:** marcas de exclusão com mais de 90 dias são descartadas pelo job diário; um aparelho
  parado há mais tempo que isso recomeça do zero na próxima abertura (nada excluído volta).
- **Sair da conta** envia o que falta e apaga a cópia local do navegador (se algo não foi enviado,
  por falta de internet, a cópia fica para não perder nada). Excluir a conta apaga tudo.

- **Cards da plataforma na coleção:** vão para a conta **sem frente e verso** enquanto o texto for
  o da plataforma (ver a seção seguinte); outro aparelho completa o texto pelo R2.

**Versão anterior (dados só no navegador):** ao abrir a aba num navegador que usou a versão antiga
(banco `flashcards-medicina`), aparece "Encontramos flashcards salvos só neste navegador" com
**Levar para a minha conta**. Os dados são copiados (juntando com o que já existir na conta); o
banco antigo não é apagado, só marcado para não perguntar de novo.

## Cards da plataforma

Aba **Cards da plataforma** (`/flashcards/plataforma`): baralhos prontos, iguais para todos os
usuários (ex.: *Flashcards Revisados 2026*, 45.743 cards em 890 baralhos). O conteúdo fica **só no
Cloudflare R2**, nunca no banco (Neon) — nem no repositório.

**O que cada usuário faz** (vale só para ele; ninguém muda o baralho dos outros):

| Ação | Onde fica |
|---|---|
| **Estudar → Só estudar** | Não sei · Quase · Sei, sem interrupção (o card que você erra volta na mesma sessão, como no Quick Review). Não entra nas revisões nem muda o agendamento. Nada é gravado. Ao terminar: estudar de novo os que errou ou colocá-los na coleção. |
| **Estudar → Estudar e entrar nas revisões** | Errei · Difícil · Quase · Bom · Fácil (os intervalos de um card novo). Cada card respondido entra na coleção **já agendado**, com o histórico da resposta (`source: 'platform'`, não gasta o limite de novos do dia). Os que já estão na coleção ficam de fora. Desfazer tira o card da coleção. |
| **Adicionar à minha coleção** | Copia os cards do baralho (e dos de dentro) que ainda não estão lá, como **novos**, na ordem do baralho, no baralho de mesmo nome e na hierarquia pelo nome dos baralhos (sem o baralho-raiz do pacote; "Clínica Cirúrgica" → Cirurgia, "Preventiva & Social" → Medicina Preventiva). Daí em diante são cards seus: editar, mover ou excluir mexe só na sua coleção. |
| **Editar (só para você)** | `kv/platformEdits` na conta do usuário. A plataforma continua igual para os outros; "Voltar ao original" desfaz. |
| **Excluir da minha lista** (card ou baralho) | `kv/platformHidden`. Some dos estudos, da lista e do "Adicionar"; "Mostrar de novo" desfaz. |

Ordem (a do baralho ou embaralhada) e quantidade (20, 50, 100, 200 ou todos) são escolhidas ao
começar. Os cards chegam baralho a baralho: a sessão começa logo, mesmo em "Clínica Médica" (19 mil
cards), e carrega o resto enquanto você estuda.

**Sem o texto no banco.** O card copiado para a coleção guarda `platform: {p: pacote, d: baralho,
c: card, h: marca}` — `h` é um hash do texto original. Enquanto frente e verso forem os originais,
a sincronização envia o card **sem frente e verso** (`FC.platform.slim`), ~0,7 KB por card; ao
receber, o aparelho usa a própria cópia ou busca o baralho no R2 (`FC.platform.hydrate`, antes de
gravar no banco local). Editou a cópia? O texto passa a ser seu e vai inteiro para a conta. Se o
card sair da plataforma, os aparelhos novos mostram um aviso no lugar do texto (sem subir o aviso
para a conta). Limitação: a busca global do site não encontra esses cards pelo texto (só os
editados); a busca dentro dos flashcards encontra.

**No R2** (bucket das imagens, prefixo `platform/`):

```
platform/catalog.json                                   pacotes publicados {id, name, version, cards, decks}
platform/packages/<pacote>/<versão>/decks.json          árvore: {id, name "A::B", parent, own, total}
platform/packages/<pacote>/<versão>/cards/<baralho>.json cards do baralho: {id, front, back, tags}
platform/packages/<pacote>/upload.json                  publicação em andamento
```

| Rota (`/api/flashcards/platform…`) | Quem | O que faz |
|---|---|---|
| `GET /platform` | todos | `{enabled, admin, packages}` com a árvore de cada pacote. |
| `GET /platform/cards?package=&version=&deck=` | todos | Os cards de um baralho, como estão no R2. A versão está no endereço: o navegador guarda (`immutable`). |
| `POST /platform/publish` `{packageId?}` | admin | Começa uma versão (nova ou de um pacote existente); descarta publicação anterior pela metade. |
| `POST /platform/publish/:pacote/:versão/decks` `{decks: [{id, cards}]}` | admin | Uma parte (até ~2,5 MB). |
| `POST /platform/publish/:pacote/:versão/finish` `{name, decks}` | admin | Confere que chegaram todos os baralhos, grava a árvore, troca o catálogo e apaga a versão anterior. |
| `DELETE /platform/packages/:pacote` | admin | Tira o pacote da plataforma (as cópias nas coleções continuam). |

**Publicar** (administradores do site — página **Administração** ou `PLATFORM_ADMIN_EMAILS`, ver
[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md#administração-quem-administra-e-quem-pode-criar-conta)): na própria aba, **Publicar baralho** →
escolher o `.apkg`. O navegador lê o pacote (o mesmo leitor da importação), monta a árvore de
baralhos e envia em partes. Publicar de novo com **Atualizar “…”** troca a versão para todos. Os ids
são estáveis — card = id do card no Anki, baralho = hash do nome completo —, então edições,
ocultos e cópias dos usuários continuam valendo. Imagens do pacote não são publicadas (a tela avisa).

## Algoritmo de revisão

**Primeira aprendizagem** (card novo até "formar"), intervalos exatos:

| Errei | Difícil | Quase | Bom | Fácil |
|---|---|---|---|---|
| 1 min | 5 min | 10 min | 1 dia | 2 dias |

"Bom" ou "Fácil" formam o card; depois disso vale o **FSRS-5** (19 parâmetros padrão,
retenção desejada 90%, configurável). O FSRS tem 4 notas; as 5 respostas entram assim:

| Resposta | Nota FSRS | Efeito |
|---|---|---|
| Errei | Again (1) | esquecimento: conta lapso, estabilidade pós-lapso e **volta em 1 min, na mesma sessão** |
| Difícil | Hard (2) | penalidade de "Hard" |
| Quase | 2,5 | metade da penalidade de "Hard" (média geométrica) |
| Bom | Good (3) | — |
| Fácil | Easy (4) | bônus de "Easy" |

**Reaprendizagem** (depois de "Errei" numa revisão): o card entra em "Aprendendo" e volta na
mesma sessão. Ao repeti-lo, os intervalos são fixos:

| Errei | Difícil | Quase | Bom | Fácil |
|---|---|---|---|---|
| 1 min | 10 min | 1 dia | 2 dias | 3 dias |

"Errei" e "Difícil" o mantêm reaprendendo (volta na mesma sessão); "Quase", "Bom" e "Fácil" o
devolvem à revisão. A estabilidade e a dificuldade FSRS continuam sendo atualizadas, então as
revisões seguintes voltam a crescer pelo FSRS. Errar de novo na reaprendizagem não conta outro
esquecimento. Ou seja, "Errei" é sempre 1 min.

Os intervalos mostrados embaixo de cada botão são os que serão aplicados, sempre em ordem
(Difícil < Quase < Bom < Fácil). Mesmo durante a primeira aprendizagem a estabilidade e a
dificuldade FSRS são atualizadas (fórmula de curto prazo), então o card chega ao agendamento
normal com um estado de memória coerente. O dia de estudo vira às 4h (ajustável).

**Revisão normal** mostra só o que o scheduler liberou: aprendizagem vencida → revisões
vencidas (limite diário) → cards novos (limite diário), respeitando suspensões e baralhos
arquivados/suspensos. "Z" desfaz a última resposta (restaura o card e apaga o registro).

**Cards novos liberados:** no Início, embaixo de "Hoje você tem", a linha "Liberando N cards
novos por dia · **Alterar**" abre a escolha: **Todo dia** muda o limite diário (o mesmo de
Configurações; 0 = só revisões) e **Só hoje** libera cards a mais só neste dia de estudo (volta
ao normal no dia seguinte). O contador do menu, a revisão e o balão do Início do site seguem o
novo número.

**Só revisões** (no Início, ao lado de "Começar revisão", e no ▶ "Como quer estudar?"): a
revisão normal sem os cards novos — só os já estudados que venceram (e os que estão
aprendendo). Os novos do dia continuam disponíveis para depois.

**Tirar da revisão geral** (antes "Nunca entrar como card novo"; menu ⋯ de qualquer nó da
hierarquia — grande área, subárea, assunto… — ou de um baralho): para assuntos paralelos. Os
cards dali (e de tudo que está dentro) ficam com a etiqueta "fora da revisão geral":
- os **novos** não entram nos novos do dia nem gastam o limite diário — são estudados quando
  você quiser pelo **Estudar tudo**;
- as **revisões** também não aparecem na revisão geral (Início, aba Revisar, outras seleções):
  só quando você abre o próprio baralho/tema (ou algo dentro dele) e toca em ▶.
"Voltar para a revisão geral" desfaz.

**Estudar tudo** (no ▶ "Como quer estudar?" e no menu ⋯ de cada nó da hierarquia ou baralho):
todos os cards da seleção numa sessão que **entra no cronograma** — novos sem o limite do dia,
revisões vencidas sem o limite diário e, por fim, as que ainda não venceram (cada uma uma vez,
marcadas "Antes do vencimento"; o FSRS considera que a revisão foi antecipada). Os novos
estudados assim contam no limite do dia da revisão normal.

## Quick Review

Revisa **todos** os cards da seleção (baralhos, áreas, subáreas, assuntos, temas, tags ou
favoritos), vencidos ou não, com três respostas. Na lista de conteúdo, cada nó recolhe e
expande (de início, os subtemas ficam recolhidos; há "Expandir tudo" e "Recolher tudo"). Não altera `dueDate`, intervalo,
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
| **Anki `.apkg` / `.colpkg`** | Coleções antigas (`collection.anki2/anki21`, JSON) e novas (`collection.anki21b`, zstd + protobuf). Modelos renderizados (campos, seções, `{{FrontSide}}`, cloze — o `<hr id=answer>` só corta o verso quando antes dele vem a frente repetida; num verso próprio, como resposta + referência, fica tudo), imagens, tags, sub-baralhos, suspensão, vencimento, intervalo, repetições, esquecimentos e o **revlog** inteiro. Estabilidade/dificuldade: as do FSRS do próprio Anki quando existem; senão, recalculadas repassando o histórico (como o Anki faz ao ativar o FSRS). Respostas: De novo→Errei, Difícil→Difícil, Bom→Bom, Fácil→Fácil. |
| Backup completo | Restaura tudo (substitui os flashcards da conta, em todos os aparelhos). |

Classificação "Automático": cabeçalho do card → caminho/colunas do arquivo → tag hierárquica
(`Assunto::Tema::Subtema`) → baralho com `::` → grande área/subárea escolhidas na prévia.
Cards repetidos (mesmo id externo ou mesmo texto) são pulados, atualizados (conteúdo +
agendamento + revisões que faltam) ou duplicados, conforme a opção.

**Destino** (na prévia, em listas de escolha): grande área e subárea entre as que você já tem
(ou "+ Nova…"); sem palpite pelo nome do arquivo, vem marcada a grande área com mais cards.
Baralho: o do arquivo, **um baralho que já existe** ou "+ Novo baralho…"; ao escolher um,
dá para manter os baralhos do arquivo como sub-baralhos dele. Atalhos: **Importar deck aqui**
no menu (⋯) de qualquer nó da hierarquia (grande área, subárea, assunto…) já abre a
importação com esse destino, e **Importar para este baralho** no menu do baralho.

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
| **Minha chave da API** | Chamada direta do navegador com o SDK oficial `@anthropic-ai/sdk` (streaming, `output_config.format`, esforço configurável). Modelo padrão `claude-opus-5` com `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) para o caso de recusa. | guardada só neste navegador; nunca vai para a conta, backup ou exportação |
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
usando o `schema` recebido. A CSP do backend Express já libera `connect-src https://api.anthropic.com`
para o modo "Minha chave".

## Privacidade

Cards, histórico, estatísticas e configurações ficam na sua conta, visíveis só para você (os grupos
não veem nada dos flashcards), e numa cópia no navegador. PDFs são lidos localmente: o texto
extraído vai para a conta, o arquivo não. O texto só vai para a IA quando você manda gerar com um
provedor que não seja o manual, e a tela avisa antes o que será enviado e para onde. A chave de API
fica só no navegador. "Apagar progresso" (Perfil) não mexe nos flashcards, que têm a própria opção
em Flashcards › Configurações.

## Testes

```bash
npm run test:flashcards          # unitários (node --test): scheduler, Quick Review,
                                 # pontos fracos, formatos, conversão do Anki, estatísticas,
                                 # cards da plataforma (árvore, caminho, card sem texto na conta),
                                 # cronômetro/timer (pausar, retomar, zerar, fim, recarregar)
npm run test -w backend          # inclui tests/flashcards.test.ts: envio/recebimento, versões sem
                                 # buracos com gravações simultâneas, isolamento entre usuários,
                                 # epoch/recomeço, faxina, cota, validação, resumo e busca;
                                 # tests/flashcards-platform.test.ts: publicar no R2 (S3 falso),
                                 # só admin, versão nova, publicação pela metade, sem R2
npm run test:flashcards:e2e      # ponta a ponta no Chromium (Playwright) contra o site inteiro:
                                 # sobe a API com TEST_DATABASE_URL e o frontend compilado; importa o
                                 # CSV modelo e os .apkg, revisa, desfaz, Quick Review, pontos fracos,
                                 # PDF → IA (API simulada), JSON com revisões; menu do site, abas e
                                 # voltar; "Registrar estudo"; cronômetro (iniciar, pausar,
                                 # retomar, zerar, desfazer, registrar com o tempo dele);
                                 # segundo aparelho baixando tudo;
                                 # offline; backup substituindo a conta; outro usuário; versão antiga;
                                 # Início e contador; versão só de flashcards (/cards, alternar,
                                 # login voltando ao app); pesquisa global; cards da plataforma
                                 # (publicar, só estudar, entrar nas revisões, adicionar, conta sem
                                 # o texto, outro aparelho, excluir da lista); tema; celular; sair
node flashcards/tests/e2e.mjs <pasta>   # idem, salvando screenshots (E2E_NO_BUILD=1 pula o build)
node flashcards/tests/fixtures/make-apkg.js   # regenera os pacotes do Anki de teste
```

## Limitações e próximos passos

- PDFs digitalizados (imagem) não têm texto: falta OCR.
- Conflito entre aparelhos é por registro (a última gravação vence): o mesmo card revisado offline
  em dois aparelhos fica com o agendamento do último a sincronizar (as duas revisões ficam no
  histórico).
- A hierarquia dos flashcards (área › subárea › assunto › tema › subtema) é própria; o "Registrar
  estudo" casa só pelo nome do assunto.
- Endpoint de IA no backend (contrato acima), otimização dos parâmetros do FSRS pelo histórico e
  gestos de swipe no celular.
