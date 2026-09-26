/*
 * Formatos de arquivo (puro, sem DOM):
 *  - Modelo Anki CSV (o padrão dos seus flashcards): cabeçalhos #separator/#html/#deck/#columns,
 *    frente com o bloco "assunto-tag" (Assunto + "Tema › Subtema") e "<b>Pergunta:</b>",
 *    verso com "<b>Resposta:</b><br>" e tags hierárquicas "Assunto::Tema::Subtema".
 *  - CSV simples com cabeçalho (campos escolhidos), TXT legível e JSON.
 *  - Pacote JSON de baralho com agendamento e histórico (para levar os cards com as revisões).
 */
(function (root, factory) {
  const util = typeof module === 'object' && module.exports ? require('./util.js') : root.FC.util;
  const mod = factory(util);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).formats = mod;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  const { parseCsv, toCsv, sniffDelimiter, stripHtml, escapeHtml, textToHtml, pascalTag, normalizeText, decodeEntities } = util;

  const FORMAT_DECK = 'flashcards-medicina/deck';
  const FORMAT_BACKUP = 'flashcards-medicina/backup';

  // ── Modelo: cabeçalho "assunto-tag" ────────────────────────────────────────
  const HEADER_RE = /<div[^>]*class=["']?[^"'>]*assunto-tag[^"'>]*["']?[^>]*>([\s\S]*?)<\/div>/i;
  const SPAN_RE = /<span[^>]*>([\s\S]*?)<\/span>/gi;

  function plain(html) {
    return decodeEntities(String(html || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  }

  /** Extrai {subject, topics[], html sem o cabeçalho e sem "Pergunta:"} da frente. */
  function parseModelFront(html) {
    let s = String(html || '');
    let subject = null;
    let topics = [];
    const m = s.match(HEADER_RE);
    if (m) {
      const spans = [];
      let sm;
      SPAN_RE.lastIndex = 0;
      while ((sm = SPAN_RE.exec(m[1]))) spans.push(plain(sm[1]));
      if (spans[0]) subject = spans[0];
      if (spans[1]) topics = spans[1].split(/\s*(?:›|»|>|&gt;|\/)\s*/).map((x) => x.trim()).filter(Boolean);
      s = s.replace(m[0], '');
    }
    s = s.replace(/^\s*(<br\s*\/?>\s*)*/i, '').replace(/^\s*(<b>|<strong>)?\s*Pergunta\s*:\s*(<\/b>|<\/strong>)?\s*/i, '');
    return { subject, topics, html: s.trim() };
  }

  function parseModelBack(html) {
    return String(html || '')
      .replace(/^\s*(<b>|<strong>)?\s*Resposta\s*:\s*(<\/b>|<\/strong>)?\s*(<br\s*\/?>)?\s*/i, '')
      .trim();
  }

  function headerHtml(subject, topics) {
    if (!subject) return '';
    let out =
      '<div class="assunto-tag" style="margin:0 0 16px 0;line-height:1.5;"><span style="display:inline-block;font-weight:bold;font-size:0.8em;text-transform:uppercase;letter-spacing:0.5px;">' +
      escapeHtml(subject) +
      '</span>';
    if (topics && topics.length) {
      out += '<br><span style="display:inline-block;font-size:0.75em;font-style:italic;opacity:0.7;margin-top:4px;">' + escapeHtml(topics.join(' › ')) + '</span>';
    }
    return out + '</div>';
  }

  /**
   * Divide o caminho completo [área, subárea, assunto, tema, subtema] no que o
   * modelo mostra: assunto (ou o nível mais profundo disponível) + temas abaixo dele.
   */
  function modelParts(pathNames) {
    const p = pathNames || [];
    if (p.length >= 3) return { subject: p[2], topics: p.slice(3) };
    if (p.length) return { subject: p[p.length - 1], topics: [] };
    return { subject: null, topics: [] };
  }

  function hierarchicalTag(pathNames) {
    const { subject, topics } = modelParts(pathNames);
    if (!subject) return '';
    return [subject].concat(topics).map(pascalTag).filter(Boolean).join('::');
  }

  function modelFront(card, pathNames) {
    const { subject, topics } = modelParts(pathNames);
    return headerHtml(subject, topics) + '<b>Pergunta:</b> ' + (card.front || '');
  }

  const modelBack = (card) => '<b>Resposta:</b><br>' + (card.back || '');

  // ── Leitura de arquivos texto (CSV/TXT do Anki ou planilhas) ───────────────
  const SEPARATORS = { semicolon: ';', comma: ',', tab: '\t', pipe: '|', space: ' ', colon: ':' };

  const COLUMN_ROLES = [
    ['front', ['frente', 'front', 'pergunta', 'question', 'q', 'texto', 'text']],
    ['back', ['verso', 'back', 'resposta', 'answer', 'a', 'extra']],
    ['tags', ['tags', 'tag', 'etiquetas']],
    ['deck', ['baralho', 'deck', 'deck name']],
    ['area', ['grande area', 'area', 'grande área', 'área']],
    ['subarea', ['subarea', 'subárea', 'especialidade']],
    ['subject', ['assunto', 'subject', 'tema geral']],
    ['topic', ['tema', 'tema especifico', 'tema específico', 'topic']],
    ['subtopic', ['subtema', 'subtopic']],
    ['source', ['fonte', 'source', 'arquivo']],
    ['page', ['pagina', 'página', 'page', 'pag']],
    ['difficulty', ['dificuldade', 'difficulty']],
    ['reference', ['referencia', 'referência', 'reference', 'referencias']],
  ];

  function roleOf(name) {
    const key = normalizeText(name);
    for (const [role, names] of COLUMN_ROLES) if (names.some((n) => normalizeText(n) === key)) return role;
    return null;
  }

  /**
   * Lê CSV/TXT (modelo Anki com cabeçalhos "#", ou planilha com linha de títulos).
   * Retorna { meta, rows: [{front, back, tags[], deck, path[], source, page, difficulty, reference, hasModelHeader}], warnings }
   */
  function parseText(text) {
    text = String(text || '').replace(/^﻿/, '');
    const meta = { html: null, separator: null, deck: null, notetype: null, columns: null, tagsColumn: null, deckColumn: null };
    const lines = text.split(/\r?\n/);
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('#')) break;
      bodyStart = i + 1;
      const m = line.match(/^#([^:]+):(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const value = m[2].trim();
      if (key === 'separator') meta.separator = SEPARATORS[value.toLowerCase()] || value;
      else if (key === 'html') meta.html = value.toLowerCase() === 'true';
      else if (key === 'deck') meta.deck = value;
      else if (key === 'notetype') meta.notetype = value;
      else if (key === 'columns') meta.columns = value;
      else if (key === 'tags column') meta.tagsColumn = parseInt(value, 10) - 1;
      else if (key === 'deck column') meta.deckColumn = parseInt(value, 10) - 1;
    }
    const body = lines.slice(bodyStart).join('\n');
    const sep = meta.separator || sniffDelimiter(body);
    meta.separator = sep;
    let rows = parseCsv(body, sep);
    const warnings = [];
    let roles = [];
    if (meta.columns) {
      roles = parseCsv(meta.columns, sep)[0].map(roleOf);
    } else if (rows.length && rows[0].some((c) => roleOf(c) === 'front') && rows[0].some((c) => roleOf(c) === 'back')) {
      roles = rows[0].map(roleOf);
      rows = rows.slice(1);
    }
    if (!roles.includes('front')) roles[0] = 'front';
    if (!roles.includes('back')) roles[1] = 'back';
    if (meta.tagsColumn != null && meta.tagsColumn >= 0) roles[meta.tagsColumn] = 'tags';
    if (meta.deckColumn != null && meta.deckColumn >= 0) roles[meta.deckColumn] = 'deck';
    const isHtml = meta.html !== false;
    const out = [];
    rows.forEach((row, idx) => {
      const get = (role) => {
        const i = roles.indexOf(role);
        return i >= 0 && row[i] != null ? row[i] : '';
      };
      let front = get('front');
      let back = get('back');
      if (!String(front).trim() && !String(back).trim()) return;
      if (!isHtml) {
        front = textToHtml(front);
        back = textToHtml(back);
      }
      const parsed = parseModelFront(front);
      const tags = String(get('tags') || '')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const explicitPath = ['area', 'subarea', 'subject', 'topic', 'subtopic'].map((r) => String(get(r) || '').trim());
      const hasExplicit = explicitPath.some(Boolean);
      out.push({
        line: idx + 1,
        front: parsed.html,
        back: parseModelBack(back),
        tags,
        deck: get('deck') || meta.deck || null,
        subject: parsed.subject,
        topics: parsed.topics,
        explicitPath: hasExplicit ? explicitPath : null,
        hasModelHeader: !!parsed.subject,
        source: get('source') || null,
        page: parseInt(get('page'), 10) || null,
        difficulty: get('difficulty') || null,
        reference: get('reference') || '',
      });
      if (!parsed.html) warnings.push('Linha ' + (idx + 1) + ': frente vazia');
    });
    return { meta, rows: out, warnings };
  }

  /** Converte "CancerGastrico" em "Cancer Gastrico" (quando não há nome melhor). */
  function humanizeTag(seg) {
    return String(seg || '')
      .replace(/([a-zà-ÿ0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim();
  }

  // Siglas comuns de grandes áreas (nomes de baralho como "Tutoria CG", "CM - Cardio")
  const AREA_ACRONYMS = [
    [/\b(cm|clinica|clínica|clinica medica|clínica médica)\b/i, 'Clínica Médica'],
    [/\b(cg|cir|cirurgia|cirurgia geral)\b/i, 'Cirurgia'],
    [/\b(ped|pedi|pediatria)\b/i, 'Pediatria'],
    [/\b(go|gineco|ginecologia|obstetricia|obstetrícia|obs\d*)\b/i, 'Ginecologia e Obstetrícia'],
    [/\b(prev|preventiva|mfc|saude coletiva|saúde coletiva|medicina preventiva)\b/i, 'Medicina Preventiva'],
  ];

  function guessArea(text) {
    const s = String(text || '');
    for (const [re, name] of AREA_ACRONYMS) if (re.test(s)) return name;
    return null;
  }

  // ── Exportação ─────────────────────────────────────────────────────────────
  const EXPORT_FIELDS = [
    { key: 'front', label: 'Frente' },
    { key: 'back', label: 'Verso' },
    { key: 'deck', label: 'Baralho' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Fonte' },
    { key: 'page', label: 'Página' },
    { key: 'difficulty', label: 'Dificuldade' },
    { key: 'area', label: 'Grande área' },
    { key: 'subarea', label: 'Subárea' },
    { key: 'subject', label: 'Assunto' },
    { key: 'topic', label: 'Tema' },
    { key: 'subtopic', label: 'Subtema' },
    { key: 'reference', label: 'Referência' },
    { key: 'favorite', label: 'Favorito' },
    { key: 'state', label: 'Estado' },
    { key: 'due', label: 'Próxima revisão' },
    { key: 'interval', label: 'Intervalo (dias)' },
    { key: 'reviews', label: 'Revisões' },
    { key: 'lapses', label: 'Esquecimentos' },
  ];
  const DIFF_TEXT = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };
  const STATE_TEXT = { new: 'Novo', learning: 'Aprendendo', review: 'Revisão' };

  function fieldValue(card, key, ctx, keepHtml) {
    const path = ctx.pathNames(card.nodeId);
    const text = (html) => (keepHtml ? html || '' : stripHtml(html));
    switch (key) {
      case 'front':
        return text(card.front);
      case 'back':
        return text(card.back);
      case 'deck':
        return ctx.deckName(card.deckId);
      case 'tags':
        return (card.tags || []).join(' ');
      case 'source':
        return card.source ? card.source.fileName || '' : '';
      case 'page':
        return card.source && card.source.page ? card.source.page : '';
      case 'difficulty':
        return DIFF_TEXT[card.estDifficulty] || '';
      case 'area':
        return path[0] || '';
      case 'subarea':
        return path[1] || '';
      case 'subject':
        return path[2] || '';
      case 'topic':
        return path[3] || '';
      case 'subtopic':
        return path[4] || '';
      case 'reference':
        return card.reference || '';
      case 'favorite':
        return card.favorite ? 'sim' : '';
      case 'state':
        return card.suspended ? 'Suspenso' : STATE_TEXT[card.state || 'new'];
      case 'due':
        return card.dueDate ? new Date(card.dueDate).toISOString().slice(0, 10) : '';
      case 'interval':
        return card.state === 'review' ? Math.round(card.scheduledDays || 0) : '';
      case 'reviews':
        return card.repetitions || 0;
      case 'lapses':
        return card.lapses || 0;
      default:
        return '';
    }
  }

  /**
   * CSV no modelo Anki (importável direto no Anki: Arquivo → Importar).
   * ctx: { pathNames(nodeId), deckName(deckId) }
   */
  function toAnkiCsv(cards, ctx) {
    const deckNames = [...new Set(cards.map((c) => ctx.deckName(c.deckId)))];
    const single = deckNames.length <= 1;
    const header = ['#separator:semicolon', '#html:true', '#notetype:Básico'];
    if (single && deckNames[0]) header.push('#deck:' + deckNames[0]);
    header.push(single ? '#columns:Frente;Verso;Tags' : '#columns:Frente;Verso;Tags;Baralho');
    header.push('#tags column:3');
    if (!single) header.push('#deck column:4');
    const rows = cards.map((card) => {
      const path = ctx.pathNames(card.nodeId);
      const hTag = hierarchicalTag(path);
      const tags = [hTag].concat((card.tags || []).filter((t) => t !== hTag)).filter(Boolean).join(' ');
      const row = [modelFront(card, path), modelBack(card), tags];
      if (!single) row.push(ctx.deckName(card.deckId));
      return row;
    });
    return header.join('\n') + '\n' + (rows.length ? toCsv(rows, ';', true) : '');
  }

  function toPlainCsv(cards, fields, ctx, keepHtml) {
    const defs = EXPORT_FIELDS.filter((f) => fields.includes(f.key));
    const rows = [defs.map((f) => f.label)].concat(cards.map((c) => defs.map((f) => fieldValue(c, f.key, ctx, keepHtml))));
    return '﻿' + toCsv(rows, ';', true);
  }

  function toTxt(cards, fields, ctx) {
    const extra = EXPORT_FIELDS.filter((f) => fields.includes(f.key) && f.key !== 'front' && f.key !== 'back');
    return (
      cards
        .map((c, i) => {
          const lines = [i + 1 + '. ' + stripHtml(c.front).replace(/\n/g, ' ')];
          lines.push('   ' + stripHtml(c.back).replace(/\n/g, '\n   '));
          for (const f of extra) {
            const v = fieldValue(c, f.key, ctx, false);
            if (v !== '' && v != null) lines.push('   ' + f.label + ': ' + v);
          }
          return lines.join('\n');
        })
        .join('\n\n') + '\n'
    );
  }

  const SCHED_FIELDS = ['state', 'dueDate', 'lastReview', 'stability', 'difficulty', 'repetitions', 'lapses', 'scheduledDays'];

  /**
   * Pacote JSON de baralho. withScheduling=true leva agendamento + histórico de revisões.
   * ctx: { pathNames, deckName, logsOf(cardId), decksOf(cards) }
   */
  function toDeckPackage(cards, ctx, withScheduling, fields) {
    const decks = new Map();
    for (const c of cards) decks.set(c.deckId, ctx.deckName(c.deckId));
    const pkg = {
      format: FORMAT_DECK,
      version: 1,
      exportedAt: new Date().toISOString(),
      includesScheduling: !!withScheduling,
      decks: [...decks.entries()].map(([id, name]) => ({ id, name })),
      cards: cards.map((c) => {
        const out = {
          id: c.id,
          front: c.front,
          back: c.back,
          deck: ctx.deckName(c.deckId),
          path: ctx.pathNames(c.nodeId),
          tags: c.tags || [],
          source: c.source || null,
          reference: c.reference || '',
          estDifficulty: c.estDifficulty || null,
          estDifficultyBy: c.estDifficultyBy || null,
          cardType: c.cardType || '',
          favorite: !!c.favorite,
          suspended: !!c.suspended,
          createdAt: c.createdAt,
        };
        if (fields && fields.length) {
          for (const key of Object.keys(out)) {
            const map = { deck: 'deck', tags: 'tags', source: 'source', estDifficulty: 'difficulty', reference: 'reference', favorite: 'favorite' };
            if (map[key] && !fields.includes(map[key])) delete out[key];
          }
        }
        if (withScheduling) {
          out.scheduling = {};
          for (const f of SCHED_FIELDS) out.scheduling[f] = c[f] == null ? null : c[f];
          out.logs = ctx.logsOf(c.id).map((l) => {
            const copy = Object.assign({}, l);
            delete copy.id;
            delete copy.cardId;
            return copy;
          });
        }
        return out;
      }),
    };
    return JSON.stringify(pkg, null, 1);
  }

  /** Valida e normaliza um pacote JSON (baralho, lista de cards simples ou backup). */
  function parseJson(text) {
    let data;
    try {
      data = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('JSON inválido: ' + e.message);
    }
    if (data && data.format === FORMAT_BACKUP) return { kind: 'backup', data };
    const list = Array.isArray(data) ? data : data && Array.isArray(data.cards) ? data.cards : null;
    if (!list) throw new Error('O arquivo não tem uma lista de cards ("cards").');
    const cards = list
      .filter((c) => c && (c.front || c.frente || c.pergunta || c.question))
      .map((c) => {
        const front = c.front || c.frente || c.pergunta || c.question || '';
        const back = c.back || c.verso || c.resposta || c.answer || '';
        const parsed = parseModelFront(front);
        let path = Array.isArray(c.path) ? c.path.filter(Boolean) : null;
        if (!path) {
          const explicit = [c.area || c.grandeArea, c.subarea, c.subject || c.assunto, c.topic || c.tema, c.subtopic || c.subtema].map((x) => (x ? String(x) : ''));
          if (explicit.some(Boolean)) path = explicit;
        }
        return {
          id: c.id || null,
          front: parsed.html,
          back: parseModelBack(back),
          deck: c.deck || c.baralho || null,
          path,
          subject: parsed.subject,
          topics: parsed.topics,
          hasModelHeader: !!parsed.subject,
          tags: Array.isArray(c.tags) ? c.tags : String(c.tags || '').split(/\s+/).filter(Boolean),
          source: c.source && typeof c.source === 'object' ? c.source : c.fonte ? { fileName: c.fonte, page: c.pagina || c.page || null } : null,
          reference: c.reference || c.referencia || '',
          estDifficulty: c.estDifficulty || c.difficulty || c.dificuldade || null,
          estDifficultyBy: c.estDifficultyBy || null,
          cardType: c.cardType || '',
          favorite: !!c.favorite,
          suspended: !!c.suspended,
          createdAt: c.createdAt || null,
          scheduling: c.scheduling || null,
          logs: Array.isArray(c.logs) ? c.logs : null,
        };
      });
    return { kind: 'deck', data, cards, includesScheduling: cards.some((c) => c.scheduling) };
  }

  return {
    FORMAT_DECK,
    FORMAT_BACKUP,
    EXPORT_FIELDS,
    parseModelFront,
    parseModelBack,
    headerHtml,
    modelParts,
    hierarchicalTag,
    modelFront,
    modelBack,
    parseText,
    humanizeTag,
    guessArea,
    fieldValue,
    toAnkiCsv,
    toPlainCsv,
    toTxt,
    toDeckPackage,
    parseJson,
    plain,
  };
});
