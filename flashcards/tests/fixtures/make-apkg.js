/*
 * Gera dois pacotes do Anki para os testes de importação:
 *   legacy.apkg — collection.anki21 (esquema 11: modelos/baralhos em JSON), mídia em JSON
 *   modern.apkg — collection.anki21b (zstd, esquema 18: notetypes/templates/decks em tabelas
 *                 com configuração protobuf), mídia em protobuf + arquivos zstd
 * Uso: node tests/fixtures/make-apkg.js   (Node 22+, usa node:sqlite e zlib.zstdCompressSync)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');
const JSZip = require('../../assets/vendor/jszip.min.js');

const OUT = __dirname;
const DAY = 86400;
// Coleção criada em 1/1/2026 às 4h (hora local); "hoje" = data de geração
const crt = Math.floor(new Date(2026, 0, 1, 4, 0, 0).getTime() / 1000);
const today = Math.floor((Date.now() / 1000 - crt) / DAY);
const nowSec = Math.floor(Date.now() / 1000);

// PNG 1x1 vermelho
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a5c2b4a50000000049454e44ae426082', 'hex');

const MODEL_FRONT =
  '<div class="assunto-tag" style="margin:0 0 16px 0;line-height:1.5;"><span style="display:inline-block;font-weight:bold;font-size:0.8em;text-transform:uppercase;letter-spacing:0.5px;">Câncer gástrico</span><br><span style="display:inline-block;font-size:0.75em;font-style:italic;opacity:0.7;margin-top:4px;">Patologia › Câncer avançado</span></div><b>Pergunta:</b> Classificação de Borrmann?';
const MODEL_BACK = '<b>Resposta:</b><br>- 1: polipoide<br>- 2: ulcerado de bordas nítidas<br>- 3: úlcero-infiltrativo<br>- 4: difusamente infiltrativo (linite plástica)';

const BASIC_ID = 1700000000001;
const CLOZE_ID = 1700000000002;
const DECK_ID = 1700000000100;
const DECK_NAME = 'Cirurgia::Digestiva::Estômago';

function notesAndCards() {
  const n = (id, mid, flds, tags) => ({ id, guid: 'g' + id, mid, mod: nowSec, usn: -1, tags: ' ' + tags + ' ', flds: flds.join('\x1f'), sfld: flds[0], csum: 0, flags: 0, data: '' });
  const notes = [
    n(1710000000001, BASIC_ID, [MODEL_FRONT, MODEL_BACK], 'CancerGastrico::Patologia::CancerAvancado'),
    n(1710000000002, BASIC_ID, ['Qual o sinal radiológico da acalasia? <img src="figura.png">', 'Sinal do "bico de pássaro"'], 'acalasia'),
    n(1710000000003, BASIC_ID, ['Card suspenso?', 'Sim'], ''),
    n(1710000000004, CLOZE_ID, ['A {{c1::acalasia}} causa {{c2::disfagia::sintoma}}', 'Extra da nota'], 'cloze'),
  ];
  const c = (id, nid, ord, o) => Object.assign({ id, nid, did: DECK_ID, ord, mod: nowSec, usn: -1, type: 0, queue: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0, data: '{}' }, o);
  const cards = [
    c(1720000000001, 1710000000001, 0, { type: 2, queue: 2, due: today + 3, ivl: 15, factor: 2300, reps: 5, lapses: 1 }),
    c(1720000000002, 1710000000002, 0, { type: 0, queue: 0, due: 1 }),
    c(1720000000003, 1710000000003, 0, { type: 2, queue: -1, due: today - 2, ivl: 4, factor: 2500, reps: 2 }),
    c(1720000000004, 1710000000004, 0, { type: 1, queue: 1, due: nowSec + 600, ivl: 0, factor: 0, reps: 1, left: 1001 }),
    c(1720000000005, 1710000000004, 1, { type: 2, queue: 2, due: today + 10, ivl: 12, factor: 2500, reps: 3, data: '{"s":12.5,"d":6.1,"dr":0.9}' }),
  ];
  const ms = (daysAgo) => (nowSec - daysAgo * DAY) * 1000;
  const r = (id, cid, ease, ivl, lastIvl, type, time = 8000) => ({ id, cid, usn: -1, ease, ivl, lastIvl, factor: 2500, time, type });
  const revlog = [
    r(ms(40), 1720000000001, 3, -600, 0, 0),
    r(ms(40) + 700000, 1720000000001, 3, 1, -600, 0),
    r(ms(38), 1720000000001, 3, 4, 1, 1),
    r(ms(33), 1720000000001, 1, -600, 4, 1),
    r(ms(33) + 700000, 1720000000001, 3, 2, -600, 2),
    r(ms(12), 1720000000001, 3, 15, 2, 1),
    r(ms(8), 1720000000003, 3, 4, 1, 1),
    r(ms(0.01), 1720000000004, 1, -600, 0, 0),
    r(ms(20), 1720000000005, 3, 5, 1, 1),
    r(ms(9), 1720000000005, 4, 12, 5, 1),
  ];
  return { notes, cards, revlog };
}

function commonTables(db) {
  db.exec(`
    CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
    CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
  `);
  const { notes, cards, revlog } = notesAndCards();
  const ins = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  };
  notes.forEach((n) => ins('notes', n));
  cards.forEach((c) => ins('cards', c));
  revlog.forEach((r) => ins('revlog', r));
}

const BASIC_TMPL = { name: 'Card 1', ord: 0, qfmt: '{{Frente}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Verso}}' };
const CLOZE_TMPL = { name: 'Cloze', ord: 0, qfmt: '{{cloze:Texto}}', afmt: '{{cloze:Texto}}<br>\n{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}' };

function legacyDb(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text)');
  const models = {
    [BASIC_ID]: { id: BASIC_ID, name: 'Básico', type: 0, flds: [{ name: 'Frente', ord: 0 }, { name: 'Verso', ord: 1 }], tmpls: [BASIC_TMPL], css: '' },
    [CLOZE_ID]: { id: CLOZE_ID, name: 'Omissão de palavras', type: 1, flds: [{ name: 'Texto', ord: 0 }, { name: 'Extra', ord: 1 }], tmpls: [CLOZE_TMPL], css: '' },
  };
  const decks = { 1: { id: 1, name: 'Default' }, [DECK_ID]: { id: DECK_ID, name: DECK_NAME } };
  db.prepare('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)').run(crt, nowSec, nowSec, '{}', JSON.stringify(models), JSON.stringify(decks), '{}', '{}');
  commonTables(db);
  db.close();
}

// Protobuf mínimo
function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}
const pbString = (field, s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(field * 8 + 2), varint(b.length), b]);
};
const pbBytes = (field, b) => Buffer.concat([varint(field * 8 + 2), varint(b.length), b]);
const pbVarint = (field, v) => Buffer.concat([varint(field * 8), varint(v)]);

function modernDb(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
    CREATE TABLE notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
    CREATE TABLE fields (ntid integer, ord integer, name text, config blob, primary key (ntid, ord));
    CREATE TABLE templates (ntid integer, ord integer, name text, mtime_secs integer, usn integer, config blob, primary key (ntid, ord));
    CREATE TABLE decks (id integer primary key, name text, mtime_secs integer, usn integer, common blob, kind blob);
  `);
  db.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 18, 0, 0, 0, '', '', '', '', '')").run(crt, nowSec, nowSec);
  db.prepare('INSERT INTO notetypes VALUES (?, ?, ?, 0, ?)').run(BASIC_ID, 'Básico', nowSec, pbVarint(1, 0));
  db.prepare('INSERT INTO notetypes VALUES (?, ?, ?, 0, ?)').run(CLOZE_ID, 'Omissão de palavras', nowSec, pbVarint(1, 1));
  for (const [ntid, names] of [[BASIC_ID, ['Frente', 'Verso']], [CLOZE_ID, ['Texto', 'Extra']]]) names.forEach((name, ord) => db.prepare('INSERT INTO fields VALUES (?, ?, ?, ?)').run(ntid, ord, name, Buffer.alloc(0)));
  for (const [ntid, t] of [[BASIC_ID, BASIC_TMPL], [CLOZE_ID, CLOZE_TMPL]]) {
    db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, 0, ?)').run(ntid, t.ord, t.name, nowSec, Buffer.concat([pbString(1, t.qfmt), pbString(2, t.afmt)]));
  }
  db.prepare('INSERT INTO decks VALUES (1, ?, ?, 0, ?, ?)').run('Default', nowSec, Buffer.alloc(0), Buffer.alloc(0));
  db.prepare('INSERT INTO decks VALUES (?, ?, ?, 0, ?, ?)').run(DECK_ID, DECK_NAME.split('::').join('\x1f'), nowSec, Buffer.alloc(0), Buffer.alloc(0));
  commonTables(db);
  db.close();
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'apkg-'));
  // legacy
  const legacyFile = path.join(tmp, 'collection.anki21');
  legacyDb(legacyFile);
  const z1 = new JSZip();
  z1.file('collection.anki21', fs.readFileSync(legacyFile));
  z1.file('media', JSON.stringify({ 0: 'figura.png' }));
  z1.file('0', PNG);
  fs.writeFileSync(path.join(OUT, 'legacy.apkg'), await z1.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  // modern
  const modernFile = path.join(tmp, 'collection.anki21b');
  modernDb(modernFile);
  const z2 = new JSZip();
  z2.file('collection.anki21b', zlib.zstdCompressSync(fs.readFileSync(modernFile)));
  z2.file('collection.anki2', Buffer.alloc(0));
  const entry = Buffer.concat([pbString(1, 'figura.png'), pbVarint(2, PNG.length)]);
  z2.file('media', zlib.zstdCompressSync(pbBytes(1, entry)));
  z2.file('meta', pbVarint(1, 3));
  z2.file('0', zlib.zstdCompressSync(PNG));
  fs.writeFileSync(path.join(OUT, 'modern.apkg'), await z2.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok: legacy.apkg e modern.apkg (crt', crt, 'hoje', today + ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
