// Small helpers shared by the browser app and the Node unit tests. No DOM access here.

export function uid(prefix = '') {
  const c = globalThis.crypto;
  const raw = c && typeof c.randomUUID === 'function'
    ? c.randomUUID().replace(/-/g, '').slice(0, 16)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix + raw;
}

// Used to compare fill-in answers: full-width to half-width, case-insensitive,
// whitespace collapsed, trailing sentence punctuation dropped.
export function normalizeAnswerText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？;；,，]+$/u, '')
    .trim()
    .toLowerCase();
}

// Local calendar date (YYYY-MM-DD) of a timestamp.
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${dateKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function percent(ratio) {
  return ratio == null ? '—' : `${Math.round(ratio * 100)}%`;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
