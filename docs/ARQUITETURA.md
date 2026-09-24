# Arquitetura e decisões técnicas

## Visão geral

```
┌──────────────────────────┐        HTTPS / JSON         ┌────────────────────────────────────┐
│  Frontend (React + Vite) │  ─────────────────────────▶ │  API (Express 5 + TypeScript)       │
│  SPA responsiva / PWA    │  cookie de sessão httpOnly  │                                    │
│  TanStack Query (cache)  │ ◀─────────────────────────  │  middleware: helmet, CORS, origem, │
└──────────────────────────┘                             │  sessão, validação (Zod), erros    │
                                                         │                                    │
                                                         │  módulos de domínio ─┐              │
                                                         │   scheduler (puro) ◀─┤ reviews      │
                                                         │   progress ──▶ resumo público       │
                                                         │   metrics, goals, insights…         │
                                                         └───────────────┬────────────────────┘
                                                                         │ Prisma
                                                                  ┌──────▼──────┐
                                                                  │ PostgreSQL  │
                                                                  └─────────────┘
```

Em produção a própria API serve o frontend compilado (um único deploy). Em desenvolvimento o
Vite roda em `:5173` e repassa `/api` para `:3333`.

## Por que esta stack

| Decisão | Motivo |
|---|---|
| **TypeScript de ponta a ponta** | Um só idioma no front e no back; tipos pegam erros cedo; fácil de manter por poucas pessoas. |
| **Express 5** | Simples, conhecido, com tratamento nativo de erros assíncronos. A organização em módulos independe do framework. |
| **PostgreSQL + Prisma** | Banco relacional robusto (o domínio é relacional: usuário → área → assunto → sessões/revisões), com migrations versionadas, tipos gerados e índices por `user_id`. Escala bem de um grupo de amigos a milhares de usuários. |
| **Zod** | Validação declarativa de toda entrada da API (corpo, query) com mensagens em português. |
| **React + Vite + Tailwind** | Build rápido, componentes reutilizáveis e estilo consistente com modo escuro via variáveis CSS. |
| **TanStack Query** | Cache e sincronização de dados do servidor; após registrar um estudo, apenas as consultas afetadas são invalidadas. |
| **Recharts** | Gráficos declarativos e leves o suficiente para o que precisamos (linhas e colunas simples). |
| **Vitest + Supertest** | Testes rápidos do motor de revisão (puros) e de integração contra um PostgreSQL real. |

## Módulos do backend

Cada módulo em `backend/src/modules/<nome>` tem `*.service.ts` (regras de negócio) e
`*.routes.ts` (HTTP + validação). Serviços não conhecem Express; rotas não conhecem SQL.

| Módulo | Responsabilidade |
|---|---|
| `auth` | Cadastro, login, logout, sessões (tokens opacos com hash no banco), hash de senha (bcrypt). |
| `users` | Perfil, preferências de ritmo, privacidade, troca de senha, exportação e exclusão de conta. |
| `groups` | Grupos, convites, papéis (dono/membro) e o **painel do grupo**. |
| `taxonomy` | Área → Subárea → Assunto, mover/renomear/arquivar, templates por área do conhecimento. |
| `studies` | Registro de sessões de estudo e de questões; dispara o processamento do contato. |
| **`scheduler`** | **Motor de revisão espaçada — puro, sem dependência de banco ou HTTP.** |
| `reviews` | Ponte banco ↔ motor (histórico, reprocessamento), agenda, calendário, reagendamento, configuração do algoritmo. |
| `progress` | Indicador de progresso detalhado (só para o dono) e **resumo público** (para o grupo). |
| `metrics` | Métricas por período, série temporal, por área e por assunto. |
| `goals` | Metas recorrentes/personalizadas e cálculo automático do progresso. |
| `mock-exams` / `exams` | Simulados e banco de provas (banca → prova → tentativas). |
| `notifications` | Notificações idempotentes (chave de deduplicação) + job periódico. |
| `insights` | Recomendações automáticas e comparações com o próprio histórico. |
| `search` / `dashboard` | Pesquisa global e agregação da tela inicial. |

### O motor de revisão é isolado

`modules/scheduler` recebe o estado de aprendizagem de um assunto e a evidência do contato atual,
e devolve o próximo estado, o intervalo e uma explicação completa. Não lê banco, não conhece
Express. Consequências:

- é testado com exemplos do mundo real (`engine.test.ts`) sem infraestrutura;
- pode ser trocado (ex.: FSRS ou um modelo treinado com os dados do grupo) implementando a mesma
  função `scheduleNext`, sem mudar rotas, banco ou frontend;
- os parâmetros vêm de `DEFAULT_SCHEDULER_CONFIG` **mesclado com a tabela `algorithm_configs`**,
  então dá para ajustar faixas, fatores e intervalos direto no banco.

O módulo `reviews` faz a ponte: agrupa as sessões de um dia num único “contato”, conclui a revisão
pendente e grava a próxima. Se um registro é editado, excluído ou lançado retroativamente, o
histórico do assunto é **reprocessado do zero** (o motor é determinístico), mantendo tudo coerente.

## Privacidade e segurança

**Princípio:** dados detalhados pertencem só ao dono; o grupo recebe apenas um resumo qualitativo.

1. **Isolamento por usuário em toda consulta.** Todos os serviços filtram por `userId` da sessão.
   Um id de outra pessoa na URL retorna **404** (não 403), para não revelar que o recurso existe.
   Os testes de integração cobrem leitura, edição, exclusão e “roubo” de assunto por outro usuário.
