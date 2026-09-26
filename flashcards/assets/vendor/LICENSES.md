# Bibliotecas de terceiros (cópias locais)

Carregadas só quando necessárias, para o app funcionar offline e abrindo o `index.html` direto do computador.

| Arquivo | Pacote | Versão | Licença | Uso |
|---|---|---|---|---|
| `pdf.min.js`, `pdf.worker.min.js` | pdfjs-dist (build legacy) | 3.11.174 | Apache-2.0 | Extrair o texto de PDFs |
| `sql-asm.js` | sql.js (build asm.js) | 1.14.2 | MIT | Ler a coleção SQLite de pacotes do Anki |
| `jszip.min.js` | jszip | 3.10.2 | MIT (dupla MIT/GPL-3.0) | Abrir pacotes `.apkg`/`.colpkg` |
| `fzstd.js` | fzstd | 0.1.1 | MIT | Descompactar coleções `collection.anki21b` (zstd) |
| `anthropic-sdk.min.js` | @anthropic-ai/sdk (empacotado com esbuild, IIFE `AnthropicSDK`) | 0.128.0 | MIT | Chamar a API do Claude com a chave do próprio usuário |

Para atualizar o SDK: `npm i @anthropic-ai/sdk@<versão> esbuild` numa pasta temporária e
`npx esbuild entry.js --bundle --minify --format=iife --global-name=AnthropicSDK --platform=browser --outfile=anthropic-sdk.min.js`,
com `entry.js` contendo `import Anthropic from "@anthropic-ai/sdk"; export default Anthropic;`.
