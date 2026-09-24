// Ponto de entrada da API no Vercel (função serverless).
// O vercel.json redireciona /api/* para cá; o Express trata as rotas.
// Importa o backend já compilado (backend/dist), gerado no build.
import { createApp } from '../backend/dist/app.js';

const app = createApp();

// O runtime Node do Vercel injeta "helpers" na requisição/resposta
// (res.status/json/send/redirect, req.query/cookies). Removemos os da resposta
// e os lazy props de query/cookies para o Express usar as próprias versões.
// O corpo já lido pelo Vercel continua disponível em req.body (JSON).
const RES_HELPERS = ['status', 'send', 'json', 'redirect'];
const REQ_HELPERS = ['query', 'cookies'];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export default function handler(req, res) {
  for (const key of RES_HELPERS) if (own(res, key)) delete res[key];
  for (const key of REQ_HELPERS) if (own(req, key)) delete req[key];
  return app(req, res);
}
