// Testes de formatos: modelo Anki CSV, JSON de baralho e conversão do Anki (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../js/export.js');
const A = require('../../js/anki.js');
const U = require('../../js/util.js');

const MODEL = fs.readFileSync(path.join(__dirname, '../fixtures/modelo-cancer-gastrico.csv'), 'utf8');

test('lê o modelo: cabeçalhos, assunto › tema › subtema, pergunta e resposta limpas', () => {
  const r = F.parseText(MODEL);
  assert.equal(r.rows.length, 80);
  assert.equal(r.meta.separator, ';');
  assert.equal(r.meta.deck, 'Tutoria CG::Caso 11 - Câncer gástrico');
  const first = r.rows[0];
  assert.equal(first.subject, 'Câncer gástrico');
  assert.deepEqual(first.topics, ['Epidemiologia', 'Brasil (INCA)']);
  assert.equal(first.front, 'Incidência e mortalidade do câncer de estômago no Brasil?');
  assert.ok(first.back.startsWith('- 22.530 casos'));
  assert.deepEqual(first.tags, ['CancerGastrico::Epidemiologia::BrasilINCA']);
});

test('exporta de volta no modelo, idêntico ao arquivo original', () => {
  const r = F.parseText(MODEL);
  const paths = new Map();
  const cards = r.rows.map((row, i) => {
    paths.set('n' + i, ['Cirurgia', 'Cirurgia Geral', row.subject].concat(row.topics));
    return { id: 'c' + i, nodeId: 'n' + i, deckId: 'd', front: row.front, back: row.back, tags: [] };
  });
  const out = F.toAnkiCsv(cards, { pathNames: (id) => paths.get(id), deckName: () => 'Tutoria CG::Caso 11 - Câncer gástrico' });
  assert.equal(out.trim(), MODEL.replace(/\r/g, '').trim());
});

test('tags hierárquicas no padrão do modelo', () => {
  assert.equal(U.pascalTag('TNM (AJCC 8ª ed.)'), 'TNMAJCC8aEd');
  assert.equal(U.pascalTag('Ambientais e estilo de vida'), 'AmbientaisEEstiloDeVida');
  assert.equal(U.pascalTag('H. pylori'), 'HPylori');
  assert.equal(F.hierarchicalTag(['Cirurgia', 'Cirurgia Geral', 'Câncer gástrico', 'Estadiamento', 'TNM (AJCC 8ª ed.)']), 'CancerGastrico::Estadiamento::TNMAJCC8aEd');
});

test('planilha com títulos de coluna (Pergunta/Resposta/Assunto/Tema)', () => {
  const csv = 'Pergunta;Resposta;Grande área;Subárea;Assunto;Tema;Tags\n"Qual o agente da TB?";"<i>M. tuberculosis</i>";Clínica Médica;Infectologia;Tuberculose;Etiologia;ENARE\n';
  const r = F.parseText(csv);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].explicitPath, ['Clínica Médica', 'Infectologia', 'Tuberculose', 'Etiologia', '']);
  assert.equal(r.rows[0].back, '<i>M. tuberculosis</i>');
  assert.deepEqual(r.rows[0].tags, ['ENARE']);
});

test('formato antigo do Notion (#separator:Semicolon, só pergunta e resposta)', () => {
  const txt = '#separator:Semicolon\n#html:true\n"Quando associar colchicina?";"<b>Em todo episódio</b><br>• 0,5mg 2x/dia"\n';
  const r = F.parseText(txt);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].front, 'Quando associar colchicina?');
  assert.equal(r.rows[0].hasModelHeader, false);
});

test('pacote JSON de baralho leva agendamento e histórico', () => {
  const card = { id: 'c1', front: 'P?', back: 'R', nodeId: 'n', deckId: 'd', tags: ['x'], state: 'review', dueDate: 123, stability: 9.5, difficulty: 4.2, repetitions: 3, lapses: 1, scheduledDays: 7, lastReview: 100 };
  const ctx = { pathNames: () => ['A', 'B', 'C'], deckName: () => 'Deck', logsOf: () => [{ id: 'l', cardId: 'c1', date: 100, rating: 4 }] };
  const parsed = F.parseJson(F.toDeckPackage([card], ctx, true));
  assert.equal(parsed.kind, 'deck');
  assert.ok(parsed.includesScheduling);
  const c = parsed.cards[0];
  assert.deepEqual(c.path, ['A', 'B', 'C']);
  assert.equal(c.scheduling.stability, 9.5);
  assert.equal(c.scheduling.lapses, 1);
  assert.equal(c.logs.length, 1);
  assert.equal(c.logs[0].rating, 4);
  assert.equal(c.logs[0].cardId, undefined, 'ids internos não vão no arquivo');
});

