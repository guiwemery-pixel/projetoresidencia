/*
 * PDF → texto por página (pdf.js, local). O texto fica guardado como "fonte"
 * para cada card saber de que arquivo/página veio; o PDF original pode ser
 * guardado no navegador para abrir direto na página.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { uid } = FC.util;

  const CHUNK_CHARS = 100000;

  async function lib() {
    await FC.loader.script('assets/vendor/pdf.min.js');
    const pdfjs = root.pdfjsLib;
    if (!pdfjs) throw new Error('Leitor de PDF indisponível.');
    const workerUrl = FC.loader.url('assets/vendor/pdf.worker.min.js');
    if (location.protocol === 'file:') {
      // Aberto direto do computador: sem Web Worker; o pdf.js usa o "worker" na página
      await FC.loader.script('assets/vendor/pdf.worker.min.js');
    }
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  }

  function cleanPageText(items) {
    let text = '';
    for (const item of items) {
      if (item.str == null) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    return text
      .replace(/(\w)-\n(\w)/g, '$1$2') // hifenização no fim da linha
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Lê o PDF: { fileName, size, pageCount, pages: [texto], emptyPages } */
  async function extract(file, onProgress) {
    const pdfjs = await lib();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    const pages = [];
    let emptyPages = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = cleanPageText(content.items);
      if (text.length < 20) emptyPages++;
      pages.push(text);
      page.cleanup();
      if (onProgress) onProgress(i, doc.numPages);
    }
    await doc.destroy();
    return { fileName: file.name, size: file.size, pageCount: pages.length, pages, emptyPages };
  }

  /** Divide as páginas [from, to] (1-based) em blocos de até maxChars, com marcas [[Página N]]. */
  function chunk(pages, from = 1, to = pages.length, maxChars = CHUNK_CHARS) {
    const out = [];
    let cur = null;
    for (let p = from; p <= to; p++) {
      const text = pages[p - 1] || '';
      if (!text.trim()) continue;
      const block = '[[Página ' + p + ']]\n' + text + '\n';
      if (cur && cur.text.length + block.length > maxChars) {
        out.push(cur);
        cur = null;
      }
      if (!cur) cur = { fromPage: p, toPage: p, text: '' };
      if (block.length > maxChars) {
        // Página enorme: corta em pedaços
        for (let i = 0; i < block.length; i += maxChars) {
          if (cur.text) {
            out.push(cur);
            cur = { fromPage: p, toPage: p, text: '' };
          }
          cur.text = block.slice(i, i + maxChars);
        }
      } else cur.text += block;
      cur.toPage = p;
    }
    if (cur && cur.text) out.push(cur);
    return out;
  }

  /** Texto simples colado → mesmo formato de páginas (uma "página" a cada ~3000 caracteres). */
  function fromText(text, name) {
    const clean = String(text || '').replace(/\r/g, '').trim();
    const pages = [];
    const paras = clean.split(/\n{2,}/);
    let cur = '';
    for (const p of paras) {
      if (cur && cur.length + p.length > 3000) {
        pages.push(cur.trim());
        cur = '';
      }
      cur += p + '\n\n';
    }
    if (cur.trim()) pages.push(cur.trim());
    return { fileName: name || 'Texto colado', size: clean.length, pageCount: pages.length, pages, emptyPages: 0, pasted: true };
  }

  async function saveSource(extracted, file, keepPdf) {
    const source = {
      id: uid('src'),
      fileName: extracted.fileName,
      size: extracted.size,
      pageCount: extracted.pageCount,
      pages: extracted.pages,
      addedAt: Date.now(),
      hasPdf: !!(keepPdf && file),
      pasted: !!extracted.pasted,
    };
    await FC.db.put('sources', source);
    if (keepPdf && file) await FC.db.put('sourceFiles', { id: source.id, blob: file });
    FC.store.sources.set(source.id, source);
    FC.store.emit('sources');
    return source;
  }

  function findSource(card) {
    if (!card || !card.source) return null;
    if (card.source.sourceId && FC.store.sources.has(card.source.sourceId)) return FC.store.sources.get(card.source.sourceId);
    for (const s of FC.store.sources.values()) if (s.fileName === card.source.fileName) return s;
    return null;
  }

  /** Texto das páginas ao redor (para a IA refazer/detalhar um card com base na fonte). */
  function contextFor(card, radius = 1, maxChars = 12000) {
    const src = findSource(card);
    if (!src || !card.source.page) return '';
    const p = card.source.page;
    const parts = [];
    for (let i = Math.max(1, p - radius); i <= Math.min(src.pageCount, p + radius); i++) parts.push('[[Página ' + i + ']]\n' + (src.pages[i - 1] || ''));
    return parts.join('\n').slice(0, maxChars);
  }

  async function openPdf(sourceId, page) {
    const row = await FC.db.get('sourceFiles', sourceId);
    if (!row || !row.blob) return false;
    const url = URL.createObjectURL(row.blob);
    const win = window.open(url + (page ? '#page=' + page : ''), '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return !!win || true;
  }

  async function removeSource(id) {
    FC.store.sources.delete(id);
    await FC.db.del('sources', id);
    await FC.db.del('sourceFiles', id);
    FC.store.emit('sources');
  }

  FC.pdf = { CHUNK_CHARS, extract, chunk, fromText, saveSource, findSource, contextFor, openPdf, removeSource };
})(typeof self !== 'undefined' ? self : this);
