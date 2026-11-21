/* Allgemeine Hilfsfunktionen (keine Abhängigkeiten zu anderen Modulen) */

export const DAY_MS = 86400000;

export const uid = () => {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function debounce(fn, ms = 200) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

export function plural(n, one, many) {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
}

/* ---------- Datum ---------- */

export const startOfDay = (t = Date.now()) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const addDays = (t, n) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export const formatDate = (t) => dateFmt.format(t);
export const formatDateTime = (t) => dateTimeFmt.format(t);

export function relativeTime(t, now = Date.now()) {
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24 && startOfDay(t) === startOfDay(now)) return `vor ${h} Std.`;
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;
  return formatDate(t);
}

export function formatDue(ms, now = Date.now()) {
  if (ms <= now) return 'Fällig';
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return 'Heute';
  if (days === 1) return 'Morgen';
  if (days < 30) return `In ${days} Tagen`;
  if (days < 365) return `In ${Math.round(days / 30)} Mon.`;
  return `In ${(days / 365).toFixed(1).replace('.', ',')} J.`;
}

export function toDateInputValue(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- Text / HTML ---------- */

export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<img[^>]*>/gi, ' [Bild] ')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|ul|ol)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export const hasImage = (html) => /<img[\s>]/i.test(html || '');

/** Normalisiert Text für die Suche (Kleinschreibung, ohne Akzente). */
export const normalize = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI',
  'H2', 'H3', 'BLOCKQUOTE', 'CODE', 'PRE', 'SUB', 'SUP', 'IMG', 'HR',
]);
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM',
  'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'TITLE', 'HEAD', 'VIDEO', 'AUDIO', 'CANVAS',
]);
const VOID_TAGS = new Set(['BR', 'HR']);

/**
 * Bereinigt HTML mit einer Positivliste. Entfernt alle Attribute (außer
 * Bild-Quelle als data:-URL), Skripte, Styles und externe Ressourcen.
 */
export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
  const walk = (node) => {
    let out = '';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        out += esc(ch.nodeValue).replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      } else if (ch.nodeType === 1) {
        const tag = ch.tagName;
        if (DROP_TAGS.has(tag)) continue;
        if (tag === 'IMG') {
          const src = ch.getAttribute('src') || '';
          const m = /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,/i.exec(src);
          if (m && !/[^a-z0-9+/=\s]/i.test(src.slice(m[0].length))) {
            out += `<img src="${src}" alt="${esc(ch.getAttribute('alt') || '')}">`;
          }
          continue;
        }
        const inner = walk(ch);
        if (!ALLOWED_TAGS.has(tag)) {
          out += inner;
          continue;
        }
        const t = tag.toLowerCase();
        out += VOID_TAGS.has(tag) ? `<${t}>` : `<${t}>${inner}</${t}>`;
      }
    }
    return out;
  };
  return walk(doc.body)
    .replace(/(<div><br><\/div>|<p><br><\/p>|<br>)+$/i, '')
    .trim();
}

/* ---------- Dateien ---------- */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('Datei konnte nicht gelesen werden.'));
    r.readAsText(file);
  });
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

/** Verkleinert ein Bild und liefert eine data:-URL (WebP, sonst JPEG). */
export async function compressImage(file, maxSize = 1100) {
  if (!file.type.startsWith('image/')) throw new Error('Das ist keine Bilddatei.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Das Bild ist zu groß (maximal 25 MB).');
  if (file.type === 'image/gif' && file.size < 600 * 1024) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      r.readAsDataURL(file);
    });
  }
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  let url = '';
  ctx.drawImage(bitmap, 0, 0, w, h);
  url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) {
    // Browser kann kein WebP kodieren -> JPEG mit weißem Hintergrund
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    url = canvas.toDataURL('image/jpeg', 0.86);
  }
  if (bitmap.close) bitmap.close();
  return url;
}

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht geladen werden.'));
    };
    img.src = url;
  });
}

export function errorMessage(e) {
  if (!e) return 'Unbekannter Fehler.';
  if (e.name === 'QuotaExceededError') {
    return 'Der Browser-Speicher ist voll. Bitte exportiere ein Backup und lösche nicht benötigte Daten.';
  }
  return e.message || String(e);
}
