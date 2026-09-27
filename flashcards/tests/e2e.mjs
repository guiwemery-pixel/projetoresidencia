/*
 * Teste de ponta a ponta da aba Flashcards dentro do Projeto Residente
 * (Chromium via Playwright, backend Express + PostgreSQL de teste, frontend compilado).
 *
 * Percorre os fluxos do app (importação do CSV no modelo e dos .apkg com revisões,
 * revisão com os 5 botões, desfazer, Quick Review sem mexer no agendamento, pontos
 * fracos, IA manual e pela chave com PDF, JSON com revisões, backup) e a integração:
 * navegação pelo menu do site, dados na conta sincronizados entre dois aparelhos,
 * offline, isolamento entre usuários, dados da versão antiga levados para a conta,
 * widget do Início, contador no menu, "Registrar estudo", busca global, tema do site,
 * celular e "Sair" apagando a cópia local.
 *
 * Uso:  node flashcards/tests/e2e.mjs [pasta-para-screenshots]
 * Requer: TEST_DATABASE_URL (ou backend/.env), Playwright e Chromium.
 *         E2E_NO_BUILD=1 pula o build do frontend (usa frontend/dist como está).
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startFakeS3 } from '../../backend/tests/fake-s3.mjs';

const require = createRequire(import.meta.url);
const FLASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(FLASH, '..');
const BACKEND = path.join(ROOT, 'backend');
const SHOTS = process.argv[2] || null;
const MODEL_CSV = process.env.MODEL_CSV || path.join(FLASH, 'tests/fixtures/modelo-cancer-gastrico.csv');
const PASSWORD = 'senha-segura-123';

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

// ── Servidor (API + frontend compilado) no banco de teste ─────────────────────
function envFile() {
  const file = path.join(BACKEND, '.env');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const TEST_DB = process.env.TEST_DATABASE_URL || envFile().TEST_DATABASE_URL;
if (!TEST_DB) {
  console.error('Defina TEST_DATABASE_URL (veja backend/.env.example).');
  process.exit(1);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

if (!process.env.E2E_NO_BUILD) execSync('npm run build -w frontend', { cwd: ROOT, stdio: 'inherit' });
execSync('npx prisma migrate deploy', { cwd: BACKEND, stdio: 'ignore', env: { ...process.env, DATABASE_URL: TEST_DB } });

// Imagens dos flashcards num "Cloudflare R2" falso (API S3 em memória)
const s3 = await startFakeS3();
const PORT = await freePort();
const BASE = 'http://127.0.0.1:' + PORT;
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: BACKEND,
  env: { ...process.env, ...s3.env, DATABASE_URL: TEST_DB, PORT: String(PORT), NODE_ENV: 'test', NOTIFICATIONS_JOB_MINUTES: '0', FRONTEND_DIST: path.join(ROOT, 'frontend/dist'), CORS_ORIGIN: BASE, COOKIE_SECURE: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // encerra o grupo inteiro (npx → tsx → node) no fim
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE + '/api/health')).ok) break;
  } catch (e) {
    /* subindo */
  }
  if (i > 120) throw new Error('Servidor não subiu:\n' + serverLog);
  await new Promise((r) => setTimeout(r, 250));
}

// ── Navegador ─────────────────────────────────────────────────────────────────
const browser = await playwright.chromium.launch();
const errors = [];
const stamp = Date.now().toString(36);

function watch(page, who) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const url = (m.location() && m.location().url) || '';
    // Esperados: sem internet de propósito, e /auth/me 401 depois de sair
    if (/ERR_INTERNET_DISCONNECTED/.test(text)) return;
    if (/status of 401/.test(text) && /\/api\/auth\/me/.test(url)) return;
    errors.push(who + ': ' + text + (url ? ' @ ' + url : ''));
  });
  page.on('pageerror', (e) => errors.push(who + ' pageerror: ' + e.message));
}

/** Um "aparelho" (contexto de navegador) com login. */
async function device(name, email, opts = {}) {
  const { register, ...ctxOpts } = opts;
  const context = await browser.newContext(Object.assign({ viewport: { width: 1360, height: 900 }, acceptDownloads: true }, ctxOpts));
  const res = register
    ? await context.request.post(BASE + '/api/auth/register', { data: { name, email, password: PASSWORD } })
    : await context.request.post(BASE + '/api/auth/login', { data: { email, password: PASSWORD } });
  assert.ok(res.ok(), 'login/cadastro de ' + name + ': ' + res.status());
  const user = (await res.json()).user;
  const page = await context.newPage();
  watch(page, name);
  return { context, page, user, email };
}

const step = (name) => console.log('•', name);
let shotPage = null;
const shot = async (name, opts = {}, page = shotPage) => {
  // Nenhuma tela pode mostrar "null", "undefined" ou "NaN" vindos de dados faltando
  const text = await page.evaluate(() => document.body.innerText);
  const leak = text.match(/\b(null|undefined|NaN)\b/);
  assert.equal(leak, null, 'texto vazado na tela "' + name + '": …' + (leak ? text.slice(Math.max(0, leak.index - 40), leak.index + 20) : '') + '…');
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png'), fullPage: true }, opts));
};

async function openFlashcards(page, sub = '') {
  await page.goto(BASE + '/flashcards' + sub);
  await page.waitForSelector('.fc-root .fc-tabs', { timeout: 30000 });
  await page.waitForTimeout(300);
}

const goFor = (page) => async (p) => {
  // Usa o roteador do app: navegar para a mesma rota também redesenha a tela
  await page.evaluate((x) => FC.app.go(x), p);
  await page.waitForTimeout(350);
};

const flush = (page) => page.evaluate(() => FC.sync.flush());
/** Baixa o que mudou na conta. Durante uma revisão nada é aplicado na tela: sai dela antes. */
async function pull(page) {
  if (await page.evaluate(() => FC.app.inSession())) {
    await page.evaluate(() => FC.app.go('/'));
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => FC.sync.now());
}
const counts = (page) =>
  page.evaluate(() => ({ cards: FC.store.cards.size, logs: FC.store.logs.length, nodes: FC.store.nodes.size, decks: FC.store.decks.size, quick: FC.store.quickSessions.length }));

