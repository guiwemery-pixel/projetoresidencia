/*
 * Limpeza do HTML dos cards (vindos de CSV, Anki, IA ou colados).
 * Lista de permissão: só formatação de texto, listas, tabelas e imagens.
 * Scripts, eventos (on*), iframes, formulários e URLs javascript: são removidos.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const ALLOWED = new Set(
    (
      'b strong i em u s strike del ins sub sup br p div span ul ol li table thead tbody tfoot tr td th caption ' +
      'colgroup col hr small big code pre blockquote h1 h2 h3 h4 h5 h6 img font mark a center dl dt dd ruby rt rp abbr kbd q cite'
    ).split(' '),
  );
  // Tags removidas junto com o conteúdo
  const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'audio', 'video', 'source', 'frame', 'frameset']);
  const GLOBAL_ATTRS = new Set(['class', 'style', 'title', 'lang', 'dir']);
  const TAG_ATTRS = {
    td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
    th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
    col: ['span', 'width'],
    table: ['border', 'cellpadding', 'cellspacing', 'width', 'align'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['color', 'size', 'face'],
    a: ['href'],
    ol: ['start', 'type'],
    p: ['align'],
    div: ['align'],
  };

  function cleanStyle(style) {
    return style
      .split(';')
      .map((d) => d.trim())
      .filter((d) => {
        if (!d) return false;
        const low = d.toLowerCase();
        if (/url\s*\(|expression|javascript:|@import|behavior|-moz-binding/.test(low)) return false;
        // Nada de sobrepor a interface
        if (/^(position|z-index|inset|top|left|right|bottom)\s*:/.test(low)) return false;
        return true;
      })
      .join('; ');
  }

  function safeUrl(url, forImage) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (forImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp);/i.test(u)) return u;
    // Nome de arquivo de mídia (ex.: imagens de decks do Anki), sem esquema
    if (forImage && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//')) return u;
    return '';
  }

  function cleanNode(node, doc) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue; // texto
      if (child.nodeType !== 1) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove();
        continue;
      }
      if (!ALLOWED.has(tag)) {
        // Mantém o conteúdo, descarta a tag
        cleanNode(child, doc);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      const allowed = TAG_ATTRS[tag] || [];
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!GLOBAL_ATTRS.has(name) && !allowed.includes(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style') {
          const s = cleanStyle(attr.value);
          if (s) child.setAttribute('style', s);
          else child.removeAttribute('style');
        } else if (name === 'href') {
          const u = safeUrl(attr.value, false);
          if (u) child.setAttribute('href', u);
          else child.removeAttribute('href');
        } else if (name === 'src') {
          const u = safeUrl(attr.value, true);
          if (u) child.setAttribute('src', u);
          else child.removeAttribute('src');
        }
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      cleanNode(child, doc);
    }
  }

  /** HTML → HTML seguro (string). */
  function sanitize(html) {
    if (html == null) return '';
    const text = String(html).replace(/\[sound:[^\]]*\]/g, '');
    if (!/[<&]/.test(text)) return text;
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + text, 'text/html');
    cleanNode(doc.body, doc);
    return doc.body.innerHTML;
  }

  FC.sanitize = sanitize;
})(typeof self !== 'undefined' ? self : this);
