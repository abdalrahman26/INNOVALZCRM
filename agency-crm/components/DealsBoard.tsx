'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, FileText, Handshake, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from './AppContext';
import { Spinner } from './ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtDate, fmtDateTime, fmtNum, fromNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type Row = {
  id: string;
  full_name: string;
  company: string | null;
  status: string;
  deal_value: number | null;
  next_followup_at: string | null;
  last_activity_at: string | null;
  won_at: string | null;
  assigned_to: string | null;
  assignee?: { full_name: string } | null;
};
type Item = Row & { when: string | null };

type Section = {
  key: 'meeting' | 'proposal' | 'negotiation' | 'won';
  ar: string;
  en: string;
  icon: LucideIcon;
  tone: string;
};

const SECTIONS: Section[] = [
  { key: 'meeting', ar: 'اجتماعات مجدولة', en: 'Scheduled meetings', icon: CalendarCheck, tone: 'bg-violet-50 text-violet-600' },
  { key: 'proposal', ar: 'عروض سعر منتظرة', en: 'Proposals awaiting reply', icon: FileText, tone: 'bg-fuchsia-50 text-fuchsia-600' },
  { key: 'negotiation', ar: 'صفقات جارية', en: 'Deals in progress', icon: Handshake, tone: 'bg-orange-50 text-orange-600' },
  { key: 'won', ar: 'صفقات مبرمة', en: 'Closed deals', icon: Trophy, tone: 'bg-emerald-50 text-emerald-600' },
];

const FIELDS = 'id, full_name, company, status, deal_value, next_followup_at, last_activity_at, won_at, assigned_to, assignee:profiles!leads_assigned_to_fkey(full_name)';
const SHOW = 6;

