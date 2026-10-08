# Segurança do projeto: repositório, chaves e senhas

Passos que dependem de você (das suas contas no GitHub, Vercel, Neon, Cloudflare e Resend).
O código não guarda nenhuma senha: todas ficam nas variáveis de ambiente do Vercel.

## 1. Repositório privado

Enquanto o repositório estiver público, qualquer pessoa pode copiar o código.

1. GitHub → repositório `projetoresidencia` → **Settings** → **General** → role até o fim
   (**Danger Zone**) → **Change repository visibility** → **Make private** → confirme.
2. O Vercel continua publicando sozinho a cada `git push` (o app do Vercel no GitHub mantém o acesso;
   o plano gratuito aceita repositório privado de conta pessoal). Depois de mudar, faça um push ou um
   *Redeploy* e confira se o deploy terminou bem.
3. O que alguém já copiou enquanto era público não dá para recolher; o arquivo [`LICENSE`](../LICENSE)
   deixa claro que ninguém tem permissão para usar o código.

## 2. Trocar as chaves e senhas

O histórico do git foi conferido: **nenhuma senha ou chave real foi enviada ao repositório** (só os
exemplos de `backend/.env.example`). Mesmo assim, troque as que já foram usadas — principalmente se
alguma foi colada em conversa, e-mail, print ou documento. Em cada caso: crie a nova, atualize no
Vercel (*Settings → Environment Variables*), faça **Redeploy** e só então apague a antiga.

| O quê | Onde trocar | Variável no Vercel |
|---|---|---|
| Senha do banco (Neon) | Painel do Neon (pelo Vercel: aba *Storage* → o banco → *Open in Neon*) → **Roles** → o usuário do banco → **Reset password**. Copie as novas *connection strings* em **Connect** (com e sem *pooler*). | `DATABASE_URL` e `DATABASE_URL_UNPOOLED` (ou os nomes com prefixo, como `STORAGE_DATABASE_URL`). Confira se a integração já atualizou; se não, cole as novas. |
| Chaves do Cloudflare R2 | Cloudflare → **R2 → Manage API Tokens** → crie um token novo (*Object Read & Write*, só o bucket) → depois do Redeploy, apague o antigo. | `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` |
| Segredo do agendador | Gere um texto aleatório novo (gerenciador de senhas, ou `openssl rand -hex 32`). | `CRON_SECRET` |
| Chave do Resend (e-mails) | Resend → **API Keys** → crie outra (*Sending access*) → apague a antiga. | `RESEND_API_KEY` |
| Chave da Anthropic (IA dos flashcards) | Fica só no navegador de quem usa. Se foi exposta: <https://console.anthropic.com> → *API Keys* → apague e crie outra, e cole a nova nas configurações dos flashcards. | — |

As **sessões do site** não dependem de nenhum segredo fixo (cada login é um código aleatório guardado
como hash no banco), então não há chave de sessão para trocar. Para desconectar todo mundo de uma vez,
rode no editor SQL do Neon: `DELETE FROM sessions;`.

## 3. Proteger as contas

Nas contas do **GitHub, Vercel, Neon, Cloudflare, Resend, Registro.br** e no **e-mail principal**
(que recupera todas as outras):

- senha forte e diferente em cada uma (use um gerenciador de senhas);
- **verificação em duas etapas** ligada (de preferência por aplicativo autenticador, não SMS);
- confira quem mais tem acesso (membros do time no Vercel, colaboradores no GitHub) e tire quem não
  precisa.

## 4. Licença

O projeto é **proprietário — todos os direitos reservados** ([`LICENSE`](../LICENSE)). Os
`package.json` estão marcados como `UNLICENSED`. Se quiser, troque a primeira linha do `LICENSE` pelo
seu nome completo ou pela razão social e CNPJ da empresa. As bibliotecas de terceiros continuam com as
licenças delas (`frontend/public/flashcards/vendor/LICENSES.md`).
