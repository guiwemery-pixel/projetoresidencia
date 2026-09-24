# Projeto Residente

Plataforma web colaborativa de estudos com **revisão espaçada adaptativa**, feita inicialmente para
estudantes de Medicina (residência / ENAMED), mas com arquitetura pronta para outras áreas.

Cada pessoa tem sua conta e vê **todos os próprios dados em detalhe**: horas, questões, acertos,
revisões, metas, simulados e provas. Do grupo de amigos, cada um vê **apenas um resumo visual**
do progresso dos outros (🟢🟡🟠🔴), nunca os números.

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
| **Contas e grupos** | Cadastro/login com sessão segura, avatar, perfil. Grupos com código/link de convite, vários grupos por pessoa, administração (remover integrante, trocar código). |
| **Registro de estudos** | Área → Subárea → Assunto (cria na hora), vários tipos na mesma sessão (Teoria + Questões…), X/Y com acertos, erros e % calculados, banca, prova, dificuldade, tempo, observações e autoavaliação 😄🙂😐😕😣. |
| **Revisão espaçada adaptativa** | Escada D0 → D1 → D7 → D21 → D60 → D90+, adaptada por desempenho, autoavaliação, tendência, dificuldade, método, atraso e histórico do assunto. Cada agendamento tem um **“Por quê?”**. |
| **Revisões e calendário** | Hoje / atrasadas / próximas / histórico, adiar/antecipar, calendário mensal com detalhe do dia. |
| **Dashboard** | Resumo do dia (revisões, atrasadas, questões planejadas, metas), semana, progresso, próximas atividades, estudos recentes, recomendações e comparação com o próprio histórico. |
| **Métricas** | Tempo, sessões, dias, sequência; questões por dia/semana/mês; acertos ao longo do tempo; desempenho por área/subárea (com variação em p.p.) e por assunto; revisões. Filtros 7/30/90 dias, 6 meses, 1 ano e personalizado. Gráficos com alternância para tabela. |
| **Metas** | Diárias, semanais, mensais ou com prazo; progresso automático (questões, acertos, horas, dias, sessões, revisões, simulados, zerar atrasadas) ou manual; por área/assunto. |
| **Simulados** | Registro completo, agendamento, resultado por área, gráfico de evolução por banca. |
| **Banco de provas** | Banca → Prova (ex.: ENAMED → ENAMED 2025) → resultados; bancas personalizadas; link para o arquivo. |
| **Notificações** | Revisões do dia, atrasadas, meta perto do prazo, meta concluída, sequência de estudos, queda de desempenho, simulado agendado. |
| **Pesquisa global** | “dengue” → Pediatria · 4 revisões · 2 simulados · 86 questões · 78% de acertos. |
| **Privacidade** | Resumo público montado por lista de permissão, opção de não compartilhar, exportação e exclusão da conta. |
| **Interface** | Responsiva (celular, tablet, desktop), modo claro/escuro/sistema, PWA-ready (manifest). |

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
| `npm run build` | Build de produção (API em `backend/dist`, frontend em `frontend/dist`) |
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
      metrics/ goals/ mock-exams/ exams/ notifications/ insights/ search/ dashboard/
      auth/ users/ groups/
  tests/                testes de integração
frontend/
  src/
    api/                cliente HTTP e tipos
    components/         ui, layout, study (registro/“Por quê?”), charts
    pages/              uma página por aba
docs/                   arquitetura e algoritmo
```

## Próximos passos sugeridos

Google Calendar, importação de planilhas/questões, flashcards, upload de PDFs, IA para análise de
desempenho e geração de questões, ranking opcional, tags avançadas, notificações push (PWA).
Veja em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md#preparado-para-crescer) onde cada uma se encaixa.
