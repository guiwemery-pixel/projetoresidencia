import type { Tx } from '../../../lib/prisma.js';
import { medicina } from './medicina.js';

// Templates de áreas do conhecimento. Para usar a plataforma em outra área
// (concursos, vestibular, direito…), basta adicionar um novo template aqui.

export interface Template {
  key: string;
  label: string;
  areas: { name: string; color?: string; children: string[] }[];
  boards: string[];
}

const vazio: Template = { key: 'vazio', label: 'Começar do zero', areas: [], boards: [] };

export const TEMPLATES = { medicina, vazio } satisfies Record<string, Template>;
export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]];

export async function applyTemplate(tx: Tx, userId: string, key: TemplateKey) {
  const template = TEMPLATES[key];
  for (const [i, area] of template.areas.entries()) {
    const parent = await tx.area.create({ data: { userId, name: area.name, color: area.color, position: i } });
    if (area.children.length) {
      await tx.area.createMany({
        data: area.children.map((name, j) => ({ userId, name, parentId: parent.id, position: j })),
      });
    }
  }
  if (template.boards.length) {
    await tx.board.createMany({ data: template.boards.map((name) => ({ userId, name })), skipDuplicates: true });
  }
}