test('CSV: campos com aspas, ponto e vírgula e quebras de linha', () => {
  const rows = [['a;b', 'linha 1\nlinha 2', 'com "aspas"']];
  assert.deepEqual(U.parseCsv(U.toCsv(rows, ';'), ';'), rows);
});

// ── Anki ─────────────────────────────────────────────────────────────────────
test('Anki: modelos com seções, {{FrontSide}} e cloze', () => {
  const basic = { type: 0, name: 'Básico', flds: [{ name: 'Frente', ord: 0 }, { name: 'Verso', ord: 1 }, { name: 'Extra', ord: 2 }], tmpls: [{ ord: 0, qfmt: '{{Frente}}', afmt: '{{FrontSide}}<hr id=answer>{{Verso}}{{#Extra}}<br>{{Extra}}{{/Extra}}' }] };
  let r = A.renderCard(basic, { flds: 'P?\x1fR\x1f' }, 0, 'D');
  assert.equal(r.front, 'P?');
  assert.equal(r.back, 'R');
  r = A.renderCard(basic, { flds: 'P?\x1fR\x1fmais' }, 0, 'D');
  assert.equal(r.back, 'R<br>mais');
  const cloze = { type: 1, name: 'Cloze', flds: [{ name: 'Texto', ord: 0 }], tmpls: [{ ord: 0, qfmt: '{{cloze:Texto}}', afmt: '{{cloze:Texto}}' }] };
  r = A.renderCard(cloze, { flds: 'A {{c1::acalasia}} causa {{c2::disfagia::sintoma}}' }, 1, 'D');
  assert.equal(r.front, 'A acalasia causa <span class="cloze">[sintoma]</span>');
  assert.equal(r.back, 'A acalasia causa <span class="cloze">disfagia</span>');
});

test('Anki: agendamento convertido (vencimento, intervalo, FSRS do Anki, suspensão, histórico)', () => {
  const crt = Math.floor(new Date(2026, 0, 1, 4).getTime() / 1000);
  const card = { type: 2, queue: -1, due: 100, ivl: 12, factor: 2500, reps: 3, lapses: 1, odue: 0, odid: 0, data: '{"s":12.5,"d":6.1}' };
  const revlog = [
    { id: 1760000000000, ease: 3, ivl: 5, lastIvl: 1, time: 9000, type: 1 },
    { id: 1760900000000, ease: 1, ivl: -600, lastIvl: 5, time: 12000, type: 1 },
    { id: 1761000000000, ease: 0, ivl: 5, lastIvl: 5, time: 0, type: 4 },
  ];
  const r = A.convertScheduling(card, revlog, crt);
  assert.equal(r.suspended, true);
  assert.equal(r.scheduling.state, 'review');
  assert.equal(r.scheduling.stability, 12.5);
  assert.equal(r.scheduling.difficulty, 6.1);
  assert.equal(r.scheduling.scheduledDays, 12);
  assert.equal(r.scheduling.lapses, 1);
  const due = new Date(r.scheduling.dueDate);
  const expected = new Date(2026, 0, 1 + 100);
  assert.equal(due.getDate(), expected.getDate());
  assert.equal(due.getMonth(), expected.getMonth());
  assert.equal(r.logs.length, 2, 'reagendamento manual (ease 0) fica de fora');
  assert.deepEqual(r.logs.map((l) => l.rating), [4, 1], 'Bom→Bom, De novo→Errei');
  assert.equal(r.logs[1].newInterval, 600 / 86400);
});

test('Anki: sem FSRS salvo, recalcula pelo histórico', () => {
  const crt = Math.floor(new Date(2026, 0, 1, 4).getTime() / 1000);
  const card = { type: 2, queue: 2, due: 50, ivl: 20, factor: 2300, reps: 4, lapses: 0, data: '' };
  const day = 86400000;
  const base = new Date(2026, 1, 1).getTime();
  const revlog = [0, 1, 4, 12].map((d, i) => ({ id: base + d * day, ease: 3, ivl: [1, 3, 8, 20][i], lastIvl: 0, time: 5000, type: i ? 1 : 0 }));
  const r = A.convertScheduling(card, revlog, crt);
  assert.ok(r.scheduling.stability > 5);
  assert.ok(r.scheduling.difficulty >= 1 && r.scheduling.difficulty <= 10);
  assert.equal(r.scheduling.lastReview, base + 12 * day);
});

test('Anki: protobuf mínimo', () => {
  // campo 1 (string "ab"), campo 2 (varint 300)
  const buf = new Uint8Array([0x0a, 0x02, 0x61, 0x62, 0x10, 0xac, 0x02]);
  const f = A.parseProto(buf);
  assert.equal(new TextDecoder().decode(f[1][0]), 'ab');
  assert.equal(f[2][0], 300);
});
