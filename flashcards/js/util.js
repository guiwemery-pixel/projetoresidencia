/*
 * Utilidades puras (sem DOM): ids, datas, texto, CSV e formatação.
 * Funciona no navegador (window.FC.util) e no Node (require) para os testes.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).util = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  let counter = 0;
  function uid(prefix) {
    counter = (counter + 1) % 1679616;
    const rand = Math.floor(Math.random() * 2176782336).toString(36).padStart(6, '0');
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + counter.toString(36).padStart(4, '0') + rand;
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n, digits = 0) => {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  };

  // ── Datas ──────────────────────────────────────────────────────────────────
  // O "dia de estudo" vira no horário de virada (padrão 4h), como no Anki:
  // quem estuda à 1h da manhã ainda está no dia anterior.
  function dayStart(ts, rolloverHour = 4) {
    const d = new Date(ts);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rolloverHour, 0, 0, 0);
    if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    return start.getTime();
  }

  function addDays(ts, days) {
    const d = new Date(ts);
    d.setDate(d.getDate() + days);
    return d.getTime();
  }

  function dayKey(ts, rolloverHour = 4) {
    const d = new Date(dayStart(ts, rolloverHour));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** Diferença em dias de estudo (inteiro) entre dois instantes. */
  function studyDaysBetween(a, b, rolloverHour = 4) {
    return Math.round((dayStart(b, rolloverHour) - dayStart(a, rolloverHour)) / DAY);
  }

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  function formatDate(ts, withYear = true) {
    if (ts == null) return '—';
    const d = new Date(ts);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }

  function formatDateTime(ts) {
    if (ts == null) return '—';
    const d = new Date(ts);
    return formatDate(ts) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0 min';
    const totalMin = Math.round(ms / MIN);
    if (totalMin < 1) return Math.max(1, Math.round(ms / 1000)) + ' s';
    if (totalMin < 60) return totalMin + ' min';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  const fmtNum = (n, digits = 0) =>
    Number(n).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const pct = (x, digits = 0) => (x == null || isNaN(x) ? '—' : fmtNum(x * 100, digits) + '%');

  function plural(n, one, many) {
    return fmtNum(n) + ' ' + (n === 1 ? one : many);
  }

  // ── Texto ──────────────────────────────────────────────────────────────────
  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function normalizeText(s) {
    return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  function decodeEntities(s) {
    return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
    });
  }

  function stripHtml(html) {
    return decodeEntities(
      String(html || '')
        .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\s*\/?>/gi, '\n')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Texto simples → HTML: quebras de linha viram <br>. */
  function textToHtml(s) {
    return escapeHtml(s).replace(/\r?\n/g, '<br>');
  }

  /** "TNM (AJCC 8ª ed.)" → "TNMAJCC8aEd" (formato das tags hierárquicas do modelo). */
  function pascalTag(name) {
    return stripAccents(String(name || '').replace(/ª/g, 'a').replace(/º/g, 'o'))
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('');
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  /** Parser RFC 4180 com separador configurável, aspas duplas e campos multilinha. */
  function parseCsv(text, delimiter = ',') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"' && field === '') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === delimiter) {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  }

  function csvField(value, delimiter = ',', quoteAll = true) {
    const s = value == null ? '' : String(value);
    if (quoteAll || s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(rows, delimiter = ',', quoteAll = true) {
    return rows.map((r) => r.map((v) => csvField(v, delimiter, quoteAll)).join(delimiter)).join('\n') + '\n';
  }

  /** Detecta o separador mais provável na primeira linha útil. */
  function sniffDelimiter(text) {
    const line = String(text).split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
    const counts = { ';': 0, '\t': 0, ',': 0, '|': 0 };
    let inQuotes = false;
    for (const c of line) {
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && counts[c] != null) counts[c]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }

  // ── Coleções ───────────────────────────────────────────────────────────────
  function groupBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  }

  function shuffle(list, rand = Math.random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  return {
    MIN,
    HOUR,
    DAY,
    uid,
    clamp,
    round,
    dayStart,
    addDays,
    dayKey,
    keyToDate,
    studyDaysBetween,
    MONTHS,
    MONTHS_LONG,
    WEEKDAYS,
    formatDate,
    formatDateTime,
    formatDuration,
    fmtNum,
    pct,
    plural,
    stripAccents,
    normalizeText,
    decodeEntities,
    stripHtml,
    escapeHtml,
    textToHtml,
    pascalTag,
    truncate,
    parseCsv,
    toCsv,
    csvField,
    sniffDelimiter,
    groupBy,
    shuffle,
    debounce,
    hashString,
  };
});
