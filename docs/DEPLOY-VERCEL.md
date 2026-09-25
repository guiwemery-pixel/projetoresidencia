# Publicar no Vercel

O projeto já vem configurado para o Vercel (`vercel.json`):

- o **site** (frontend) é servido pela CDN do Vercel;
- a **API** roda como função serverless (`api/index.mjs` → Express);
- o **banco** é um PostgreSQL externo — recomendado: **Neon**, pelo Marketplace do Vercel;
- as **migrations** rodam sozinhas a cada deploy (`scripts/vercel-build.sh`);
- as **notificações** também são geradas por um agendador diário (Vercel Cron), além de
  serem geradas sempre que alguém abre o app.

## Passo a passo

1. **Conta:** entre em <https://vercel.com> com a sua conta do GitHub.
2. **Importar:** *Add New… → Project* → escolha `projetoresidencia` → *Import*.
   - **Root Directory:** deixe na raiz do repositório (`./`). **Não** escolha `frontend`.
   - Não altere *Framework*, *Build Command* nem *Output Directory*: o `vercel.json` já define tudo.
   - Se aparecerem variáveis detectadas em *Environment Variables*, **apague todas** (são valores de exemplo).
   - Clique em *Deploy*. **O primeiro deploy vai falhar** com “❌ BANCO DE DADOS NÃO CONFIGURADO” —
     é esperado, porque o banco ainda não existe.
3. **Banco de dados:** no projeto, aba *Storage* → *Create Database* → **Neon** (Postgres) →
   aceite o plano gratuito → *Connect* ao projeto marcando **todos os ambientes**.
   Isso cria as variáveis `DATABASE_URL` e `DATABASE_URL_UNPOOLED` automaticamente
   (nomes com prefixo, como `STORAGE_DATABASE_URL`, também funcionam).
4. *(Opcional)* **Notificações diárias:** *Settings → Environment Variables* → adicione
   `CRON_SECRET` com um texto aleatório de pelo menos 16 caracteres.
5. **Publicar de novo:** aba *Deployments* → no último deploy, menu *⋯* → *Redeploy*.
6. **Usar:** abra o endereço `https://<seu-projeto>.vercel.app`, crie sua conta, crie o grupo
   (aba *Grupo*) e envie o link de convite aos amigos.

A partir daí, cada `git push` na branch principal gera um novo deploy automaticamente.

## Já importou antes só a pasta `frontend`?

Um projeto com *Root Directory* = `frontend` publica apenas as telas, sem a API — o login não
funciona. Corrija em *Settings → Build and Deployment → Root Directory*: apague `frontend`
(deixe vazio / raiz), salve e siga do passo 3. Ou exclua o projeto e importe de novo.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Build falha com “❌ BANCO DE DADOS NÃO CONFIGURADO” | Banco não conectado ao projeto (passo 3) ou não marcado para o ambiente do deploy. |
| Build falha com “aponta para localhost” | Sobrou uma variável de exemplo: apague-a em *Settings → Environment Variables*. |
| Build falha nas migrations com `P1001`/`P1002` (“Can't reach database server”, “Timed out”) | Banco Neon acordando ou ocupado por outro deploy. O script já espera e tenta 3 vezes; se persistir, confira no painel do Neon se o banco está ativo e faça *Redeploy*. |
| Onde ver o motivo da falha | Na página do deploy, em *Deploy Logs*, role a caixa de logs até o fim: a última linha com ❌ explica. |
| Site abre, mas login/cadastro dá erro | *Root Directory* apontando para `frontend`, ou deploy anterior ao banco (faça *Redeploy*). |
| Erro 500 na API | Veja *Deployments → (deploy) → Logs/Functions*; a mensagem de erro aparece ali. |

## Limites do plano gratuito

O Vercel Hobby permite agendamentos no máximo **uma vez por dia** (configurado para ~7h de
Brasília). O limite de tentativas de login é por instância da função — suficiente para um grupo
de amigos; para uso aberto ao público, prefira um armazenamento compartilhado (ex.: Redis).
