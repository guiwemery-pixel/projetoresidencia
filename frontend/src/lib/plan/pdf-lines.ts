// Linhas de texto de um PDF, com a cor do marcador (quadradinho) à esquerda.
// Os cronogramas de cursinho costumam indicar a grande área pela cor desse
// marcador; a cor sai das instruções de desenho do PDF (sem renderizar a página).
// Funciona no navegador e no Node: quem chama entrega o módulo do pdf.js.

export interface PlanLine {
  page: number;
  text: string;
  /** Posição do início da linha (pontos do PDF, origem embaixo à esquerda) */
  x: number;
  y: number;
  size: number;
  /** Cor do marcador à esquerda da linha (#rrggbb), se houver */
  marker: string | null;
}

type Matrix = [number, number, number, number, number, number];

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

/** Retângulos pequenos preenchidos com cor (candidatos a marcador). */
function coloredBoxes(ops: { fnArray: number[]; argsArray: unknown[][] }, OPS: Record<string, number>): Box[] {
  const boxes: Box[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill: string | null = null;
  const fillStack: (string | null)[] = [];
  let path: number[] | null = null; // [minX, minY, maxX, maxY]
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        fillStack.push(fill);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        fill = fillStack.pop() ?? fill;
        break;
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        fillStack.push(fill);
        if (Array.isArray(args?.[0])) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        fill = fillStack.pop() ?? fill;
        break;
      case OPS.setFillRGBColor: {
        const c = args as unknown as ArrayLike<number> | [string];
        fill = typeof (c as [string])[0] === 'string' ? (c as [string])[0] : hex((c as ArrayLike<number>)[0], (c as ArrayLike<number>)[1], (c as ArrayLike<number>)[2]);
        break;
      }
      case OPS.setFillGray:
      case OPS.setFillCMYKColor:
      case OPS.setFillColorN:
      case OPS.setFillColor:
        fill = null;
        break;
      case OPS.constructPath: {
        const minMax = args?.[2] as ArrayLike<number> | undefined;
        path = minMax && minMax.length >= 4 ? [minMax[0], minMax[1], minMax[2], minMax[3]] : null;
        break;
      }
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        if (path && fill) {
          const [ax, ay] = apply(ctm, path[0], path[1]);
          const [bx, by] = apply(ctm, path[2], path[3]);
          const box = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), color: fill };
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          if (w > 1 && h > 1 && w < 20 && h < 20) boxes.push(box);
        }
        path = null;
        break;
      case OPS.endPath:
      case OPS.clip:
      case OPS.eoClip:
        path = null;
        break;
    }
  }
  return boxes;
}

/** Cor pouco saturada (preto, cinza, branco) não é marcador de área. */
function isVivid(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 0.25 && max > 0.3;
}

/** Junta os pedaços de texto em linhas (mesma altura), na ordem de leitura. */
function textLines(items: PdfTextItem[]) {
  const pieces = items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], size: Math.abs(it.transform[3]) || it.height || 10, w: it.width }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { x: number; y: number; size: number; parts: typeof pieces }[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y - p.y) <= Math.max(2, l.size * 0.3));
    if (line) line.parts.push(p);
    else lines.push({ x: p.x, y: p.y, size: p.size, parts: [p] });
  }
  return lines.map((l) => {
    const parts = l.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const p of parts) {
      const gap = p.x - end;
      if (text && gap > p.size * 0.15 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
      text += p.str;
      end = p.x + p.w;
    }
    return { x: parts[0].x, y: l.y, size: l.size, text: text.replace(/\s+/g, ' ').trim() };
  });
}

/** Lê todas as páginas: linhas de texto e, se houver, a cor do marcador de cada linha. */
export async function pdfLines(doc: PdfDocument, OPS: Record<string, number>): Promise<PlanLine[]> {
  const out: PlanLine[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const boxes = coloredBoxes(ops, OPS).filter((b) => isVivid(b.color));
    for (const l of textLines(content.items as PdfTextItem[])) {
      // Marcador: logo à esquerda do início da linha, na mesma altura
      const marker = boxes
        .filter((b) => b.x1 <= l.x + 2 && l.x - b.x1 < 16 && b.y1 >= l.y - l.size * 0.4 && b.y0 <= l.y + l.size)
        .sort((a, b) => b.x1 - a.x1)[0];
      out.push({ page: n, text: l.text, x: l.x, y: l.y, size: l.size, marker: marker?.color ?? null });
    }
    page.cleanup();
  }
  return out;
}
