// Testes do pedido para a IA no modo manual e da leitura da resposta (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.FC = { util: require('../../js/util.js') };
require('../../js/ai.js');
const AI = globalThis.FC.ai;

const req = (schema) => ({ system: 'Sistema', user: 'Gere 3 flashcards.', schema });

test('pedido de cards: pede um arquivo CSV separado por ";" com cabeçalho fixo', () => {
  const p = AI.manualPrompt(req(AI.CARDS_SCHEMA));
  assert.match(p, /ARQUIVO CSV/);
  assert.match(p, /ponto e vírgula \(;\)/);
  assert.ok(p.includes(AI.CSV_HEADER));
  assert.equal(AI.CSV_HEADER, 'Pergunta;Resposta;Grande área;Subárea;Assunto;Tema;Subtema;Tags;Dificuldade;Tipo;Página;Referência');
  assert.doesNotMatch(p, /JSON válido/);
  // Sugestões de temas continuam em JSON
  assert.match(AI.manualPrompt(req(AI.SUGGEST_SCHEMA)), /JSON válido/);
});

test('lê o CSV da IA: texto em volta, aspas, ";" dentro do campo e tags', () => {
  const text = [
    'Claro! Aqui está o arquivo:',
    '```csv',
    '﻿' + AI.CSV_HEADER,
    'Tratamentos da acalasia?;- Miotomia de Heller<br>- POEM;Cirurgia;Cirurgia Digestiva;Acalasia;Tratamento;;acalasia esofago;media;conduta;12;',
    '"Sinal do ""bico de pássaro""?";"Esofagograma; afilamento distal";Cirurgia;Cirurgia Digestiva;Acalasia;Diagnóstico;;acalasia;facil;pergunta;;Diretriz X',
    '```',
    'Quer mais cards?',
  ].join('\n');
  const data = AI.parseResponse(text);
  assert.equal(data.cards.length, 2);
  const [a, b] = data.cards;
  assert.equal(a.front, 'Tratamentos da acalasia?');
  assert.equal(a.back, '- Miotomia de Heller<br>- POEM');
  assert.deepEqual([a.area, a.subarea, a.subject, a.topic, a.subtopic], ['Cirurgia', 'Cirurgia Digestiva', 'Acalasia', 'Tratamento', '']);
  assert.deepEqual(a.tags, ['acalasia', 'esofago']);
  assert.equal(a.page, 12);
  assert.equal(b.front, 'Sinal do "bico de pássaro"?');
  assert.equal(b.back, 'Esofagograma; afilamento distal');
  assert.equal(b.page, null);
  assert.equal(b.reference, 'Diretriz X');
  const cards = AI.normalizeCards(data, { fileName: 'acalasia.pdf' });
  assert.deepEqual(cards[0].path, ['Cirurgia', 'Cirurgia Digestiva', 'Acalasia', 'Tratamento', '']);
  assert.equal(cards[0].difficulty, 'media');
  assert.equal(cards[0].source.page, 12);
});

test('CSV colado sem bloco de código e com cabeçalho sem acentos', () => {
  const data = AI.parseResponse('pergunta;resposta;grande area;subarea;assunto;tema\nQ?;R;Cirurgia;Digestiva;Acalasia;Tratamento\n');
  assert.equal(data.cards.length, 1);
  assert.equal(data.cards[0].subarea, 'Digestiva');
});

test('CSV só com o cabeçalho dá um erro claro; JSON continua aceito', () => {
  assert.throws(() => AI.parseResponse(AI.CSV_HEADER + '\n'), /nenhum card/);
  assert.throws(() => AI.parseResponse('texto corrido sem cards'), /Pergunta;Resposta/);
  const json = AI.parseResponse('```json\n{"cards":[{"front":"Q?","back":"R"}]}\n```');
  assert.equal(json.cards[0].front, 'Q?');
});
