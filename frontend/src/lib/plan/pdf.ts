// Leitura do PDF no navegador (o pdf.js só é baixado quando alguém importa um cronograma).

import { pdfLines, type PdfDocument, type PlanLine } from './pdf-lines';

export async function readPdf(file: File): Promise<PlanLine[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (err) {
    if ((err as { name?: string })?.name === 'PasswordException') throw new Error('Este PDF tem senha. Abra-o, salve uma cópia sem senha e tente de novo.');
    throw new Error('Não consegui abrir este PDF. Confira se o arquivo está inteiro ou cole o texto do cronograma.');
  }
  try {
    const lines = await pdfLines(doc as unknown as PdfDocument, pdfjs.OPS as unknown as Record<string, number>);
    if (!lines.length) throw new Error('Este PDF não tem texto (parece uma imagem digitalizada). Cole o texto do cronograma no campo ao lado.');
    return lines;
  } finally {
    void doc.destroy();
  }
}