2. **Fronteira de privacidade explícita.** `progress/public-summary.ts` é o *único* formato de dado
   de um usuário que outro usuário pode receber. É montado campo a campo (lista de permissão), nunca
   por cópia do objeto detalhado — um campo novo no cálculo jamais vaza por acidente. O progresso é
   arredondado de 5 em 5. Um teste verifica que o JSON do grupo não contém nomes de assuntos, datas,
   minutos, questões, percentuais de acerto, fórmula ou detalhes.
3. **Opt-out.** O usuário pode desligar o compartilhamento; o grupo passa a ver só nome e avatar.
4. **Sessões:** token aleatório de 256 bits em cookie `httpOnly`, `SameSite=Lax` e `Secure` em
   produção; o banco guarda apenas o SHA-256 do token. Troca de senha encerra as outras sessões.
5. **Senhas:** bcrypt (custo 12); resposta de login com tempo equalizado para e-mails inexistentes.
6. **CSRF:** cookie `SameSite=Lax` + API só JSON + verificação de `Origin` em requisições que alteram dados.
7. **Cabeçalhos:** `helmet` com Content-Security-Policy restritiva (sem scripts inline).
8. **Força bruta:** limite de tentativas em login/cadastro e em códigos de convite.
9. **Validação:** toda entrada passa por Zod; avatares só como imagem (PNG/JPEG/WebP) pequena ou link https.
10. **LGPD:** exportação de todos os dados (JSON) e exclusão definitiva da conta pelo próprio usuário.

## Modelo de dados

Tabelas principais (ver `backend/prisma/schema.prisma`):

| Tabela | Conteúdo |
|---|---|
| `users`, `sessions` | Conta, preferências (fuso, ritmo, compartilhamento) e sessões ativas. |
| `groups`, `group_members` | Grupos e participação (N:N, com papel). |
| `areas` | Árvore Área → Subárea (`parent_id`), por usuário. |
| `subjects` | Assuntos (tamanho, tags, arquivado). |
| `study_sessions` | Data, duração, métodos (vários), autoavaliação, dificuldade. |
| `question_sessions` | Total, acertos, erros, %, banca, prova, dificuldade, tempo. |
| `learning_states` | Estado de aprendizagem por assunto (etapa, facilidade, último contato, quedas). |
| `reviews` | Cada revisão: prevista, realizada, intervalo, desempenho, qualidade, próximo intervalo e **explicação** (comprimida, ver abaixo). |
| `algorithm_configs` | Parâmetros do algoritmo ajustáveis sem novo deploy. |
| `goals` | Metas (métrica, período, alvo, área/assunto opcionais, prazo, status). |
| `mock_exams`, `mock_exam_area_results` | Simulados e resultado por área. |
| `boards`, `exams`, `exam_attempts` | Banco de provas. |
| `notifications` | Notificações com chave de deduplicação única por usuário. |

Datas “de calendário” (dia do estudo, dia previsto da revisão) usam colunas `DATE` e são calculadas
no fuso do usuário, evitando o clássico bug do “estudei às 23h e contou para o dia seguinte”.

**Economia de espaço.** A explicação do “Por quê?” era ~85% de cada linha de `reviews`. Ela é gravada
em `explanation_packed` (BYTEA) com deflate + um dicionário fixo de explicações típicas
(`reviews/explanation-codec.ts`): ~0,13 KB em vez de ~1,4 KB, sem perda — a API devolve exatamente
o mesmo JSON. Linhas antigas (coluna `explanation`, JSON) continuam legíveis e são convertidas quando
o usuário abre o app e pelo job diário, que também apaga sessões de login vencidas
(`modules/maintenance`). O dicionário v1 nunca pode mudar; um teste confere o hash.

## Frontend

- `api/` — cliente `fetch` com cookies e tipos das respostas.
- `hooks/api.ts` — consultas e mutações (TanStack Query) com invalidação por assunto.
- `components/study/` — o fluxo principal: **Registrar estudo** (assunto → tipo → X/Y → como foi →
  próxima revisão) e o painel **“Por quê?”** que explica cada agendamento.
- `components/charts/` — gráficos com especificação fixa (linhas de 2px, barras ≤ 24px, grade
  discreta, tooltip) e alternância para tabela (acessibilidade).
- Cores de status reservadas (bom/atenção/melhorar/crítico) sempre acompanhadas de ícone + rótulo;
  paleta categórica das áreas validada para daltonismo nos modos claro e escuro.
- Páginas secundárias carregadas sob demanda (code splitting).

## Preparado para crescer

| Futuro | Onde entra |
|---|---|
| Outras áreas (concursos, vestibular…) | Novo template em `taxonomy/templates/`; nada no domínio é específico de Medicina. |
| Algoritmo melhor (FSRS, IA) | Nova implementação de `scheduleNext` em `scheduler/`; `algorithm_version` fica gravado em cada estado. |
| IA para analisar desempenho | Novo gerador em `insights/` usando `metrics` como fonte; o contrato `Insight` já é genérico. |
| Flashcards / banco de questões | Novos módulos que registram contatos via `studies` → o motor de revisão já os trata como “recuperação ativa”. |
| Importação de planilhas/questões | Endpoint que chama `createStudy` em lote (o reprocessamento garante consistência). |
| Google Calendar | Exportar `reviews` pendentes (já por dia) via OAuth; a agenda já é calculada no backend. |
| Upload de PDFs de provas | `exams.file_url` já existe; trocar por armazenamento de objetos (S3/R2) respeitando direitos autorais. |
| Ranking opcional | Seria um novo campo **opt-in** no resumo público — a lista de permissão torna a mudança explícita. |
| App mobile / PWA / push | Manifest pronto; notificações já são geradas no backend (falta só o canal push). |
| Mais usuários | API sem estado (sessões no banco) → várias instâncias atrás de um balanceador; mover o job de notificações para um worker/fila; cache do resumo do grupo em Redis. |
