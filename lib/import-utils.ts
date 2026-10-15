import { STAGES } from './constants';
import type { Profile } from './types';

// أدوات قراءة الشيت في صفحة الاستيراد

export const FIELDS = [
  { key: 'full_name', ar: 'الاسم', en: 'Name', guesses: ['full_name', 'full name', 'name', 'الاسم', 'اسم', 'الاسم بالكامل', 'client', 'customer', 'اسم العميل', 'العميل'] },
  { key: 'phone', ar: 'الموبايل', en: 'Phone', guesses: ['phone_number', 'phone', 'mobile', 'phone number', 'رقم', 'رقم الموبايل', 'موبايل', 'الموبايل', 'الهاتف', 'رقم الهاتف', 'تليفون', 'whatsapp', 'واتساب', 'رقم الجوال', 'جوال'] },
  { key: 'email', ar: 'الإيميل', en: 'Email', guesses: ['email', 'e-mail', 'mail', 'الإيميل', 'الايميل', 'البريد'] },
  { key: 'company', ar: 'الشركة / البراند', en: 'Company / Brand', guesses: ['company', 'company_name', 'business', 'brand', 'الشركة', 'اسم الشركة', 'البراند', 'النشاط'] },
  { key: 'job_title', ar: 'المسمى الوظيفي', en: 'Job title', guesses: ['job_title', 'job title', 'title', 'position', 'الوظيفة', 'المسمى'] },
  { key: 'service', ar: 'الخدمة', en: 'Service', guesses: ['service', 'services', 'الخدمة', 'خدمة', 'interest', 'الخدمة المطلوبة'] },
  { key: 'source', ar: 'المصدر', en: 'Source', guesses: ['source', 'platform', 'المصدر', 'مصدر', 'المنصة'] },
  { key: 'campaign', ar: 'الحملة', en: 'Campaign', guesses: ['campaign_name', 'campaign', 'ad_name', 'adset_name', 'الحملة', 'اسم الحملة', 'form_name'] },
  { key: 'budget', ar: 'الميزانية', en: 'Budget', guesses: ['budget', 'الميزانية', 'ميزانية'] },
  { key: 'city', ar: 'المدينة', en: 'City', guesses: ['city', 'المدينة', 'مدينة', 'country', 'الدولة', 'المحافظة'] },
  // جديد
  { key: 'comment', ar: '💬 تعليق / ملاحظة', en: '💬 Comment / note', guesses: ['comment', 'comments', 'note', 'notes', 'remarks', 'ملاحظة', 'ملاحظات', 'تعليق', 'تعليقات', 'كومنت', 'الكومنت'] },
  { key: 'owner', ar: '👤 السيلز المسؤول', en: '👤 Sales owner', guesses: ['sales', 'sales name', 'salesman', 'sales rep', 'sales person', 'salesperson', 'owner', 'lead owner', 'assigned to', 'assigned', 'agent', 'rep', 'السيلز', 'سيلز', 'اسم السيلز', 'المسؤول', 'مسؤول', 'الموظف', 'الموظف المسؤول', 'المندوب', 'اسم المندوب', 'مسؤول المبيعات', 'البائع'] },
  { key: 'status', ar: '📊 الحالة / المرحلة', en: '📊 Status / stage', guesses: ['status', 'stage', 'lead status', 'lead_status', 'الحالة', 'المرحلة', 'حالة العميل', 'الموقف'] },
  { key: 'followup_date', ar: '⏰ ميعاد المتابعة', en: '⏰ Follow-up date', guesses: ['follow up date', 'followup date', 'follow-up date', 'next follow up', 'follow up', 'موعد المتابعة', 'ميعاد المتابعة', 'تاريخ المتابعة', 'المتابعة'] },
  { key: 'created_date', ar: '📅 تاريخ الليد', en: '📅 Lead date', guesses: ['created_time', 'created time', 'created at', 'created', 'date', 'التاريخ', 'تاريخ الإضافة', 'تاريخ الاضافة', 'تاريخ'] },
] as const;

export type FieldKey = (typeof FIELDS)[number]['key'];
export const BASIC_KEYS = ['full_name', 'phone', 'email', 'company', 'job_title', 'service', 'source', 'campaign', 'budget', 'city'] as const;

export function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).trim();
}

/** توحيد النص العربي/الإنجليزي للمقارنة */
export function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
    .trim();
}

