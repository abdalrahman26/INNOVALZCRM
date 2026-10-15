import type { Lead, Profile } from './types';
import { stageOf } from './constants';
import { fmtDateTime } from './format';

export const LEAD_SELECT = '*, assignee:profiles!leads_assigned_to_fkey(id, full_name)';

export interface LeadFilters {
  q: string;
  status: string;
  source: string;
  service: string;
  assigned: string; // '' | 'none' | 'me' | userId
  followup: string; // '' | 'overdue' | 'today' | 'none'
  sort: string;
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

  const sort = f.sort || 'created_at';
  return q.order(sort, { ascending: sort === 'next_followup_at', nullsFirst: false });
}

export async function exportLeadsXlsx(rows: Lead[], team: Profile[], fileName?: string) {
  const XLSX = await import('xlsx');
  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.full_name ?? '';
  const data = rows.map((r) => ({
    'الاسم': r.full_name,
    'الموبايل': r.phone ?? '',
    'الإيميل': r.email ?? '',
    'الشركة / البراند': r.company ?? '',
    'المسمى الوظيفي': r.job_title ?? '',
    'الخدمة': r.service ?? '',
    'المصدر': r.source ?? '',
    'الحملة': r.campaign ?? '',
    'الميزانية': r.budget ?? '',
    'المدينة': r.city ?? '',
    'المرحلة': stageOf(r.status).label,
    'قيمة الصفقة': r.deal_value ?? '',
    'سبب الخسارة': r.lost_reason ?? '',
    'المسؤول': r.assignee?.full_name ?? nameOf(r.assigned_to),
    'تاريخ الإضافة': fmtDateTime(r.created_at),
    'تاريخ التوزيع': fmtDateTime(r.assigned_at),
    'أول تواصل': fmtDateTime(r.first_contact_at),
    'آخر نشاط': fmtDateTime(r.last_activity_at),
    'المتابعة القادمة': fmtDateTime(r.next_followup_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, fileName ?? `leads-${stamp}.xlsx`);
}
