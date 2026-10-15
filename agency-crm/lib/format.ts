import type { Lang } from './lang';

let current: Lang = 'ar';
export function setFormatLocale(l: Lang) {
  current = l;
}

const LOCALES: Record<Lang, string> = { ar: 'ar-EG-u-nu-latn', en: 'en-US' };
const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.NumberFormat>();
function get<T>(key: string, make: (loc: string) => T): T {
  const k = `${current}:${key}`;
  if (!cache.has(k)) cache.set(k, make(LOCALES[current]) as never);
  return cache.get(k) as T;
}
const dtf = () => get('dt', (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }));
const df = () => get('d', (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', year: 'numeric' }));
const rtf = () => get('rt', (l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }));

export const fmtDateTime = (s?: string | null) => (s ? dtf().format(new Date(s)) : '—');
export const fmtDate = (s?: string | null) => (s ? df().format(new Date(s)) : '—');

export function fromNow(s?: string | null) {
  if (!s) return '—';
  const diff = (new Date(s).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf().format(Math.round(diff), 'second');
  if (abs < 3600) return rtf().format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf().format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return rtf().format(Math.round(diff / 86400), 'day');
  return fmtDateTime(s);
}

export function fmtCountdown(ms: number) {
  if (ms <= 0) return '00:00';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const fmtNum = (n?: number | null) => (n == null ? '—' : new Intl.NumberFormat('en-US').format(Number(n)));

/** نفس منطق normalize_phone في الداتابيز */
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  let d = String(p)
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('01')) d = '20' + d.slice(1);
  else if (d.length === 10 && d.startsWith('1')) d = '20' + d;
  else if (d.length === 10 && d.startsWith('05')) d = '966' + d.slice(1);
  else if (d.length === 9 && d.startsWith('5')) d = '966' + d;
  return d;
}

export function waLink(p?: string | null) {
  const d = normalizePhone(p);
  return d ? `https://wa.me/${d}` : null;
}

/** datetime-local value from a Date */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