export function guessMap(headers: string[]): Record<FieldKey, string> {
  const used = new Set<string>();
  const map = {} as Record<FieldKey, string>;
  const n = (s: string) => norm(s.replace(/[_\-]+/g, ' '));
  // التطابق الكامل الأول لكل الحقول، بعدين التطابق الجزئي
  for (const f of FIELDS) {
    const g = f.guesses.map(n);
    const hit = headers.find((h) => !used.has(h) && g.includes(n(h)));
    map[f.key] = hit ?? '';
    if (hit) used.add(hit);
  }
  // التطابق الجزئي: أعمدة السيلز والتعليق والحالة والتواريخ الأول، عشان عمود "Sales Name" ميتاخدش كاسم العميل
  const PRIORITY = ['owner', 'comment', 'status', 'followup_date', 'created_date'];
  const GENERIC = new Set(['name', 'date', 'title', 'mail', 'رقم', 'اسم', 'تاريخ']);
  const ordered = [...FIELDS].sort((a, b) => (PRIORITY.includes(b.key) ? 1 : 0) - (PRIORITY.includes(a.key) ? 1 : 0));
  for (const f of ordered) {
    if (map[f.key]) continue;
    const g = f.guesses.map(n).filter((x) => x.length > 3 && !GENERIC.has(x));
    const hit = headers.find((h) => !used.has(h) && g.some((x) => n(h).includes(x)));
    map[f.key] = hit ?? '';
    if (hit) used.add(hit);
  }
  return map;
}

export const STATUS_WORDS: [string, string[]][] = [
  ['new', ['جديد', 'new', 'fresh']],
  ['no_answer', ['لم يرد', 'مردش', 'مبيردش', 'لا يرد', 'مش بيرد', 'no answer', 'not answered', 'no response', 'مغلق', 'مقفول']],
  ['won', ['تم التعاقد', 'تعاقد', 'won', 'closed won', 'deal', 'اشترك', 'دفع', 'مشترك']],
  ['lost', ['خسارة', 'lost', 'مش مهتم', 'غير مهتم', 'not interested', 'رفض', 'ملغي', 'cancel']],
  ['negotiation', ['تفاوض', 'negotiation', 'negotiating']],
  ['proposal', ['عرض سعر', 'تم إرسال عرض', 'proposal', 'quotation', 'quote', 'عرض']],
  ['meeting', ['اجتماع', 'meeting', 'ميتنج', 'ميتينج', 'زيارة']],
  ['interested', ['مهتم', 'interested', 'hot', 'warm']],
  ['contacted', ['تم التواصل', 'contacted', 'follow up', 'followup', 'فولو', 'متابعه', 'متابعة', 'اتكلم', 'كلمته', 'تواصل', 'called']],
];

export function parseStatus(raw: string): string | null {
  const s = norm(raw.replace(/[✅]/g, ''));
  if (!s) return null;
  for (const st of STAGES) {
    if ([st.value, st.ar, st.en].some((x) => norm(x.replace(/[✅]/g, '')) === s)) return st.value;
  }
  for (const [value, words] of STATUS_WORDS) {
    if (words.some((w) => s.includes(norm(w)))) return value;
  }
  return null;
}

/** بيفهم: تاريخ Excel، ISO، و dd/mm/yyyy (مع وقت اختياري) */
export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim()
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?)?$/i);
  if (m) {
    const [, d, mo, y, hh, mm, ss, ap] = m;
    let h = hh ? Number(hh) : 12;
    const pm = ap && /pm|م/i.test(ap);
    const am = ap && /am|ص/i.test(ap);
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(year, Number(mo) - 1, Number(d), h, mm ? Number(mm) : 0, ss ? Number(ss) : 0);
    return isNaN(dt.getTime()) || dt.getMonth() !== Number(mo) - 1 ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

export function makeOwnerMatcher(users: Profile[]) {
  const byKey = new Map<string, string>();
  const firstNames = new Map<string, string[]>();
  for (const u of users.filter((x) => x.is_active)) {
    byKey.set(norm(u.full_name), u.id);
    if (u.email) {
      byKey.set(norm(u.email), u.id);
      byKey.set(norm(u.email.split('@')[0]), u.id);
    }
    const first = norm(u.full_name).split(' ')[0];
    if (first) firstNames.set(first, [...(firstNames.get(first) ?? []), u.id]);
  }
  return (raw: string): string | null => {
    const k = norm(raw);
    if (!k) return null;
    if (byKey.has(k)) return byKey.get(k)!;
    const f = firstNames.get(k);
    return f && f.length === 1 ? f[0] : null;
  };
}

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

export const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

