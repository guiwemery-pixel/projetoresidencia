/*
 * Teste de ponta a ponta no navegador (Chromium via Playwright).
 * Sobe um servidor estático próprio, abre o app e percorre os fluxos principais:
 * importação (CSV no modelo e .apkg com revisões), revisão normal com os 5 botões,
 * desfazer, Quick Review sem alterar o agendamento, pontos fracos, estatísticas,
 * exportação no modelo Anki (idêntica ao arquivo original) e backup/restauração.
 *
 * Uso:  node tests/e2e.mjs [pasta-para-screenshots]
 * Requer o pacote "playwright" (global ou local) e um Chromium instalado.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || null;
const MODEL_CSV = process.env.MODEL_CSV || path.join(ROOT, 'tests/fixtures/modelo-cancer-gastrico.csv');

let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try {
    playwright = require(p);
    break;
  } catch (e) {
    /* tenta o próximo */
  }
}
if (!playwright) {
  console.error('Playwright não encontrado (npm i -g playwright).');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/index.html';

const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const shot = async (name, opts = {}) => {
  // Nenhuma tela pode mostrar "null", "undefined" ou "NaN" vindos de dados faltando
  const text = await page.evaluate(() => document.body.innerText);
  const leak = text.match(/\b(null|undefined|NaN)\b/);
  assert.equal(leak, null, 'texto vazado na tela "' + name + '": …' + (leak ? text.slice(Math.max(0, leak.index - 40), leak.index + 20) : '') + '…');
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png'), fullPage: true }, opts));
};
const go = async (hash) => {
  // Usa o roteador do app: navegar para a mesma rota também redesenha a tela
  await page.evaluate((p) => FC.app.go(p), hash);
  await page.waitForTimeout(350);
};
const step = (name) => console.log('•', name);
const evalFC = (fn, arg) => page.evaluate(fn, arg);

async function importFile(file, opts = {}) {
  await go('/importar');
  const chooser = page.waitForEvent('filechooser');
  await page.click('.dropzone');
  await (await chooser).setFiles(file);
  await page.waitForSelector('text=Prévia', { timeout: 20000 });
  if (opts.area) {
    await page.fill('input[list="imp-area"]', opts.area);
    await page.fill('input[list="imp-sub"]', opts.subarea);
  }
  if (opts.shot) await shot(opts.shot);
  await page.click('button:has-text("Importar ")');
  await page.waitForSelector('text=Importação concluída', { timeout: 30000 });
  return page.textContent('.callout.good');
}

try {
  step('abre o app vazio');
  await page.goto(BASE);
  await page.waitForSelector('.hello');
  await shot('01-inicio-vazio');

  step('HTML dos cards é limpo (sem scripts, eventos ou javascript:)');
  {
    const dirty = '<b>ok</b><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3">x</a><div style="position:fixed;color:red;background:url(//evil)">y</div><svg onload="window.__xss=4"></svg><iframe src="//evil"></iframe>';
    const clean = await evalFC((html) => FC.sanitize(html), dirty);
    assert.doesNotMatch(clean, /onerror|onload|<script|javascript:|<iframe|<svg|position|url\(/i);
    assert.match(clean, /<b>ok<\/b>/);
    assert.match(clean, /color: ?red/);
    await evalFC((html) => document.body.appendChild(FC.ui.rich(html)), dirty);
    await page.waitForTimeout(200);
    assert.equal(await evalFC(() => window.__xss), undefined);
    await page.reload();
    await page.waitForSelector('.hello');
  }

  step('importa o CSV no modelo');
  const r1 = await importFile(MODEL_CSV, { area: 'Cirurgia', subarea: 'Cirurgia Geral', shot: '02-importar-previa' });
  assert.match(r1, /80 cards importados/);
  let info = await evalFC(() => ({
    cards: FC.store.cards.size,
    deck: FC.decks.all().map((d) => d.name),
    path: FC.areas.pathNames([...FC.store.cards.values()][0].nodeId),
    front: [...FC.store.cards.values()][0].front,
  }));
  assert.equal(info.cards, 80);
  assert.ok(info.deck.includes('Tutoria CG::Caso 11 - Câncer gástrico'));
  assert.deepEqual(info.path, ['Cirurgia', 'Cirurgia Geral', 'Câncer gástrico', 'Epidemiologia', 'Brasil (INCA)']);
  assert.ok(!/Pergunta:|assunto-tag/.test(info.front), 'frente limpa');

  step('reimportar o mesmo CSV não duplica');
  const r1b = await importFile(MODEL_CSV, { area: 'Cirurgia', subarea: 'Cirurgia Geral' });
  assert.match(r1b, /80 já existentes pulados/);

  step('exporta no modelo Anki e confere com o original (byte a byte)');
  const original = (await readFile(MODEL_CSV, 'utf8')).replace(/\r/g, '');
  const exported = await evalFC(() => {
    const deck = FC.decks.findByName('Tutoria CG::Caso 11 - Câncer gástrico');
    const cards = FC.decks.cardsIn(deck.id).sort((a, b) => a.createdAt - b.createdAt);
    return FC.importView.buildExport(cards, 'anki', [], true).content;
  });
  assert.equal(exported.trim(), original.trim());

  step('importa o .apkg (formato novo, zstd) com revisões');
  const r2 = await importFile(path.join(ROOT, 'tests/fixtures/modern.apkg'), { shot: '03-importar-anki' });
  // O card de Borrmann do Anki tem o mesmo conteúdo de um card do CSV: é reconhecido como repetido
  assert.match(r2, /4 cards importados/);
  assert.match(r2, /1 já existente pulado/);
  assert.match(r2, /4 revisões do histórico/);
  assert.match(r2, /1 imagem/);
  info = await evalFC(() => {
    const cards = [...FC.store.cards.values()].filter((c) => c.origin === 'anki');
    const cloze = cards.find((c) => /\[sintoma\]/.test(c.front));
    return {
      n: cards.length,
      suspended: cards.filter((c) => c.suspended).length,
      learning: cards.filter((c) => c.state === 'learning').length,
      cloze: cloze && { s: cloze.stability, d: cloze.difficulty, ivl: cloze.scheduledDays, logs: FC.store.cardLogs(cloze.id).length, path: FC.areas.pathNames(cloze.nodeId) },
    };
  });
  assert.equal(info.n, 4);
  assert.equal(info.suspended, 1);
  assert.equal(info.learning, 1);
  assert.equal(info.cloze.s, 12.5, 'estabilidade FSRS do próprio Anki');
  assert.equal(info.cloze.d, 6.1);
  assert.equal(info.cloze.ivl, 12);
  assert.equal(info.cloze.logs, 2);
  assert.deepEqual(info.cloze.path, ['Cirurgia', 'Digestiva', 'Estômago'], 'classificado pelos nomes dos baralhos');

  step('importa o .apkg antigo atualizando os existentes: o card do CSV recebe as revisões do Anki');
  await go('/importar');
  {
    const chooser = page.waitForEvent('filechooser');
    await page.click('.dropzone');
    await (await chooser).setFiles(path.join(ROOT, 'tests/fixtures/legacy.apkg'));
    await page.waitForSelector('text=Prévia');
    await page.selectOption('select:has(option[value="update"])', 'update');
    await page.click('button:has-text("Importar ")');
    await page.waitForSelector('text=Importação concluída');
    const r3 = await page.textContent('.callout.good');
    assert.match(r3, /5 atualizados/);
  }
  info = await evalFC(() => {
    const b = [...FC.store.cards.values()].filter((c) => /Classificação de Borrmann/.test(c.front));
    return { n: b.length, origin: b[0].origin, state: b[0].state, ivl: b[0].scheduledDays, logs: FC.store.cardLogs(b[0].id).length, path: FC.areas.pathNames(b[0].nodeId) };
  });
  assert.equal(info.n, 1, 'sem duplicar');
  assert.equal(info.state, 'review');
  assert.equal(info.ivl, 15);
  assert.equal(info.logs, 6);
  assert.deepEqual(info.path.slice(2), ['Câncer gástrico', 'Patologia', 'Câncer avançado']);

  step('cria um card manualmente');
  await go('/decks');
  await page.click('.topbar button:has-text("Novo card")');
  await page.waitForSelector('.modal .editor-area');
  const areas = await page.$$('.modal .editor-area');
  await areas[0].click();
  await page.keyboard.type('Qual o exame padrão-ouro para acalasia?');
  await areas[1].click();
  await page.keyboard.type('Manometria esofágica de alta resolução');
  const pathInputs = await page.$$('.modal .form-grid input.input[list]');
  const names = ['Cirurgia', 'Cirurgia Digestiva', 'Esôfago', 'Acalasia', ''];
  for (let i = 0; i < 4; i++) await pathInputs[i].fill(names[i]);
  await shot('04-editor');
  await page.click('.modal button:has-text("Criar card")');
  await page.waitForTimeout(400);
  info = await evalFC(() => {
    const c = [...FC.store.cards.values()].find((x) => /padrão-ouro/.test(x.front));
    return { path: FC.areas.pathNames(c.nodeId), state: c.state };
  });
  assert.deepEqual(info.path, ['Cirurgia', 'Cirurgia Digestiva', 'Esôfago', 'Acalasia']);

  step('revisão normal: intervalos da primeira aprendizagem');
  await go('/');
  await shot('05-inicio');
  await go('/revisar');
  await page.waitForSelector('.flashcard');
  await shot('06-revisao-pergunta');
  await page.keyboard.press('Space');
  await page.waitForSelector('.rating-bar');
  const labels = await page.$$eval('.rating-bar .rate', (els) => els.map((e) => e.querySelector('.name').textContent + ' ' + e.querySelector('.ivl').textContent));
  await shot('07-revisao-resposta');
  console.log('   botões:', labels.join(' | '));
  // O primeiro card pode ser de revisão (vindo do Anki) ou novo; os intervalos fixos valem para novos
  const reviewDue = await evalFC(() => FC.review.counts({}).dueNow);
  if (reviewDue === 0) assert.deepEqual(labels, ['Errei 1 min', 'Difícil 5 min', 'Quase 10 min', 'Bom 1 dia', 'Fácil 2 dias']);
  await page.keyboard.press('4');
  await page.waitForTimeout(300);
  let answered = 1;
  // Responde mais alguns cards alternando respostas
  for (const key of ['1', '4', '2', '5', '1', '3', '4']) {
    const hasCard = await page.$('.show-answer .btn');
    if (!hasCard) break;
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    const newLabels = await page.$$eval('.rating-bar .ivl', (els) => els.map((e) => e.textContent));
    if (newLabels[0] === '1 min') assert.deepEqual(newLabels, ['1 min', '5 min', '10 min', '1 dia', '2 dias']);
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    answered++;
  }
  step('desfazer (Z) volta o card e apaga o registro');
  const before = await evalFC(() => FC.store.logs.length);
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  const after = await evalFC(() => FC.store.logs.length);
  assert.equal(after, before - 1);
  await page.click('button:has-text("Encerrar")');
  await page.waitForSelector('text=Sessão concluída!');
  await shot('08-resumo-sessao');

  step('Quick Review não altera o agendamento');
  const snapshot = await evalFC(() => JSON.stringify([...FC.store.cards.values()].map((c) => [c.id, c.dueDate, c.stability, c.difficulty, c.state, c.repetitions])));
  const logsBefore = await evalFC(() => FC.store.logs.length);
  await go('/quick');
  await page.click('.check:has-text("Câncer gástrico")');
  await page.waitForTimeout(200);
  await shot('09-quick-selecao');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('.flashcard');
  const answers = ['1', '3', '2', '3', '3', '1'];
  for (const a of answers) {
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar.quick');
    await page.keyboard.press(a);
    await page.waitForTimeout(120);
  }
  await shot('10-quick-card');
  await page.click('button:has-text("Encerrar")');
  await page.waitForSelector('text=Quick Review concluído');
  await shot('11-quick-relatorio');
  const quickText = await page.textContent('.summary');
  assert.match(quickText, /Cards revisados/);
  const snapshotAfter = await evalFC(() => JSON.stringify([...FC.store.cards.values()].map((c) => [c.id, c.dueDate, c.stability, c.difficulty, c.state, c.repetitions])));
  assert.equal(snapshotAfter, snapshot, 'agendamento intacto');
  assert.equal(await evalFC(() => FC.store.logs.length), logsBefore, 'histórico principal intacto');
  assert.equal(await evalFC(() => FC.store.quickSessions.length), 1);

  step('simula meses de histórico para ver pontos fracos e estatísticas');
  await evalFC(async () => {
    // Taxa de acerto por tema (só para o teste): Estadiamento vai mal, Patologia bem
    const rate = { Estadiamento: 0.45, Patologia: 0.92, 'Tratamento cirúrgico': 0.8, Epidemiologia: 0.85 };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const opts = FC.settings.schedulerOptions();
    const logs = [];
    const ops = [];
    const now = Date.now();
    for (const card of FC.store.cards.values()) {
      const topic = FC.areas.pathNames(card.nodeId)[3];
      if (!rate[topic] || card.origin !== 'csv') continue;
      let c = Object.assign({}, card, FC.scheduler.newState());
      let t = now - 70 * 86400000;
      for (let i = 0; i < 8 && t < now; i++) {
        const ok = rnd() < rate[topic];
        const rating = ok ? (rnd() < 0.7 ? 4 : 3) : 1;
        const res = FC.scheduler.next(c, rating, t, opts);
        c = Object.assign(c, res.card);
        logs.push(Object.assign({ id: FC.util.uid('l'), cardId: card.id, responseTime: 8000 + Math.round(rnd() * 20000), source: 'review' }, res.log));
        t = Math.max(t + 3600e3, Math.min(c.dueDate, t + 12 * 86400000));
      }
      Object.assign(card, c);
      ops.push({ store: 'cards', put: card });
    }
    await FC.db.batch(ops);
    await FC.db.bulkPut('logs', logs);
    FC.store.addLogs(logs.sort((a, b) => a.date - b.date));
    FC.store.emit('cards', {});
  });
  await go('/pontos-fracos');
  await page.waitForSelector('.weak-item');
  await shot('12-pontos-fracos');
  const topWeak = await page.textContent('.weak-list .weak-item .weak-title');
  console.log('   maior dificuldade:', topWeak);
  assert.match(topWeak, /Estadiamento|TNM/);
  await page.click('.weak-list .weak-item');
  await page.waitForSelector('text=Revisar cards que errei');
  await shot('13-ponto-fraco-detalhe');

  step('dashboard, estatísticas, calendário, decks, busca, gerar, configurações');
  await go('/');
  await page.waitForSelector('.today');
  await shot('14-inicio-com-dados');
  await go('/estatisticas');
  await page.waitForSelector('.chart svg');
  await page.waitForTimeout(300);
  await shot('15-estatisticas');
  await go('/calendario');
  await shot('16-calendario');
  await go('/decks');
  await page.click('button:has-text("Expandir tudo")');
  await shot('17-decks');
  await go('/busca?q=Borrmann');
  await page.waitForTimeout(500);
  const found = await page.textContent('.page-head + .panel');
  assert.match(found, /cards? encontrados?/);
  await shot('18-busca');
  await go('/gerar');
  await shot('19-gerar');
  await go('/configuracoes');
  await shot('20-configuracoes');

  step('gerar com IA no modo manual (resposta colada)');
  await go('/gerar');
  await page.click('button[role="tab"]:has-text("Colar texto")');
  await page.fill('textarea.textarea', 'A acalasia é um distúrbio motor primário do esôfago. '.repeat(20) + '\n\nO tratamento inclui miotomia de Heller, POEM e dilatação pneumática. '.repeat(10));
  await page.click('button:has-text("Usar este texto")');
  await page.click('.seg button:has-text("5")');
  await page.click('button:has-text("Gerar cards")');
  await page.waitForSelector('.modal .prompt-box');
  const prompt = await page.textContent('.modal .prompt-box');
  assert.match(prompt, /active recall/);
  assert.match(prompt, /\[\[Página 1\]\]/);
  await shot('21-modo-manual');
  const fake = { cards: [{ front: 'Tratamentos da acalasia?', back: '- Miotomia de Heller<br>- POEM<br>- Dilatação pneumática', area: 'Cirurgia', subarea: 'Cirurgia Digestiva', subject: 'Acalasia', topic: 'Tratamento', subtopic: '', tags: ['acalasia'], difficulty: 'media', cardType: 'conduta', page: 2, reference: '' }] };
  await page.fill('.modal textarea', '```json\n' + JSON.stringify(fake) + '\n```');
  await page.click('.modal button:has-text("Usar resposta")');
  await page.waitForSelector('.draft', { timeout: 10000 });
  await shot('22-revisar-gerados');
  await page.click('button:has-text("Adicionar selecionados")');
  await page.waitForTimeout(500);
  info = await evalFC(() => {
    const c = [...FC.store.cards.values()].find((x) => x.front === 'Tratamentos da acalasia?');
    return c && { path: FC.areas.pathNames(c.nodeId), est: c.estDifficulty, by: c.estDifficultyBy, src: c.source };
  });
  assert.deepEqual(info.path, ['Cirurgia', 'Cirurgia Digestiva', 'Acalasia', 'Tratamento']);
  assert.equal(info.by, 'ia');
  assert.equal(info.src.page, 2);

  step('backup: exporta, apaga tudo e restaura');
  const counts = await evalFC(() => ({ cards: FC.store.cards.size, logs: FC.store.logs.length, nodes: FC.store.nodes.size }));
  const backup = await evalFC(() => FC.backup.exportBackup());
  await evalFC(async () => {
    await FC.db.wipe();
    await FC.store.load();
  });
  assert.equal(await evalFC(() => FC.store.cards.size), 0);
  await evalFC((json) => FC.backup.restore(JSON.parse(json)), backup);
  const restored = await evalFC(() => ({ cards: FC.store.cards.size, logs: FC.store.logs.length, nodes: FC.store.nodes.size }));
  assert.deepEqual(restored, counts);

  step('PDF → texto por página → IA pela chave (API simulada) → card com fonte e página');
  {
    const pdfPage = await context.newPage();
    await pdfPage.setContent(
      '<style>section{page-break-after:always;font:14px sans-serif}</style>' +
        '<section><h1>Acalasia</h1><p>Distúrbio motor primário do esôfago com perda de neurônios do plexo mioentérico.</p></section>' +
        '<section><h2>Diagnóstico</h2><p>A manometria esofágica de alta resolução é o padrão-ouro. A classificação de Chicago define os tipos I, II e III.</p></section>' +
        '<section><h2>Tratamento</h2><p>Opções: miotomia de Heller com fundoplicatura, POEM e dilatação pneumática.</p></section>',
    );
    const pdfFile = path.join(ROOT, 'tests/.tmp-acalasia.pdf');
    await writeFile(pdfFile, await pdfPage.pdf({ format: 'A5' }));
    await pdfPage.close();
    await evalFC(async () => {
      await FC.settings.set({ aiProvider: 'anthropic', aiModel: 'claude-opus-5' });
      await FC.settings.setApiKey('sk-ant-teste');
    });
    let apiBody = null;
    await page.route('https://api.anthropic.com/**', async (route) => {
      apiBody = JSON.parse(route.request().postData());
      const text = JSON.stringify({ cards: [{ front: 'Exame padrão-ouro na acalasia?', back: 'Manometria esofágica de alta resolução', area: 'Cirurgia', subarea: 'Cirurgia Digestiva', subject: 'Acalasia', topic: 'Diagnóstico', subtopic: '', tags: ['acalasia'], difficulty: 'facil', cardType: 'pergunta', page: 2, reference: '' }] });
      const ev = (type, data) => 'event: ' + type + '\ndata: ' + JSON.stringify(Object.assign({ type }, data)) + '\n\n';
      const body =
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
        ev('content_block_stop', { index: 0 }) +
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }) +
        ev('message_stop', {});
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
    });
    await go('/gerar');
    const chooser = page.waitForEvent('filechooser');
    await page.click('.dropzone');
    await (await chooser).setFiles(pdfFile);
    await page.waitForSelector('text=3 páginas', { timeout: 30000 });
    await shot('27-pdf-lido');
    const pageInputs = await page.$$('input[type="number"][max="3"]');
    await pageInputs[0].fill('2');
    await pageInputs[0].dispatchEvent('input');
    await page.click('.seg button:has-text("5")');
    await page.click('button:has-text("Gerar cards")');
    await page.waitForSelector('.draft', { timeout: 30000 });
    assert.ok(apiBody, 'chamou a API');
    assert.equal(apiBody.model, 'claude-opus-5');
    assert.equal(apiBody.output_config.format.type, 'json_schema');
    assert.equal(apiBody.fallbacks, 'default');
    assert.match(apiBody.messages[0].content, /\[\[Página 2\]\]/);
    assert.doesNotMatch(apiBody.messages[0].content, /\[\[Página 1\]\]/, 'só as páginas escolhidas');
    await page.click('button:has-text("Adicionar selecionados")');
    await page.waitForTimeout(400);
    const cardId = await evalFC(() => [...FC.store.cards.values()].find((c) => c.front === 'Exame padrão-ouro na acalasia?').id);
    const src = await evalFC((id) => FC.cards.get(id).source, cardId);
    assert.equal(src.page, 2);
    assert.match(src.fileName, /acalasia\.pdf/);
    await evalFC((id) => FC.cardDetail.open(id), cardId);
    await page.click('.modal .link-btn:has-text("p. 2")');
    await page.waitForSelector('text=Abrir PDF na página');
    const pageText = await page.textContent('.modal:last-of-type .prompt-box');
    assert.match(pageText, /padrão-ouro/);
    await shot('28-fonte-do-card');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.unroute('https://api.anthropic.com/**');
    await evalFC(() => FC.settings.set({ aiProvider: 'manual' }));
    await import('node:fs/promises').then((fs) => fs.rm(pdfFile, { force: true }));
  }

  step('baralho em JSON com revisões: exporta, apaga e reimporta mantendo o agendamento');
  {
    const before = await evalFC(() => {
      const deck = FC.decks.findByName('Cirurgia::Digestiva::Estômago');
      const cards = FC.decks.cardsIn(deck.id);
      const json = FC.importView.buildExport(cards, 'json-sched', [], true).content;
      const pick = (c) => [c.front, c.state, c.dueDate, c.stability, c.difficulty, c.lapses, c.suspended, FC.store.cardLogs(c.id).length];
      return { json, rows: cards.map(pick).sort(), deckId: deck.id };
    });
    await evalFC((id) => FC.decks.remove(id, 'delete'), before.deckId);
    const jsonFile = path.join(ROOT, 'tests/.tmp-deck.json');
    await writeFile(jsonFile, before.json);
    const r = await importFile(jsonFile);
    assert.match(r, /cards? importados?/);
    const after = await evalFC(() => {
      const deck = FC.decks.findByName('Cirurgia::Digestiva::Estômago');
      const pick = (c) => [c.front, c.state, c.dueDate, c.stability, c.difficulty, c.lapses, c.suspended, FC.store.cardLogs(c.id).length];
      return FC.decks.cardsIn(deck.id).map(pick).sort();
    });
    assert.deepEqual(after, before.rows);
    await import('node:fs/promises').then((fs) => fs.rm(jsonFile, { force: true }));
  }

  step('abre direto do arquivo (file://), sem servidor');
  {
    const local = await context.newPage();
    const localErrors = [];
    local.on('pageerror', (e) => localErrors.push(e.message));
    await local.goto('file://' + path.join(ROOT, 'index.html'));
    await local.waitForSelector('.hello, .empty', { timeout: 15000 });
    assert.deepEqual(localErrors, []);
    await local.close();
  }

  step('celular: revisão e início');
  await page.setViewportSize({ width: 390, height: 844 });
  await go('/revisar');
  await page.waitForTimeout(400);
  if (await page.$('.show-answer .btn')) {
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
  }
  await shot('23-celular-revisao', { fullPage: false });
  await go('/');
  await shot('24-celular-inicio', { fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'sem rolagem horizontal no celular');

  step('tema escuro');
  await page.setViewportSize({ width: 1280, height: 900 });
  await evalFC(() => FC.settings.set({ theme: 'dark' }));
  await go('/estatisticas');
  await page.waitForTimeout(400);
  await shot('25-escuro-estatisticas');
  await go('/revisar');
  await page.waitForTimeout(300);
  await shot('26-escuro-revisao');

  assert.deepEqual(errors, [], 'sem erros no console');
  console.log('\nOK — ' + answered + ' respostas na revisão, todos os fluxos passaram.');
} catch (e) {
  console.error('\nFALHOU:', e.message);
  console.error('Erros do console:', errors);
  await shot('zz-falha');
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
