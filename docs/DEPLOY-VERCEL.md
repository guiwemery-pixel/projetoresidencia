# Publicar no Vercel

O projeto já vem configurado para o Vercel (`vercel.json`):

- o **site** (frontend) é servido pela CDN do Vercel;
- a **API** roda como função serverless (`api/index.mjs` → Express), com até 60 s por requisição;
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
   *(Opcional)* **Espaço dos flashcards por pessoa:** `FLASHCARDS_QUOTA_MB` (padrão `100`). Cards e
   histórico ocupam pouco; o que pesa são imagens de baralhos do Anki. O plano gratuito do Neon tem
   0,5 GB no total — com muitos usuários, diminua a cota ou aumente o plano.
   *(Opcional)* **Endereço próprio para os flashcards:** *Settings → Domains* → adicione ao mesmo
   projeto um domínio que comece com `flashcards` (ex.: `flashcards-seunome.vercel.app`). Nele, a
   página inicial abre direto a versão só de flashcards. Sem isso ela continua em `/cards`.
   *(Opcional, recomendado)* **Imagens dos flashcards no Cloudflare R2** — veja a seção abaixo.
   *(Opcional)* **Cards da plataforma** (baralhos para todos os usuários, guardados no R2) — veja
   [a seção](#cards-da-plataforma).
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

## Imagens dos flashcards no Cloudflare R2 (opcional)

Imagens de baralhos do Anki são o que mais ocupa espaço. Sem configuração elas ficam no banco (Neon,
0,5 GB no plano gratuito). Com o **Cloudflare R2** (10 GB grátis por mês, sem cobrança de download)
elas vão para lá, e o banco guarda só o nome, o tipo e o tamanho de cada uma.

1. Crie uma conta gratuita em <https://dash.cloudflare.com> e abra **R2 Object Storage**. Para ativar
   o R2 a Cloudflare pede um cartão ou PayPal, mas não cobra nada dentro do limite gratuito.
2. **Create bucket** → nome `flashcards` (ou outro) → localização automática. Deixe o bucket
   **privado** (não ative acesso público nem domínio): as imagens passam sempre pelo site, que confere
   o login de cada pessoa. Também não é preciso configurar CORS.
3. Em **R2 → Manage R2 API Tokens → Create API Token**: permissão **Object Read & Write**, só para
   esse bucket. Copie o **Access Key ID** e o **Secret Access Key** (o segredo aparece uma vez só).
4. O **Account ID** aparece na página do R2 (e no endereço `https://<account-id>.r2.cloudflarestorage.com`).
5. No Vercel, *Settings → Environment Variables* (todos os ambientes):

   | Variável | Valor |
   |---|---|
   | `R2_ACCOUNT_ID` | o Account ID |
   | `R2_ACCESS_KEY_ID` | o Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | o Secret Access Key |
   | `R2_BUCKET` | o nome do bucket (ex.: `flashcards`) |
   | `FLASHCARDS_MEDIA_QUOTA_MB` | *(opcional)* limite de imagens por pessoa, padrão `1024` |

6. **Redeploy.** Em *Flashcards › Configurações › Sua conta* aparece o quadro "Imagens (Cloudflare R2)".

Imagens enviadas antes continuam funcionando e são levadas para o R2 aos poucos pelo job diário
(até 200 por dia). Apagar todos os flashcards, restaurar um backup ou excluir a conta apaga também as
imagens da pessoa no R2.

## Administração (quem administra e quem pode criar conta)

Menu lateral → **Administração** (aparece só para administradores):

- **Cadastrar e-mails**: cole um ou vários e-mails (vírgula, espaço ou um por linha) como
  **Administrador** (publica os cards da plataforma e acessa esta página) ou **Acesso liberado**.
  A pessoa não precisa ter conta ainda.
- **Quem pode criar conta**: *Qualquer pessoa* (padrão) ou *Só e-mails liberados* — aí só quem
  está na lista de acesso liberado (e os administradores) cria conta; a tela de cadastro avisa.
  Quem já tem conta continua entrando normalmente.
- **Contas no site**: nome e e-mail de quem criou conta (os estudos de cada um continuam privados).

Primeiro acesso: enquanto nenhum administrador foi cadastrado (nem na variável
`PLATFORM_ADMIN_EMAILS`), a **conta mais antiga do site** é a administradora. O site nunca fica sem
administrador: não dá para tirar o último, nem tirar a si mesmo. Os e-mails da variável do Vercel
continuam valendo e só saem de lá.

## Cards da plataforma

Baralhos prontos que aparecem para todos na aba *Flashcards › Cards da plataforma*. O conteúdo fica
no **Cloudflare R2** (o mesmo bucket das imagens, prefixo `platform/`), não no banco: o baralho
*Flashcards Revisados 2026* (45 mil cards) ocupa ~48 MB no R2 e nada no Neon. Quando alguém coloca
cards na coleção, a conta dela guarda só a referência (~0,7 KB por card), sem o texto.

1. Configure o R2 (seção acima). Sem ele, a aba mostra "Ainda não disponível".
2. Administradores (só eles veem **Publicar baralho**): no site, menu lateral → **Administração**
   → *Cadastrar e-mails* → cole os e-mails → **Administrador** → **Cadastrar**. Enquanto ninguém
   foi cadastrado, a **conta mais antiga do site** (a sua, de quem instalou) já é administradora e
   vê esse menu. Alternativa sem o site: no Vercel, *Settings → Environment Variables*,
   `PLATFORM_ADMIN_EMAILS` = e-mails separados por vírgula, e **Redeploy**.
3. Entre no site com um e-mail de administrador → *Flashcards › Cards da plataforma* → **Publicar baralho** →
   escolha o `.apkg` → **Publicar para todos**. O navegador lê o pacote e envia em partes (cerca de
   1 minuto para 45 mil cards).
4. Para corrigir ou atualizar o baralho: publique o `.apkg` novo escolhendo **Atualizar “…”** no
   destino. A versão anterior é apagada do R2; o que cada usuário editou, ocultou ou colocou na
   coleção continua valendo.

O `.apkg` não precisa (e não deve) ir para o repositório: ele é público.

