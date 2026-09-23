import { z } from 'zod';
import { DATE_RE } from './dates.js';
import { badRequest } from './errors.js';

export const dateString = z.string().regex(DATE_RE, 'Data inválida (use AAAA-MM-DD)');
export const id = z.string().min(1).max(64);
export const optionalText = (max = 2000) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v))
    .nullish();

/** Valida `data` com o schema e lança 400 com os detalhes em caso de erro. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Dados inválidos', result.error.flatten());
  }
  return result.data;
}
