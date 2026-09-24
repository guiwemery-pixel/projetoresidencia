import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Prisma } from '@prisma/client';
import { EXPLANATION_DICTIONARY_V1 } from './explanation-dictionary.js';

// A explicação do "Por quê?" é o maior dado de cada revisão (~1,4 KB de JSON
// com textos quase sempre iguais). Ela é gravada comprimida — deflate com um
// dicionário de explicações típicas —, ocupando ~0,1–0,2 KB. Sem perda: a
// leitura devolve exatamente o mesmo JSON.
//
// Formato: [versão do dicionário (1 byte)] + deflate raw.
// Um dicionário já usado NUNCA pode mudar (os dados gravados dependem dele);
// para melhorar a compressão, crie uma versão nova e mantenha as antigas.

const DICTIONARIES: Record<number, Buffer> = {
  1: Buffer.from(EXPLANATION_DICTIONARY_V1, 'utf8'),
};
const CURRENT_VERSION = 1;

export function packExplanation(value: unknown): Uint8Array<ArrayBuffer> {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  const body = deflateRawSync(json, { level: 9, dictionary: DICTIONARIES[CURRENT_VERSION] });
  const packed = new Uint8Array(body.length + 1);
  packed[0] = CURRENT_VERSION;
  packed.set(body, 1);
  return packed;
}

export function unpackExplanation(packed: Uint8Array): Prisma.JsonValue {
  const buf = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
  const dictionary = DICTIONARIES[buf[0]];
  if (!dictionary) throw new Error(`Versão de explicação desconhecida: ${buf[0]}`);
  return JSON.parse(inflateRawSync(buf.subarray(1), { dictionary }).toString('utf8'));
}

/** Explicação de uma revisão, no formato comprimido ou no antigo (JSON). */
export function readExplanation(r: { explanation: Prisma.JsonValue | null; explanationPacked: Uint8Array | null }) {
  if (!r.explanationPacked) return r.explanation;
  try {
    return unpackExplanation(r.explanationPacked);
  } catch (err) {
    console.error('Explicação ilegível', err);
    return null;
  }
}
