'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, Check, ChevronLeft, FileText, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtTime, fromNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type LeadLite = {
  id: string;
  full_name: string;
  company: string | null;
  status: string;
  assigned_to: string | null;
  last_activity_at: string | null;
  assignee?: { full_name: string } | null;
};
type Meeting = { id: string; due_at: string; note: string | null; user_id: string; lead: LeadLite | null };

const LEAD_FIELDS = 'id, full_name, company, status, assigned_to, last_activity_at, assignee:profiles!leads_assigned_to_fkey(full_name)';
const DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/**
 * نافذة التنبيهات في الرئيسية:
 *  - عملاء طالبين عرض سعر (المدير يشوف الكل — السيلز يشوف بتوعه)
 *  - اجتماعات خلال 3 أيام بس (النهارده / بكره / بعد بكره)
 * وبتطلع كـ popup لما يكون فيه حاجة جديدة مشفتهاش النهارده
 */
export default function TodayAlerts({ onChanged }: { onChanged?: () => void }) {
  const { profile, team, openLead } = useApp();
  const supabase = useSupabase();
  const { tr } = useI18n();
  const manager = can(profile, 'view_all');
  const [quotes, setQuotes] = useState<LeadLite[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [popup, setPopup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const sessionSeen = useRef<Set<string>>(new Set());
  const storeKey = `crm_alerts_seen_${profile.id}`;

  const load = useCallback(async () => {
    const from = startOfDay(new Date());
    const to = new Date(from.getTime() + 3 * DAY);
    let qq = supabase.from('leads').select(LEAD_FIELDS).eq('status', 'quote_requested')
      .order('last_activity_at', { ascending: true }).limit(50);
    if (!manager) qq = qq.eq('assigned_to', profile.id);
    const [q, m] = await Promise.all([
      qq,
      supabase.from('followups').select(`id, due_at, note, user_id, lead:leads(${LEAD_FIELDS})`)
        .eq('type', 'meeting').eq('done', false)
        .gte('due_at', from.toISOString()).lt('due_at', to.toISOString())
        .order('due_at').limit(50),
    ]);
    setQuotes((q.data as unknown as LeadLite[]) ?? []);
    setMeetings((((m.data as unknown as Meeting[]) ?? [])).filter((x) => x.lead
      && x.lead.status !== 'lost'
      && (manager || x.user_id === profile.id || x.lead.assigned_to === profile.id)));
  }, [supabase, manager, profile.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  // مفاتيح العناصر الحالية — الـ popup بيطلع لو فيه حاجة مشفتهاش النهارده
  const keys = useMemo(() => [
    ...(quotes ?? []).map((q) => `q:${q.id}`),
    ...meetings.map((m) => `m:${m.id}:${m.due_at}`),
  ], [quotes, meetings]);

  const readSeen = useCallback((): Set<string> => {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as { day: string; keys: string[] } | null;
      if (raw && raw.day === todayKey()) return new Set([...raw.keys, ...sessionSeen.current]);
    } catch { /* ignore */ }
    return new Set(sessionSeen.current);
  }, [storeKey]);

  useEffect(() => {
    if (quotes === null || keys.length === 0) return;
    const seen = readSeen();
    if (keys.some((k) => !seen.has(k))) setPopup(true);
  }, [keys, quotes, readSeen]);

  function closePopup() {
    setPopup(false);
    const all = [...readSeen(), ...keys].slice(-300);
    all.forEach((k) => sessionSeen.current.add(k));
    try { localStorage.setItem(storeKey, JSON.stringify({ day: todayKey(), keys: all })); } catch { /* ignore */ }
  }

  function open(id: string) {
    if (popup) closePopup();
    openLead(id, () => { load(); onChanged?.(); });
  }

  async function markSent(l: LeadLite) {
    if (busy) return;
    setBusy(l.id);
    const { data, error } = await supabase.from('leads').update({ status: 'proposal' }).eq('id', l.id).select('id');
    setBusy(null);
    if (error) return toast.error(error.message);
    if (!data?.length) return toast.error(tr('مش عندك صلاحية تعدّل الليد ده', "You can't edit this lead"));
    toast.success(tr(`تمام — ${l.full_name} اتنقل لـ «تم إرسال عرض»`, `${l.full_name} moved to “Proposal sent”`));
    load();
    onChanged?.();
  }

  const dayLabel = (iso: string) => {
    const d = Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / DAY);
    const t = fmtTime(iso);
    if (d <= 0) return { day: tr('النهارده', 'Today'), text: tr(`النهارده الساعة ${t}`, `Today at ${t}`), tone: 'bg-rose-500' };
    if (d === 1) return { day: tr('بكره', 'Tomorrow'), text: tr(`بكره الساعة ${t}`, `Tomorrow at ${t}`), tone: 'bg-amber-500' };
    return { day: tr('بعد بكره', 'In 2 days'), text: tr(`بعد بكره الساعة ${t}`, `Day after tomorrow at ${t}`), tone: 'bg-violet-500' };
  };
  const nameOf = (id: string | null | undefined) => team.find((u) => u.id === id)?.full_name;

  if (quotes === null || (quotes.length === 0 && meetings.length === 0)) return null;

  const quoteList = (compact: boolean) => (
    <div className="divide-y divide-cyan-100/70">
      {quotes.map((l) => {
        const canMark = manager || l.assigned_to === profile.id;
        return (
          <div key={l.id} className="flex items-center gap-2 py-2.5">
            <button onClick={() => open(l.id)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-100 text-sm font-extrabold text-cyan-700">
                {l.full_name.trim().charAt(0) || '؟'}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-900">{l.full_name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {[l.company, manager ? (l.assignee?.full_name ?? tr('غير موزع', 'Unassigned')) : null, l.last_activity_at ? fromNow(l.last_activity_at) : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
            {canMark && !compact && (
              <button className="btn-secondary btn-sm shrink-0" disabled={busy === l.id} onClick={() => markSent(l)}
                title={tr('نقل المرحلة لـ «تم إرسال عرض»', 'Move to “Proposal sent”')}>
                <Check size={14} /> {tr('اتبعت العرض', 'Quote sent')}
              </button>
            )}
            <ChevronLeft size={16} className="shrink-0 text-slate-300 ltr:rotate-180" />
          </div>
        );
      })}
    </div>
  );

  const meetingList = () => (
    <div className="space-y-2">
      {meetings.map((m) => {
        const lb = dayLabel(m.due_at);
        const past = new Date(m.due_at).getTime() < Date.now();
        const owner = m.lead?.assignee?.full_name ?? nameOf(m.user_id);
        return (
          <button key={m.id} onClick={() => m.lead && open(m.lead.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-violet-100 bg-white/80 p-2.5 text-start transition hover:border-violet-300 hover:shadow-sm">
            <span className={`flex w-16 shrink-0 flex-col items-center rounded-lg py-1.5 text-white ${lb.tone}`}>
              <span className="text-[10px] font-semibold leading-none opacity-90">{lb.day}</span>
              <span className="mt-1 text-sm font-extrabold leading-none tabular-nums">{fmtTime(m.due_at)}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-900">
                {tr('اجتماع مع', 'Meeting with')} {m.lead?.full_name}
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                {[lb.text, past ? tr('عدّى ميعاده', 'time passed') : null, manager ? owner : null, m.note].filter(Boolean).join(' · ')}
              </span>
            </span>
            <ChevronLeft size={16} className="shrink-0 text-slate-300 ltr:rotate-180" />
          </button>
        );
      })}
    </div>
  );

  const quoteTitle = manager
    ? tr(`عملاء محتاجين عرض سعر (${quotes.length})`, `Clients waiting for a quote (${quotes.length})`)
    : tr(`عملائي اللي طالبين عرض سعر (${quotes.length})`, `My clients waiting for a quote (${quotes.length})`);
  const meetTitle = tr(`اجتماعات خلال 3 أيام (${meetings.length})`, `Meetings in the next 3 days (${meetings.length})`);

  return (
    <>
      <div className={`grid gap-3 ${quotes.length && meetings.length ? 'lg:grid-cols-2' : ''}`}>
        {quotes.length > 0 && (
          <div className="card overflow-hidden border-cyan-200">
            <div className="flex items-center gap-2.5 bg-gradient-to-l from-cyan-500 to-sky-600 px-4 py-3 text-white rtl:bg-gradient-to-r">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/20"><FileText size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{quoteTitle}</div>
                <div className="truncate text-xs opacity-90">{tr('ابعت العرض ودوس «اتبعت العرض»', 'Send the quote, then tap “Quote sent”')}</div>
              </div>
              <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-white" /></span>
            </div>
            <div className="max-h-72 overflow-y-auto bg-cyan-50/30 px-4">{quoteList(false)}</div>
          </div>
        )}
        {meetings.length > 0 && (
          <div className="card overflow-hidden border-violet-200">
            <div className="flex items-center gap-2.5 bg-gradient-to-l from-violet-500 to-indigo-600 px-4 py-3 text-white rtl:bg-gradient-to-r">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/20"><CalendarCheck size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{meetTitle}</div>
                <div className="truncate text-xs opacity-90">{tr('النهارده وبكره وبعد بكره', 'Today, tomorrow and the day after')}</div>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto bg-violet-50/30 p-3">{meetingList()}</div>
          </div>
        )}
      </div>

      {popup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={closePopup}>
          <div className="card w-full max-w-lg overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500 px-5 pb-5 pt-6 text-white">
              <button onClick={closePopup} className="absolute end-3 top-3 rounded-lg p-1.5 hover:bg-white/20" aria-label={tr('إغلاق', 'Close')}><X size={18} /></button>
              <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/20"><Sparkles size={24} /></span>
              <h3 className="text-xl font-extrabold">{tr('خد بالك من دول 👀', 'Heads up 👀')}</h3>
              <p className="mt-1 text-sm opacity-90">
                {[
                  quotes.length ? tr(`${quotes.length} عميل طالب عرض سعر`, `${quotes.length} client(s) requested a quote`) : null,
                  meetings.length ? tr(`${meetings.length} اجتماع خلال 3 أيام`, `${meetings.length} meeting(s) in the next 3 days`) : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
              {meetings.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-violet-700"><CalendarCheck size={16} /> {meetTitle}</div>
                  {meetingList()}
                </div>
              )}
              {quotes.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-cyan-700"><FileText size={16} /> {quoteTitle}</div>
                  {quoteList(true)}
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 p-3">
              <button className="btn-primary w-full" onClick={closePopup}>{tr('تمام، شفتهم', 'Got it')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