async function answerOne(page, key = '4') {
  await page.evaluate(() => FC.app.go('/revisar'));
  await page.waitForSelector('.show-answer .btn', { timeout: 10000 });
  await page.keyboard.press('Space');
  await page.waitForSelector('.rating-bar');
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
}

// ── Aparelho principal ───────────────────────────────────────────────────────
const A = await device('Ana Teste', 'ana.' + stamp + '@teste.com', { register: true });
const page = A.page;
shotPage = page;
const go = goFor(page);
const evalFC = (fn, arg) => page.evaluate(fn, arg);

/** Escolhe na lista (grande área, subárea, baralho) ou, se não existir, cria pelo "+ Novo…". */
async function pickOrType(sel, value) {
  const exists = await page.$eval(sel, (el, v) => [...el.options].some((o) => o.value === v), value);
  if (exists) return page.selectOption(sel, value);
  await page.selectOption(sel, '__novo__');
  await page.fill(sel + '-novo', value);
}

async function importFile(file, opts = {}) {
  await go('/importar');
  const chooser = page.waitForEvent('filechooser');
  await page.click('.dropzone');
  await (await chooser).setFiles(file);
  await page.waitForSelector('text=Prévia', { timeout: 20000 });
  if (opts.area) {
    await pickOrType('#imp-area', opts.area);
    await pickOrType('#imp-sub', opts.subarea);
  }
  if (opts.deck) await pickOrType('#imp-deck', opts.deck);
  if (opts.update) await page.selectOption('select:has(option[value="update"])', 'update');
  if (opts.shot) await shot(opts.shot);
  await page.click('button:has-text("Importar ")');
  await page.waitForSelector('text=Importação concluída', { timeout: 30000 });
  return page.textContent('.callout.good');
}

