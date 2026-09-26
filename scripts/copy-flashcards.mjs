// Copia o app de flashcards (estático, sem build) para frontend/dist/flashcards,
// para ser publicado junto com o frontend (Vercel e Docker servem frontend/dist).
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'flashcards');
const dest = path.join(root, 'frontend', 'dist', 'flashcards');
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets'];

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const item of ITEMS) await cp(path.join(src, item), path.join(dest, item), { recursive: true });
console.log('Flashcards copiado para', path.relative(root, dest));
