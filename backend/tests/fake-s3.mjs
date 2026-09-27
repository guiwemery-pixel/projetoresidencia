// Servidor compatível com o básico da API S3 do Cloudflare R2, em memória, para testes:
// PUT/GET/DELETE de objetos, exclusão em lote (POST ?delete, exige Content-MD5) e
// listagem paginada (GET ?list-type=2). Recusa pedidos sem assinatura AWS4.
// Usado por backend/tests/flashcards-media.test.ts e flashcards/tests/e2e.mjs.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const xml = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
};

export async function startFakeS3({ bucket = 'flashcards-teste', pageSize = 1000 } = {}) {
  const objects = new Map();
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://s3');
    const [first, ...rest] = url.pathname.split('/').slice(1);
    const key = rest.map(decodeURIComponent).join('/');
    const body = await readBody(req);
    requests.push({ method: req.method, key, query: url.search });
    const auth = req.headers.authorization || '';
    if (!/^AWS4-HMAC-SHA256 Credential=[^/]+\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/.test(auth) || !req.headers['x-amz-date']) {
      return xml(res, 403, '<Error><Code>AccessDenied</Code></Error>');
    }
    if (decodeURIComponent(first) !== bucket) return xml(res, 404, '<Error><Code>NoSuchBucket</Code></Error>');

    if (req.method === 'PUT' && key) {
      objects.set(key, body);
      res.writeHead(200);
      return res.end();
    }
    if (req.method === 'GET' && key) {
      const obj = objects.get(key);
      if (!obj) return xml(res, 404, '<Error><Code>NoSuchKey</Code></Error>');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(obj);
    }
    if (req.method === 'DELETE' && key) {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && url.searchParams.has('delete')) {
      const md5 = createHash('md5').update(body).digest('base64');
      if (req.headers['content-md5'] !== md5) return xml(res, 400, '<Error><Code>InvalidDigest</Code></Error>');
      for (const m of body.toString().matchAll(/<Key>([^<]*)<\/Key>/g)) objects.delete(m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))));
      return xml(res, 200, '<DeleteResult></DeleteResult>');
    }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') || '';
      // Como no S3/R2: a continuação é a partir da última chave devolvida (não da posição)
      const after = url.searchParams.get('continuation-token') || '';
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
      const page = all.slice(0, pageSize);
      const more = all.length > pageSize;
      return xml(
        res,
        200,
        `<ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>` +
          (more ? `<NextContinuationToken>${page[page.length - 1]}</NextContinuationToken>` : '') +
          page.map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('') +
          '</ListBucketResult>',
      );
    }
    return xml(res, 400, '<Error><Code>NotImplemented</Code></Error>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    requests,
    env: { R2_ENDPOINT: `http://127.0.0.1:${port}`, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: 'teste', R2_SECRET_ACCESS_KEY: 'segredo-de-teste' },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
