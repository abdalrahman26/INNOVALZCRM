import type { Lead, Profile } from './types';
import { SERVICES, SOURCES, LOST_REASONS, findOpt, stageOf } from './constants';
import { fmtDateTime } from './format';
import type { Lang } from './lang';

export const LEAD_SELECT = '*, assignee:profiles!leads_assigned_to_fkey(id, full_name)';

export interface LeadFilters {
  q: string;
  status: string;
  source: string;
  service: string;
  assigned: string; // '' | 'none' | 'me' | userId
  followup: string; // '' | 'overdue' | 'today' | 'none'
  sort: string;
  ids?: string[]; // ليدز محددة (مثلاً من إشعار تحويل)
}

export const EMPTY_FILTERS: LeadFilters = {
  q: '', status: '', source: '', service: '', assigned: '', followup: '', sort: 'created_at',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildLeadsQuery(supabase: any, f: LeadFilters, meId: string, withCount = false) {
  let q = supabase.from('leads').select(LEAD_SELECT, withCount ? { count: 'exact' } : undefined);
  const s = f.q.replace(/[%,()*]/g, ' ').trim();
  if (s) {
    q = q.or(
      `full_name.ilike.%${s}%,phone.ilike.%${s}%,phone_normalized.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%,campaign.ilike.%${s}%`,
    );
  }
  if (f.ids?.length) q = q.in('id', f.ids);
  if (f.status) q = q.eq('status', f.status);
  if (f.source) q = q.eq('source', f.source);
  if (f.service) q = q.eq('service', f.service);
  if (f.assigned === 'none') q = q.is('assigned_to', null);
  else if (f.assigned === 'me') q = q.eq('assigned_to', meId);
  else if (f.assigned) q = q.eq('assigned_to', f.assigned);

  const now = new Date();
  if (f.followup === 'overdue') q = q.lt('next_followup_at', now.toISOString());
  else if (f.followup === 'today') {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    q = q.gte('next_followup_at', now.toISOString()).lte('next_followup_at', end.toISOString());
  } else if (f.followup === 'none') q = q.is('next_followup_at', null);

  const [col, asc] = SORTS[f.sort] ?? SORTS.created_at;
  q = q.order(col, { ascending: asc, nullsFirst: false });
  return col === 'created_at' ? q : q.order('created_at', { ascending: false });
}

/** ترتيب الليدز: [العمود, تصاعدي؟] */
export const SORTS: Record<string, [string, boolean]> = {
  created_at: ['created_at', false], // الأحدث الأول
  created_asc: ['created_at', true], // الأقدم الأول
  name_asc: ['full_name', true], // أبجدي أ ← ي
  name_desc: ['full_name', false], // أبجدي ي ← أ
  next_followup_at: ['next_followup_at', true], // أقرب متابعة
  last_activity_at: ['last_activity_at', false], // آخر نشاط
  assigned_at: ['assigned_at', false], // آخر ما اتوزع
};

export const SORT_OPTIONS = [
  { value: 'created_at', ar: 'الأحدث الأول', en: 'Newest first' },
  { value: 'created_asc', ar: 'الأقدم الأول', en: 'Oldest first' },
  { value: 'name_asc', ar: 'الاسم (أ ← ي)', en: 'Name (A → Z)' },
  { value: 'name_desc', ar: 'الاسم (ي ← أ)', en: 'Name (Z → A)' },
  { value: 'next_followup_at', ar: 'أقرب متابعة', en: 'Next follow-up' },
  { value: 'last_activity_at', ar: 'آخر نشاط', en: 'Last activity' },
  { value: 'assigned_at', ar: 'آخر ما اتوزع', en: 'Recently assigned' },
];

export async function exportLeadsXlsx(rows: Lead[], team: Profile[], lang: Lang = 'ar', fileName?: string) {
  const XLSX = await import('xlsx');
  const en = lang === 'en';
  const pick = (o: { ar: string; en: string }) => (en ? o.en : o.ar);
  const H = (ar: string, e: string) => (en ? e : ar);
  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.full_name ?? '';
  const data = rows.map((r) => ({
    [H('الاسم', 'Name')]: r.full_name,
    [H('الموبايل', 'Phone')]: r.phone ?? '',
    [H('الإيميل', 'Email')]: r.email ?? '',
    [H('الشركة / البراند', 'Company / Brand')]: r.company ?? '',
    [H('المسمى الوظيفي', 'Job title')]: r.job_title ?? '',
    [H('الخدمة', 'Service')]: r.service ? pick(findOpt(SERVICES, r.service)) : '',
    [H('المصدر', 'Source')]: r.source ? pick(findOpt(SOURCES, r.source)) : '',
    [H('الحملة', 'Campaign')]: r.campaign ?? '',
    [H('الميزانية', 'Budget')]: r.budget ?? '',
    [H('المدينة', 'City')]: r.city ?? '',
    [H('المرحلة', 'Stage')]: pick(stageOf(r.status)),
    [H('قيمة الصفقة', 'Deal value')]: r.deal_value ?? '',
    [H('سبب الخسارة', 'Lost reason')]: r.lost_reason ? pick(findOpt(LOST_REASONS, r.lost_reason)) : '',
    [H('المسؤول', 'Owner')]: r.assignee?.full_name ?? nameOf(r.assigned_to),
    [H('تاريخ الإضافة', 'Created')]: fmtDateTime(r.created_at),
    [H('تاريخ التوزيع', 'Assigned')]: fmtDateTime(r.assigned_at),
    [H('أول تواصل', 'First contact')]: fmtDateTime(r.first_contact_at),
    [H('آخر نشاط', 'Last activity')]: fmtDateTime(r.last_activity_at),
    [H('المتابعة القادمة', 'Next follow-up')]: fmtDateTime(r.next_followup_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: !en }] };
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, fileName ?? `leads-${stamp}.xlsx`);
}