/** لوحة الصفقات في الرئيسية — بتتملى من المرحلة اللي السيلز بيحددها لكل عميل */
export default function DealsBoard({ onChanged }: { onChanged?: () => void }) {
  const { profile, openLead } = useApp();
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const isManager = can(profile, 'view_all');
  const [scope, setScope] = useState<'all' | 'me'>(isManager ? 'all' : 'me');
  const [data, setData] = useState<Record<string, Item[]> | null>(null);

  const load = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const mine = <T,>(q: T) => (scope === 'me' ? (q as unknown as { eq: (c: string, v: string) => T }).eq('assigned_to', profile.id) : q);

    const [open, won, meetings] = await Promise.all([
      mine(supabase.from('leads').select(FIELDS).in('status', ['meeting', 'proposal', 'negotiation']).limit(500)),
      mine(supabase.from('leads').select(FIELDS).eq('status', 'won').gte('won_at', monthStart).order('won_at', { ascending: false }).limit(200)),
      // أي متابعة نوعها "اجتماع" مفتوحة = اجتماع مجدول، حتى لو مرحلة الليد مختلفة
      supabase.from('followups').select(`due_at, user_id, lead:leads(${FIELDS})`).eq('type', 'meeting').eq('done', false)
        .order('due_at').limit(200),
    ]);

    const rows = ((open.data as unknown as Row[]) ?? []);
    const byKey: Record<string, Item[]> = { meeting: [], proposal: [], negotiation: [], won: [] };

    // الاجتماعات: من متابعات الاجتماع + الليدز اللي مرحلتها "اجتماع محدد"
    const seen = new Set<string>();
    for (const f of ((meetings.data as unknown as { due_at: string; user_id: string; lead: Row | null }[]) ?? [])) {
      if (!f.lead || seen.has(f.lead.id)) continue;
      if (scope === 'me' && f.lead.assigned_to !== profile.id && f.user_id !== profile.id) continue;
      if (f.lead.status === 'won' || f.lead.status === 'lost') continue;
      seen.add(f.lead.id);
      byKey.meeting.push({ ...f.lead, when: f.due_at });
    }
    for (const r of rows.filter((x) => x.status === 'meeting' && !seen.has(x.id))) {
      byKey.meeting.push({ ...r, when: r.next_followup_at });
    }
    byKey.meeting.sort((a, b) => (a.when ?? '9999').localeCompare(b.when ?? '9999'));

    // عروض السعر: الأقدم انتظاراً الأول
    byKey.proposal = rows.filter((x) => x.status === 'proposal')
      .map((r) => ({ ...r, when: r.last_activity_at }))
      .sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));

    // الصفقات الجارية: الأعلى قيمة الأول
    byKey.negotiation = rows.filter((x) => x.status === 'negotiation')
      .map((r) => ({ ...r, when: r.next_followup_at }))
      .sort((a, b) => Number(b.deal_value ?? 0) - Number(a.deal_value ?? 0));

    byKey.won = ((won.data as unknown as Row[]) ?? []).map((r) => ({ ...r, when: r.won_at }));
    setData(byKey);
  }, [supabase, scope, profile.id]);

  useEffect(() => { load(); }, [load]);

  // بعد أي تعديل من النافذة: تحديث اللوحة + باقي الرئيسية
  const refresh = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    if (data) for (const k of Object.keys(data)) t[k] = data[k].reduce((a, r) => a + Number(r.deal_value ?? 0), 0);
    return t;
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{isManager && scope === 'all' ? tr('صفقات الفريق', 'Team deals') : tr('صفقاتي', 'My deals')}</h2>
        {isManager && (
          <div className="flex gap-1.5">
            <button className={scope === 'all' ? 'chip-on' : 'chip-off'} onClick={() => setScope('all')}>{tr('كل الفريق', 'Whole team')}</button>
            <button className={scope === 'me' ? 'chip-on' : 'chip-off'} onClick={() => setScope('me')}>{tr('أنا', 'Me')}</button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((sec) => {
          const items = data?.[sec.key] ?? [];
          const now = Date.now();
          return (
            <div key={sec.key} className="card flex min-w-0 flex-col p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${sec.tone}`}><sec.icon size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{L(sec)}</div>
                  {(sec.key === 'won' || (sec.key !== 'meeting' && totals[sec.key] > 0)) && (
                    <div className="truncate text-xs text-slate-500 tabular-nums">
                      {sec.key === 'won' && tr('الشهر ده', 'This month')}
                      {sec.key === 'won' && totals[sec.key] > 0 && ' · '}
                      {totals[sec.key] > 0 && `${tr('الإجمالي', 'Total')} ${fmtNum(totals[sec.key])}`}
                    </div>
                  )}
                </div>
                <span className="text-2xl font-extrabold tabular-nums">{data ? fmtNum(items.length) : '—'}</span>
              </div>

              {!data ? (
                <div className="py-6"><Spinner className="mx-auto" /></div>
              ) : items.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  {sec.key === 'meeting' ? tr('مفيش اجتماعات — اختار مرحلة «اجتماع محدد» وحدد الميعاد', 'No meetings — choose the “Meeting set” stage and pick a time')
                    : sec.key === 'proposal' ? tr('مفيش عروض منتظرة', 'No proposals waiting')
                      : sec.key === 'negotiation' ? tr('مفيش صفقات جارية', 'No deals in progress')
                        : tr('لسه مفيش تعاقدات الشهر ده', 'No closed deals this month yet')}
                </p>
              ) : (
                <div className="-mx-2 flex-1 divide-y divide-slate-100">
                  {items.slice(0, SHOW).map((r) => {
                    const late = sec.key === 'meeting' && r.when && new Date(r.when).getTime() < now;
                    return (
                      <button key={r.id} onClick={() => openLead(r.id, refresh)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{r.full_name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {[r.company, isManager && scope === 'all' ? r.assignee?.full_name : null].filter(Boolean).join(' · ') || ' '}
                          </div>
                        </div>
                        <div className="shrink-0 text-end text-xs">
                          {sec.key === 'meeting' && (
                            <span className={late ? 'font-bold text-rose-600' : 'font-semibold text-violet-700'}>
                              {r.when ? fmtDateTime(r.when) : tr('من غير ميعاد', 'No time set')}
                            </span>
                          )}
                          {sec.key === 'proposal' && (
                            <>
                              {r.deal_value != null && <div className="font-bold tabular-nums">{fmtNum(r.deal_value)}</div>}
                              <div className="text-slate-500">{tr('منتظر', 'Waiting')} {fromNow(r.when)}</div>
                            </>
                          )}
                          {sec.key === 'negotiation' && (
                            <>
                              <div className="font-bold tabular-nums">{r.deal_value != null ? fmtNum(r.deal_value) : '—'}</div>
                              {r.when && <div className="text-slate-500">{fromNow(r.when)}</div>}
                            </>
                          )}
                          {sec.key === 'won' && (
                            <>
                              <div className="font-bold tabular-nums text-emerald-600">{r.deal_value != null ? fmtNum(r.deal_value) : '✓'}</div>
                              <div className="text-slate-500">{fmtDate(r.when)}</div>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {items.length > SHOW && (
                <Link href={`/leads?status=${sec.key}`} className="mt-2 text-center text-xs font-semibold text-indigo-600">
                  {tr(`عرض الكل (${items.length})`, `View all (${items.length})`)}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