try {
  step('o menu do site leva à aba Flashcards sem recarregar a página');
  await page.goto(BASE + '/');
  await page.waitForSelector('aside a[href="/flashcards"]');
  await page.evaluate(() => (window.__semRecarregar = true));
  await page.click('aside a[href="/flashcards"]');
  await page.waitForSelector('.fc-root .hello', { timeout: 30000 });
  assert.equal(new URL(page.url()).pathname, '/flashcards');
  assert.equal(await page.evaluate(() => window.__semRecarregar), true, 'navegação dentro do site');
  assert.equal(await page.getAttribute('aside a[href="/flashcards"]', 'aria-current'), 'page');
  await shot('01-inicio-vazio');

  step('abas internas e voltar do navegador mudam a URL /flashcards/...');
  await page.click('.fc-tab[data-nav="decks"]');
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, '/flashcards/decks');
  await page.click('.fc-head .fc-settings');
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(400);
  assert.equal(await page.$eval('.fc-tab[aria-current="page"]', (e) => e.dataset.nav), 'decks');
  // Endereço antigo do app separado
  await page.goto(BASE + '/flashcards/index.html#/decks');
  await page.waitForSelector('.fc-tab[aria-current="page"][data-nav="decks"]', { timeout: 20000 });
  assert.equal(new URL(page.url()).pathname, '/flashcards/decks');

  step('HTML dos cards é limpo (sem scripts, eventos ou javascript:)');
  {
    const dirty = '<b>ok</b><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3">x</a><div style="position:fixed;color:red;background:url(//evil)">y</div><svg onload="window.__xss=4"></svg><iframe src="//evil"></iframe>';
    const clean = await evalFC((html) => FC.sanitize(html), dirty);
    assert.doesNotMatch(clean, /onerror|onload|<script|javascript:|<iframe|<svg|position|url\(/i);
    assert.match(clean, /<b>ok<\/b>/);
    assert.match(clean, /color: ?red/);
    await evalFC((html) => document.querySelector('#fc-content').appendChild(FC.ui.rich(html)), dirty);
    await page.waitForTimeout(200);
    assert.equal(await evalFC(() => window.__xss), undefined);
  }

  step('importa o CSV no modelo');
  await openFlashcards(page);
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
  assert.match(await importFile(MODEL_CSV, { area: 'Cirurgia', subarea: 'Cirurgia Geral' }), /80 já existentes pulados/);

  step('exporta no modelo Anki e confere com o original (byte a byte)');
  const original = (await readFile(MODEL_CSV, 'utf8')).replace(/\r/g, '');
  const exported = await evalFC(() => {
    const deck = FC.decks.findByName('Tutoria CG::Caso 11 - Câncer gástrico');
    const cards = FC.decks.cardsIn(deck.id).sort((a, b) => a.createdAt - b.createdAt);
    return FC.importView.buildExport(cards, 'anki', [], true).content;
  });
  assert.equal(exported.trim(), original.trim());

  step('importa o .apkg (formato novo, zstd) com revisões');
  const r2 = await importFile(path.join(FLASH, 'tests/fixtures/modern.apkg'), { shot: '03-importar-anki' });
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
  assert.match(await importFile(path.join(FLASH, 'tests/fixtures/legacy.apkg'), { update: true }), /5 atualizados/);
  info = await evalFC(() => {
    const b = [...FC.store.cards.values()].filter((c) => /Classificação de Borrmann/.test(c.front));
    return { n: b.length, state: b[0].state, ivl: b[0].scheduledDays, logs: FC.store.cardLogs(b[0].id).length, path: FC.areas.pathNames(b[0].nodeId) };
  });
  assert.equal(info.n, 1, 'sem duplicar');
  assert.equal(info.state, 'review');
  assert.equal(info.ivl, 15);
  assert.equal(info.logs, 6);
  assert.deepEqual(info.path.slice(2), ['Câncer gástrico', 'Patologia', 'Câncer avançado']);

  step('cria um card manualmente (botão "Novo card" do cabeçalho da aba)');
  await go('/decks');
  await page.click('.fc-head button:has-text("Novo card")');
  await page.waitForSelector('.fc-portal .modal .editor-area');
  const areas = await page.$$('.modal .editor-area');
  await areas[0].click();
  await page.keyboard.type('Qual o exame padrão-ouro para acalasia?');
  await areas[1].click();
  await page.keyboard.type('Manometria esofágica de alta resolução');
  const pathInputs = await page.$$('.modal .form-grid input.input[list]');
  const names = ['Cirurgia', 'Cirurgia Digestiva', 'Esôfago', 'Acalasia'];
  for (let i = 0; i < 4; i++) await pathInputs[i].fill(names[i]);
  await shot('04-editor');
  await page.click('.modal button:has-text("Criar card")');
  await page.waitForTimeout(400);
  info = await evalFC(() => {
    const c = [...FC.store.cards.values()].find((x) => /padrão-ouro/.test(x.front));
    return { path: FC.areas.pathNames(c.nodeId) };
  });
  assert.deepEqual(info.path, ['Cirurgia', 'Cirurgia Digestiva', 'Esôfago', 'Acalasia']);

  step('assuntos com os mesmos nomes na plataforma (para o "Registrar estudo")');
  {
    const areasRes = await A.context.request.get(BASE + '/api/areas');
    const cir = (await areasRes.json()).find((a) => a.name === 'Cirurgia');
    for (const name of ['Câncer gástrico', 'Estômago', 'Esôfago']) {
      const r = await A.context.request.post(BASE + '/api/subjects', { data: { areaId: cir.id, name } });
      assert.equal(r.status(), 201);
    }
  }

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
  const reviewDue = await evalFC(() => FC.review.counts({}).dueNow);
  if (reviewDue === 0) assert.deepEqual(labels, ['Errei 1 min', 'Difícil 5 min', 'Quase 10 min', 'Bom 1 dia', 'Fácil 2 dias']);
  await page.keyboard.press('4');
  await page.waitForTimeout(300);
  let answered = 1;
  for (const key of ['1', '4', '2', '5', '1', '3', '4']) {
    if (!(await page.$('.show-answer .btn'))) break;
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    const newLabels = await page.$$eval('.rating-bar .ivl', (els) => els.map((e) => e.textContent));
    assert.equal(newLabels[0], '1 min', '"Errei" sempre em 1 min');
    if (newLabels[1] === '5 min') assert.deepEqual(newLabels.slice(0, 3), ['1 min', '5 min', '10 min']);
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    answered++;
  }

  step('desfazer (Z) volta o card e apaga o registro');
  const before = await evalFC(() => FC.store.logs.length);
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  assert.equal(await evalFC(() => FC.store.logs.length), before - 1);
  await page.click('button:has-text("Encerrar")');
  await page.waitForSelector('text=Sessão concluída!');
  await shot('08-resumo-sessao');

  step('"Registrar estudo" abre o diálogo do site com Flashcards, tempo e assunto');
  {
    await evalFC(() => {
      const orig = FC.host.registerStudy;
      FC.host.registerStudy = (x) => {
        window.__studyInfo = x;
        return orig(x);
      };
    });
    await page.click('.fc-register button:has-text("Registrar estudo")');
    const dialog = page.locator('[role="dialog"]:has-text("Registrar estudo")');
    await dialog.waitFor({ timeout: 10000 });
    const sent = await evalFC(() => window.__studyInfo);
    assert.equal(sent.method, 'FLASHCARDS');
    assert.ok(sent.minutes >= 1);
    assert.match(sent.notes, /Flashcards · Revisão de hoje: \d+ respostas?, \d+% de acerto/);
    assert.ok(sent.subject && ['Câncer gástrico', 'Estômago', 'Esôfago'].includes(sent.subject.name), 'assunto da sessão: ' + JSON.stringify(sent.subject));
    await page.waitForFunction((n) => document.querySelector('[role="dialog"]').innerText.includes(n), sent.subject.name, { timeout: 10000 });
    assert.equal(await dialog.locator('input[type="number"]').first().inputValue(), String(sent.minutes));
    await shot('09-registrar-estudo');
    await dialog.locator('button:has-text("Registrar")').last().click();
    await page.waitForSelector('text=Estudo registrado', { timeout: 10000 });
    await page.keyboard.press('Escape');
    const studies = await (await A.context.request.get(BASE + '/api/studies')).json();
    const list = Array.isArray(studies) ? studies : studies.items || studies.studies || [];
    const study = list.find((s) => (s.methods || []).includes('FLASHCARDS'));
    assert.ok(study, 'estudo registrado com o método Flashcards: ' + JSON.stringify(studies).slice(0, 300));
    assert.equal(study.subject.name, sent.subject.name);
    assert.equal(study.durationMinutes, sent.minutes);
  }

  step('"Errei" numa revisão: o card volta em 1 min, na mesma sessão');
  {
    // Card em revisão, vencido, com 20 dias de estabilidade; a etiqueta isola a sessão
    const { id, lapses } = await evalFC(async () => {
      const c = [...FC.store.cards.values()].find((x) => /padrão-ouro/.test(x.front));
      const now = Date.now();
      Object.assign(c, { state: 'review', stability: 20, difficulty: 5, lastReview: now - 20 * 86400000, dueDate: now - 3600e3, scheduledDays: 20, tags: (c.tags || []).concat('teste-errei'), updatedAt: now });
      await FC.db.put('cards', c);
      FC.store.emit('cards', {});
      return { id: c.id, lapses: c.lapses || 0 };
    });
    await go('/revisar?tag=teste-errei');
    await page.waitForSelector('.show-answer .btn');
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    let ivls = await page.$$eval('.rating-bar .ivl', (els) => els.map((e) => e.textContent));
    console.log('   revisão:', ivls.join(' | '));
    assert.equal(ivls[0], '1 min');
    assert.ok(ivls.slice(1).every((t) => /dia|mês|meses|ano/.test(t)), 'as outras respostas seguem em dias: ' + ivls);
    await page.keyboard.press('1');
    await page.waitForSelector('.flashcard .badge:has-text("Adiantado")');
    assert.match(await page.textContent('.flashcard'), /padrão-ouro/, 'o mesmo card volta na mesma sessão');
    assert.deepEqual(await page.$$eval('.queue-counts > span', (els) => els.map((e) => e.textContent)), ['0', '1', '0'], 'conta como aprendendo');
    await shot('08b-errei-volta-em-1-min');
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    ivls = await page.$$eval('.rating-bar .ivl', (els) => els.map((e) => e.textContent));
    console.log('   reaprendizagem:', ivls.join(' | '));
    assert.deepEqual(ivls, ['1 min', '10 min', '1 dia', '2 dias', '3 dias']);
    await page.keyboard.press('4');
    await page.waitForSelector('text=Sessão concluída!');
    const after = await evalFC((id) => {
      const c = FC.store.cards.get(id);
      return { state: c.state, lapses: c.lapses, days: c.scheduledDays, logs: FC.store.cardLogs(id).slice(-2).map((l) => [l.stateBefore, l.stateAfter, l.rating]) };
    }, id);
    assert.equal(after.state, 'review');
    assert.equal(after.lapses, lapses + 1, 'um esquecimento só');
    assert.equal(after.days, 2, 'Bom na reaprendizagem: 2 dias');
    assert.deepEqual(after.logs, [['review', 'learning', 1], ['learning', 'review', 4]]);
    await evalFC(async (id) => {
      const c = FC.store.cards.get(id);
      c.tags = c.tags.filter((t) => t !== 'teste-errei');
      c.updatedAt = Date.now();
      await FC.db.put('cards', c);
      FC.store.emit('cards', {});
    }, id);
  }

  step('"Estudar tudo": todos os cards da seleção, sem o limite do dia, e as respostas entram no cronograma');
  {
    const prevNew = await evalFC(() => FC.settings.get().newPerDay);
    await evalFC(() => FC.settings.set({ newPerDay: 1 }));
    const nodeId = await evalFC(() => [...FC.store.nodes.values()].find((n) => n.name === 'Câncer gástrico').id);
    const exp = await evalFC((id) => {
      const cards = FC.cards.select({ nodeIds: [id] });
      return { total: cards.length, fresh: cards.filter((c) => (c.state || 'new') === 'new').length, review: cards.filter((c) => c.state === 'review').length, normal: FC.review.counts({ nodeIds: [id] }).newToday };
    }, nodeId);
    assert.ok(exp.fresh > 1 && exp.normal <= 1, 'a revisão normal libera no máximo 1 novo hoje: ' + JSON.stringify(exp));
    await evalFC((id) => FC.launch.choose({ nodeIds: [id] }, 'Câncer gástrico'), nodeId);
    await page.waitForSelector('.modal h3:has-text("Estudar tudo")');
    await shot('08c-como-quer-estudar');
    await page.click('.modal button:has-text("Estudar ' + exp.total + ' cards")');
    await page.waitForSelector('.show-answer .btn');
    assert.match(await page.textContent('.study-top .title'), /Estudar tudo · Câncer gástrico/);
    const q = await page.$$eval('.queue-counts > span', (els) => els.map((e) => Number(e.textContent.replace(/\D/g, ''))));
    assert.equal(q[0], exp.fresh, 'todos os novos liberados');
    assert.equal(q[2], exp.review, 'todas as revisões, vencidas ou não');
    const logs0 = await evalFC(() => FC.store.logs.length);
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    await page.keyboard.press('4');
    await page.waitForTimeout(300);
    assert.equal(await evalFC(() => FC.store.logs.length), logs0 + 1, 'a resposta vai para o histórico e o agendamento');
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    assert.equal(await evalFC(() => FC.store.logs.length), logs0);
    await evalFC((n) => FC.settings.set({ newPerDay: n }), prevNew);
    await go('/decks');
    const row = page.locator('.tree-row', { has: page.locator('.label-btn', { hasText: /^Cirurgia$/ }) });
    await row.locator('button[title="Mais ações"]').click();
    assert.ok(await page.$('.menu [role="menuitem"]:has-text("Estudar tudo (entra no cronograma)")'), 'também no menu da hierarquia');
    await page.keyboard.press('Escape');
    await go('/');
  }

  step('"Só revisões": só os cards já estudados que venceram, sem os novos');
  {
    // Um card já estudado vencido (só na memória; volta ao que era no fim)
    const snap = await evalFC(() => {
      const c = [...FC.store.cards.values()].find((x) => /padrão-ouro/.test(x.front));
      const s = FC.cards.schedulingSnapshot(c);
      const now = Date.now();
      Object.assign(c, { state: 'review', stability: 5, difficulty: 5, lastReview: now - 6 * 86400000, dueDate: now - 3600e3, scheduledDays: 5 });
      return { id: c.id, s };
    });
    await go('/');
    const c = await evalFC(() => FC.review.counts({}));
    assert.ok(c.dueNow >= 1 && c.newToday >= 1, 'há revisões e novos hoje: ' + JSON.stringify(c));
    await page.click('.today-main button:has-text("Só revisões")');
    await page.waitForSelector('.show-answer .btn');
    assert.match(await page.textContent('.study-top .title'), /Só revisões/);
    const q = await page.$$eval('.queue-counts > span', (els) => els.map((e) => Number(e.textContent.replace(/\D/g, ''))));
    assert.equal(q[0], 0, 'sem novos');
    // + os que estão aprendendo e voltam em até 20 min
    assert.ok(q[1] + q[2] >= c.dueNow, 'todas as revisões vencidas: ' + JSON.stringify(q));
    assert.notEqual(await page.$$eval('.queue-counts > span', (els) => els.findIndex((e) => e.classList.contains('current'))), 0, 'o card na tela não é novo');
    await shot('08d-so-revisoes');
    await evalFC((x) => Object.assign(FC.cards.get(x.id), x.s), snap);
    await go('/');
  }

  step('Quick Review não altera o agendamento');
  const snapshot = await evalFC(() => JSON.stringify([...FC.store.cards.values()].map((c) => [c.id, c.dueDate, c.stability, c.difficulty, c.state, c.repetitions])));
  const logsBefore = await evalFC(() => FC.store.logs.length);
  await go('/quick');
  // Subtemas começam recolhidos; a seta do tema abre e fecha
  assert.ok(await page.$('.quick-tree .check:has-text("Epidemiologia")'), 'temas à vista');
  assert.equal(await page.$('.quick-tree .check:has-text("Brasil (INCA)")'), null, 'subtemas recolhidos');
  await page.click('.quick-tree button[aria-label="Expandir Epidemiologia"]');
  assert.ok(await page.$('.quick-tree .check:has-text("Brasil (INCA)")'), 'expandiu o tema');
  await page.click('.quick-tree .check:has-text("Brasil (INCA)")');
  await page.click('.quick-tree button[aria-label="Recolher Epidemiologia"]');
  assert.equal(await page.$('.quick-tree .check:has-text("Brasil (INCA)")'), null);
  assert.match(await page.textContent('.quick-tree .tree-name:has(.check:has-text("Epidemiologia"))'), /1 marcado dentro/);
  await page.click('button:has-text("Expandir tudo")');
  assert.ok(await page.$('.quick-tree .check:has-text("Brasil (INCA)") input:checked'), 'a marcação continua');
  await page.click('.quick-tree .check:has-text("Brasil (INCA)")');
  await page.click('button:has-text("Recolher tudo")');
  assert.equal((await page.$$('.quick-tree .tree-name')).length, await evalFC(() => new Set([...FC.store.cards.values()].map((c) => FC.areas.path(c.nodeId)[0]?.id).filter(Boolean)).size), 'só as grandes áreas');
  await page.click('button:has-text("Expandir tudo")');
  await page.click('.check:has-text("Câncer gástrico")');
  await page.waitForTimeout(200);
  await shot('10-quick-selecao');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('.flashcard');
  for (const a of ['1', '3', '2', '3', '3', '1']) {
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar.quick');
    await page.keyboard.press(a);
    await page.waitForTimeout(120);
  }
  await page.click('button:has-text("Encerrar")');
  await page.waitForSelector('text=Quick Review concluído');
  await shot('11-quick-relatorio');
  assert.match(await page.textContent('.summary'), /Cards revisados/);
  assert.ok(await page.$('.summary .fc-register'), '"Registrar estudo" também no Quick Review');
  assert.equal(await evalFC(() => JSON.stringify([...FC.store.cards.values()].map((c) => [c.id, c.dueDate, c.stability, c.difficulty, c.state, c.repetitions]))), snapshot, 'agendamento intacto');
  assert.equal(await evalFC(() => FC.store.logs.length), logsBefore, 'histórico principal intacto');
  assert.equal(await evalFC(() => FC.store.quickSessions.length), 1);

  step('simula meses de histórico para ver pontos fracos e estatísticas');
  await evalFC(async () => {
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

  step('telas: início, estatísticas, calendário, decks, busca, gerar, configurações');
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
  assert.match(await page.textContent('.page-head + .panel'), /cards? encontrados?/);
  await shot('18-busca');
  await go('/gerar');
  await shot('19-gerar');
  await go('/configuracoes');
  await page.waitForSelector('text=Sua conta');
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
    return c && { path: FC.areas.pathNames(c.nodeId), by: c.estDifficultyBy, src: c.source };
  });
  assert.deepEqual(info.path, ['Cirurgia', 'Cirurgia Digestiva', 'Acalasia', 'Tratamento']);
  assert.equal(info.by, 'ia');
  assert.equal(info.src.page, 2);

  step('PDF → texto por página → IA pela chave (API simulada) → card com fonte e página');
  {
    const pdfPage = await A.context.newPage();
    await pdfPage.setContent(
      '<style>section{page-break-after:always;font:14px sans-serif}</style>' +
        '<section><h1>Acalasia</h1><p>Distúrbio motor primário do esôfago com perda de neurônios do plexo mioentérico.</p></section>' +
        '<section><h2>Diagnóstico</h2><p>A manometria esofágica de alta resolução é o padrão-ouro. A classificação de Chicago define os tipos I, II e III.</p></section>' +
        '<section><h2>Tratamento</h2><p>Opções: miotomia de Heller com fundoplicatura, POEM e dilatação pneumática.</p></section>',
    );
    const pdfFile = path.join(FLASH, 'tests/.tmp-acalasia.pdf');
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
    assert.match(await page.textContent('.modal:last-of-type .prompt-box'), /padrão-ouro/);
    await shot('28-fonte-do-card');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.unroute('https://api.anthropic.com/**');
    await evalFC(() => FC.settings.set({ aiProvider: 'manual' }));
    await rm(pdfFile, { force: true });
  }

  step('baralho em JSON com revisões: exporta, apaga e reimporta mantendo o agendamento');
  {
    const pick = () => {
      const deck = FC.decks.findByName('Cirurgia::Digestiva::Estômago');
      const cards = FC.decks.cardsIn(deck.id);
      return { json: FC.importView.buildExport(cards, 'json-sched', [], true).content, rows: cards.map((c) => [c.front, c.state, c.dueDate, c.stability, c.difficulty, c.lapses, c.suspended, FC.store.cardLogs(c.id).length]).sort(), deckId: deck.id };
    };
    const b = await evalFC(pick);
    await evalFC((id) => FC.decks.remove(id, 'delete'), b.deckId);
    const jsonFile = path.join(FLASH, 'tests/.tmp-deck.json');
    await writeFile(jsonFile, b.json);
    assert.match(await importFile(jsonFile), /cards? importados?/);
    assert.deepEqual((await evalFC(pick)).rows, b.rows);
    await rm(jsonFile, { force: true });
  }

  // ── Conta: sincronização entre aparelhos ─────────────────────────────────
  step('tudo vai para a conta; um segundo aparelho baixa a coleção inteira');
  assert.equal(await flush(page), 0, 'nada pendente');
  const onA = await counts(page);
  const B = await device('Ana (celular)', A.email);
  await openFlashcards(B.page);
  await B.page.waitForSelector('.fc-root .hello');
  const onB = await counts(B.page);
  assert.deepEqual(onB, onA, 'mesma coleção nos dois aparelhos');
  const sample = (p) =>
    p.evaluate(() => {
      const c = [...FC.store.cards.values()].find((x) => /Classificação de Borrmann/.test(x.front));
      return [c.state, c.dueDate, c.stability, c.difficulty, c.lapses, FC.store.cardLogs(c.id).length, FC.areas.pathNames(c.nodeId).join(' › ')];
    });
  assert.deepEqual(await sample(B.page), await sample(page), 'agendamento FSRS e histórico iguais');
  // A imagem do Anki foi para o R2: a conta guarda só nome, tipo e tamanho, e o aparelho baixa o arquivo
  assert.equal(s3.objects.size, 1, 'imagem no bucket');
  const pulledMedia = (await (await B.context.request.get(BASE + '/api/flashcards/sync?since=0')).json()).records.filter((r) => r.s === 'media');
  assert.deepEqual(pulledMedia.map((r) => [r.id, r.d.stored, r.d.type, 'dataUrl' in r.d]), [['figura.png', 'r2', 'image/png', false]]);
  await B.page.evaluate(() => FC.sync.downloadMissingMedia());
  const media = await B.page.evaluate(async () => (await FC.db.getAll('media')).map((m) => ({ name: m.name, size: m.blob ? m.blob.size : 0, type: m.blob && m.blob.type })));
  const onA_media = await page.evaluate(async () => (await FC.db.getAll('media')).map((m) => ({ name: m.name, size: m.blob.size, type: m.blob.type })));
  assert.deepEqual(media, onA_media, 'a mesma imagem, baixada do R2');
  const imgSrc = await B.page.evaluate(async () => {
    const card = [...FC.store.cards.values()].find((c) => /figura\.png/.test(c.front));
    const el = FC.ui.rich(card.front);
    for (let i = 0; i < 40 && !el.querySelector('img').src; i++) await new Promise((r) => setTimeout(r, 50));
    return el.querySelector('img').src.slice(0, 22);
  });
  assert.equal(imgSrc, 'data:image/png;base64,', 'a imagem aparece no card');
  assert.equal((await B.context.request.get(BASE + '/api/flashcards/media?name=figura.png')).status(), 200);
  await shot('29-segundo-aparelho', {}, B.page);
  assert.equal(await B.page.evaluate(() => FC.settings.getApiKey()), '', 'a chave da IA não sai do aparelho');

  step('revisão feita no outro aparelho aparece aqui');
  await answerOne(B.page, '3');
  assert.equal(await flush(B.page), 0);
  await pull(page);
  assert.equal((await counts(page)).logs, onA.logs + 1);

  step('sem internet: responde, fica pendente e envia quando a conexão volta');
  await A.context.setOffline(true);
  await answerOne(page, '4');
  await page.waitForTimeout(2500);
  const offline = await evalFC(() => FC.sync.status());
  assert.equal(offline.status, 'offline');
  assert.ok(offline.pending > 0, 'alterações pendentes');
  assert.ok(await page.$('.fc-sync.warn'), 'aviso de offline no cabeçalho');
  await shot('30-offline');
  await A.context.setOffline(false);
  await page.waitForFunction(() => FC.sync.status().status === 'ok' && FC.sync.status().pending === 0, null, { timeout: 20000 });
  await pull(B.page);
  assert.equal((await counts(B.page)).logs, onA.logs + 2);
  // A aplica o que chegou só depois de sair da revisão
  await page.click('button:has-text("Encerrar")');
  await page.waitForSelector('text=Sessão concluída!');

  step('durante uma revisão a tela não muda; o que chegou aparece ao terminar');
  {
    const n = (await counts(page)).logs;
    await answerOne(B.page, '4');
    assert.equal(await flush(B.page), 0);
    await answerOne(page, '3');
    await page.evaluate(() => FC.sync.now());
    assert.equal((await counts(page)).logs, n + 1, 'só a resposta daqui durante a sessão');
    await page.click('button:has-text("Encerrar")');
    await page.waitForSelector('text=Sessão concluída!');
    await page.evaluate(() => FC.app.go('/'));
    await page.waitForFunction((x) => FC.store.logs.length === x, n + 2, { timeout: 10000 });
  }

  step('entrar de novo na aba (sai e volta) não duplica atalhos nem telas');
  await page.click('aside a[href="/metricas"]');
  await page.waitForTimeout(500);
  assert.equal(await page.$('.fc-root .fc-tabs'), null, 'a aba desmonta ao sair');
  await page.click('aside a[href="/flashcards"]');
  await page.waitForSelector('.fc-root .hello');
  assert.equal(await page.$$eval('.fc-root .fc-tabs', (els) => els.length), 1);
  {
    const n = (await counts(page)).logs;
    await answerOne(page, '3');
    assert.equal((await counts(page)).logs, n + 1, 'uma tecla = uma resposta');
    await page.click('button:has-text("Encerrar")');
    await page.waitForSelector('text=Sessão concluída!');
  }

  step('restaurar backup substitui a coleção da conta e o outro aparelho acompanha');
  {
    await pull(page);
    const beforeBackup = await counts(page);
    const backup = await evalFC(() => FC.backup.exportBackup());
    await evalFC(async () => {
      await FC.db.wipe();
      await FC.store.load();
    });
    assert.equal(await evalFC(() => FC.store.cards.size), 0);
    await evalFC((json) => FC.backup.restore(JSON.parse(json)), backup);
    assert.deepEqual(await counts(page), beforeBackup);
    assert.equal(await evalFC(() => FC.sync.status().pending), 0, 'restauração enviada para a conta');
    assert.equal(s3.objects.size, 1, 'a imagem do backup voltou para o bucket (e as antigas foram apagadas)');
    await pull(B.page);
    assert.deepEqual(await counts(B.page), beforeBackup, 'o outro aparelho recomeçou com a coleção restaurada');
  }

  step('outro usuário não vê nada destes flashcards');
  {
    const C = await device('Caio Teste', 'caio.' + stamp + '@teste.com', { register: true });
    await openFlashcards(C.page);
    await C.page.waitForSelector('.fc-root .hello');
    assert.equal(await C.page.evaluate(() => FC.store.cards.size), 0);
    const s = await (await C.context.request.get(BASE + '/api/search?q=Borrmann')).json();
    assert.equal(s.flashcards.total, 0);
    await C.context.close();
  }

  step('flashcards salvos só no navegador (versão anterior) vão para a conta');
  {
    const D = await device('Dora Teste', 'dora.' + stamp + '@teste.com', { register: true });
    await D.page.goto(BASE + '/');
    await D.page.waitForSelector('aside a[href="/flashcards"]');
    await D.page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('flashcards-medicina', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            for (const [name, key] of [['cards', 'id'], ['nodes', 'id'], ['decks', 'id'], ['logs', 'id'], ['kv', 'key']]) db.createObjectStore(name, { keyPath: key });
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['cards', 'nodes', 'decks', 'logs', 'kv'], 'readwrite');
            const now = Date.now();
            tx.objectStore('decks').put({ id: 'd_old', name: 'Meus cards', createdAt: now - 1e9 });
            tx.objectStore('nodes').put({ id: 'n1', name: 'Clínica Médica', level: 0, parentId: null });
            tx.objectStore('cards').put({ id: 'old1', front: 'Card antigo 1?', back: 'Resposta 1', deckId: 'd_old', nodeId: 'n1', tags: [], state: 'new', createdAt: now - 1e9, updatedAt: now - 1e9 });
            tx.objectStore('cards').put({ id: 'old2', front: 'Card antigo 2?', back: 'Resposta 2', deckId: 'd_old', nodeId: 'n1', tags: [], state: 'review', dueDate: now + 86400000, stability: 5, difficulty: 5, repetitions: 2, lapses: 0, scheduledDays: 5, lastReview: now - 86400000, createdAt: now - 1e9, updatedAt: now - 1e9 });
            tx.objectStore('logs').put({ id: 'lo1', cardId: 'old2', date: now - 86400000, rating: 4, source: 'review' });
            tx.objectStore('kv').put({ key: 'aiKey', value: 'sk-ant-antiga' });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await D.page.click('aside a[href="/flashcards"]');
    await D.page.waitForSelector('.fc-legacy', { timeout: 20000 });
    assert.match(await D.page.textContent('.fc-legacy'), /2 cards e 1 revisão/);
    await shot('31-versao-anterior', {}, D.page);
    await D.page.click('.fc-legacy button:has-text("Levar para a minha conta")');
    await D.page.waitForSelector('.fc-legacy', { state: 'detached', timeout: 20000 });
    assert.equal(await D.page.evaluate(() => FC.store.cards.size), 2);
    assert.deepEqual(await D.page.evaluate(() => FC.decks.all().map((d) => d.name)), ['Meus cards'], 'sem baralho padrão repetido');
    assert.equal(await D.page.evaluate(() => FC.settings.getApiKey()), 'sk-ant-antiga', 'a chave antiga continua neste navegador');
    assert.equal(await flush(D.page), 0);
    const pulled = await (await D.context.request.get(BASE + '/api/flashcards/sync?since=0')).json();
    assert.equal(pulled.records.filter((r) => r.s === 'cards').length, 2);
    assert.ok(!pulled.records.some((r) => r.s === 'kv' && r.id === 'aiKey'), 'a chave não vai para a conta');
    await D.page.reload();
    await D.page.waitForSelector('.fc-root .hello');
    await D.page.waitForTimeout(800);
    assert.equal(await D.page.$('.fc-legacy'), null, 'não pergunta de novo');
    await D.context.close();
  }

  step('Início do site: widget e contador do menu com os números da aba');
  {
    await go('/');
    const expected = await evalFC(() => {
      const c = FC.review.counts({});
      return c.dueToday + c.overdue + c.newToday;
    });
    await evalFC(() => FC.summary.send());
    await page.click('aside a[href="/"]');
    await page.waitForSelector('text=Para revisar hoje');
    await page.waitForFunction((n) => document.body.innerText.includes('Revisar agora (' + n + ')'), expected, { timeout: 10000 });
    const badge = await page.textContent('aside a[href="/flashcards"] span.num');
    assert.equal(badge.trim(), String(expected));
    await shot('32-inicio-do-site');
    // O resumo fica na conta: outro aparelho vê o mesmo número no Início
    await B.page.goto(BASE + '/');
    await B.page.waitForFunction((n) => document.body.innerText.includes('Revisar agora (' + n + ')'), expected, { timeout: 10000 });
    await page.click('text=Revisar agora');
    await page.waitForSelector('.flashcard', { timeout: 20000 });
    assert.equal(new URL(page.url()).pathname, '/flashcards/revisar');
    await page.click('button:has-text("Encerrar")');
  }

  step('versão só de flashcards (/cards): mesma conta e dados, sem o menu do site');
  {
    const onSite = await counts(page);
    await page.goto(BASE + '/cards');
    await page.waitForSelector('.fc-root.fc-standalone .hello', { timeout: 30000 });
    assert.equal(await page.$('aside'), null, 'sem o menu lateral do site');
    assert.equal(await page.$('.fc-root .fc-brand'), null, 'o título fica na barra do app');
    assert.deepEqual(await counts(page), onSite, 'mesma coleção');
    const head = () =>
      page.evaluate(() => ({
        manifest: document.querySelector('link[rel="manifest"]').getAttribute('href'),
        appTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content'),
        icon: document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'),
      }));
    assert.deepEqual(await head(), { manifest: '/cards.webmanifest', appTitle: 'Flashcards', icon: '/icons/flashcards-apple-touch.png' }, 'instalável como app próprio');
    const manifest = await (await A.context.request.get(BASE + '/cards.webmanifest')).json();
    assert.equal(manifest.start_url, '/cards');
    for (const icon of manifest.icons) assert.equal((await A.context.request.get(BASE + icon.src)).status(), 200, icon.src);
    await shot('34-app-flashcards');
    await page.click('.fc-tab[data-nav="decks"]');
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, '/cards/decks');
    // Alterna para a aba do site na mesma tela, e volta
    await page.click('.fc-head button[title="Mais opções dos flashcards"]');
    await page.click('.menu button:has-text("Abrir dentro do Projeto Residente")');
    await page.waitForSelector('aside a[href="/flashcards"][aria-current="page"]');
    assert.equal(new URL(page.url()).pathname, '/flashcards/decks');
    assert.deepEqual(await head(), { manifest: '/manifest.webmanifest', appTitle: 'Projeto Residente', icon: '/icons/apple-touch-icon.png' }, 'o site volta a ser o Projeto Residente');
    await page.click('.fc-head button[title="Mais opções dos flashcards"]');
    await page.click('.menu button:has-text("Abrir só os flashcards")');
    await page.waitForSelector('.fc-root.fc-standalone');
    assert.equal(new URL(page.url()).pathname, '/cards/decks');
    // Revisão e "Registrar estudo" também funcionam aqui
    const n = (await counts(page)).logs;
    await answerOne(page, '4');
    assert.equal((await counts(page)).logs, n + 1);
    await page.click('button:has-text("Encerrar")');
    await page.waitForSelector('.fc-register');
    await page.click('.fc-register button:has-text("Registrar estudo")');
    await page.locator('[role="dialog"]:has-text("Registrar estudo")').waitFor({ timeout: 10000 });
    await page.locator('[role="dialog"] button:has-text("Cancelar")').click();
    assert.equal(await flush(page), 0);
    // O link "Projeto Residente" leva ao Início do site
    await page.click('header a[title^="Abrir o Projeto Residente"]');
    await page.waitForSelector('aside a[href="/"][aria-current="page"]');
    assert.equal(new URL(page.url()).pathname, '/');
  }

  step('entrar pelo app de flashcards volta para ele depois do login');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    watch(p, 'Ana (app no celular)');
    await p.goto(BASE + '/cards/revisar');
    await p.waitForSelector('text=Entrar nos Flashcards');
    await p.fill('input[type="email"]', A.email);
    await p.fill('input[type="password"]', PASSWORD);
    await p.click('button[type="submit"]');
    await p.waitForSelector('.fc-root.fc-standalone', { timeout: 30000 });
    assert.equal(new URL(p.url()).pathname, '/cards/revisar');
    await p.evaluate(() => FC.app.go('/'));
    await p.waitForSelector('.fc-root .hello');
    await shot('35-app-flashcards-celular', { fullPage: false }, p);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'sem rolagem horizontal');
    await ctx.close();
  }

  step('busca global do site encontra os cards');
  await page.goto(BASE + '/busca?q=Borrmann');
  await page.waitForSelector('main a[href^="/flashcards/busca"]');
  assert.match(await page.textContent('main'), /Classificação de Borrmann/);
  await shot('33-busca-global');
  await page.click('main a[href^="/flashcards/busca"] >> nth=0');
  await page.waitForSelector('.fc-root .page-head');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('.page-head + .panel'), /cards? encontrados?/);

  step('"Importar deck aqui" na hierarquia: grande área, subárea e baralho escolhidos em listas');
  {
    await go('/decks');
    const row = page.locator('.tree-row', { has: page.locator('.label-btn', { hasText: /^Cirurgia$/ }) });
    await row.locator('button[title="Mais ações"]').click();
    await page.click('.menu [role="menuitem"]:has-text("Importar deck aqui")');
    await page.waitForSelector('text=Os cards vão para');
    assert.match(page.url(), /\/importar\?node=/);
    const csv = path.join(FLASH, 'tests/.tmp-trauma.csv');
    await writeFile(csv, '#separator:semicolon\n#html:true\nQual a primeira prioridade no ATLS?;Via aérea com proteção da coluna cervical\nQual o sinal de Kehr?;Dor no ombro esquerdo por irritação diafragmática\n');
    const chooser = page.waitForEvent('filechooser');
    await page.click('.dropzone');
    await (await chooser).setFiles(csv);
    await page.waitForSelector('text=Prévia', { timeout: 20000 });
    // A grande área vem do menu; as outras aparecem na lista mesmo com uma já escolhida
    assert.equal(await page.inputValue('#imp-area'), 'Cirurgia');
    const areas = await page.$$eval('#imp-area option', (els) => els.map((e) => e.value));
    assert.ok(areas.includes('Cirurgia') && areas.includes('Pediatria') && areas.includes('__novo__'), 'lista de grandes áreas: ' + areas);
    const subs = await page.$$eval('#imp-sub option', (els) => els.map((e) => e.value));
    assert.ok(subs.includes('Cirurgia Geral') && subs.includes('Digestiva'), 'subáreas da grande área: ' + subs);
    const decks = await page.$$eval('#imp-deck option', (els) => els.map((e) => e.value));
    assert.ok(decks.includes('Tutoria CG::Caso 11 - Câncer gástrico'), 'baralhos existentes na lista: ' + decks);
    await pickOrType('#imp-sub', 'Trauma');
    await pickOrType('#imp-deck', 'Tutoria CG::Caso 11 - Câncer gástrico');
    await shot('33b-importar-deck-aqui');
    await page.click('button:has-text("Importar ")');
    await page.waitForSelector('text=Importação concluída', { timeout: 30000 });
    const got = await evalFC(() =>
      [...FC.store.cards.values()]
        .filter((c) => /ATLS|Kehr/.test(c.front))
        .map((c) => [FC.areas.pathNames(c.nodeId).join(' › '), FC.decks.get(c.deckId).name]),
    );
    assert.deepEqual(got, [
      ['Cirurgia › Trauma', 'Tutoria CG::Caso 11 - Câncer gástrico'],
      ['Cirurgia › Trauma', 'Tutoria CG::Caso 11 - Câncer gástrico'],
    ]);
    await rm(csv, { force: true });
  }

  step('tema do site vale para os flashcards');
  {
    const toggle = page.locator('header button[aria-label^="Tema:"]');
    for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== 'dark'; i++) await toggle.click();
    await go('/estatisticas');
    await page.waitForTimeout(400);
    const bg = await page.$eval('.fc-root .panel', (el) => getComputedStyle(el).backgroundColor);
    assert.equal(bg, 'rgb(26, 26, 25)', 'painel no tema escuro');
    await shot('25-escuro-estatisticas');
    await go('/revisar');
    await page.waitForTimeout(300);
    await shot('26-escuro-revisao');
    for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== 'light'; i++) await toggle.click();
  }

  step('celular: revisão em tela cheia e sem rolagem lateral');
  await page.setViewportSize({ width: 390, height: 844 });
  await go('/revisar');
  await page.waitForTimeout(400);
  if (await page.$('.show-answer .btn')) {
    await page.keyboard.press('Space');
    await page.waitForSelector('.rating-bar');
    assert.equal(await page.$eval('.app-bottom-nav', (el) => getComputedStyle(el).display), 'none', 'barra do site some durante a revisão');
  }
  await shot('23-celular-revisao', { fullPage: false });
  await go('/');
  assert.notEqual(await page.$eval('.app-bottom-nav', (el) => getComputedStyle(el).display), 'none', 'barra do site volta depois');
  await shot('24-celular-inicio', { fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'sem rolagem horizontal no celular');
  await page.setViewportSize({ width: 1360, height: 900 });

  step('"Sair" envia o que falta e apaga a cópia local deste navegador');
  {
    await page.waitForTimeout(300);
    await page.click('header button[aria-label="Sair"]');
    await page.waitForURL('**/entrar', { timeout: 15000 });
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert.ok(!dbs.includes('fc:' + A.user.id), 'banco local apagado: ' + dbs.join(', '));
    assert.equal(await page.evaluate(() => FC.app.userId()), null);
  }

  assert.deepEqual(errors, [], 'sem erros no console');
  console.log('\nOK — ' + answered + ' respostas na primeira revisão, todos os fluxos passaram.');
} catch (e) {
  console.error('\nFALHOU:', e.message);
  console.error('Erros do console:', errors);
  try {
    await shot('zz-falha');
  } catch (err) {
    /* tela quebrada */
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await s3.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (e) {
    server.kill('SIGTERM');
  }
}
