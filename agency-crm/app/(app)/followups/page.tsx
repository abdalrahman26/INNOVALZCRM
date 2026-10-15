'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, ClipboardEdit, MessageCircle, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { Empty, PageLoader, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { FOLLOWUP_TYPES, findOpt, presetToDate } from '@/lib/constants';
import { fmtDateTime, fromNow, waLink } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Followup } from '@/lib/types';

export default function FollowupsPage() {
  const { profile, team, openLead } = useApp();
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const viewAll = can(profile, 'view_all');
  const [who, setWho] = useState<string>(profile.id);
  const [items, setItems] = useState<Followup[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase
      .from('followups')
      .select('*, lead:leads(id, full_name, phone, company, status)')
      .eq('done', false)
      .order('due_at', { ascending: true })
      .limit(500);
    if (who !== 'all') q = q.eq('user_id', who);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setItems((data as Followup[]) ?? []);
  }, [supabase, who]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function done(f: Followup) {
    if (busyId) return;
    setBusyId(f.id);
    setItems((prev) => prev?.filter((x) => x.id !== f.id) ?? prev); // يختفي فوراً
    const { error } = await supabase.from('followups').update({ done: true }).eq('id', f.id);
    setBusyId(null);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(tr('تمت ✅', 'Done ✅'));
  }

  async function snooze(f: Followup, key: string) {
    const d = presetToDate(key);
    if (!d || busyId) return;
    setBusyId(f.id);
    const { error } = await supabase.from('followups').update({ due_at: d.toISOString() }).eq('id', f.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(tr(`اتأجلت ${fromNow(d.toISOString())}`, `Snoozed ${fromNow(d.toISOString())}`));
    load();
  }

  if (!items) return <PageLoader />;

  const now = Date.now();
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const groups = [
    { key: 'late', title: tr('🔴 متأخرة', '🔴 Overdue'), list: items.filter((f) => new Date(f.due_at).getTime() < now) },
    { key: 'today', title: tr('🟡 النهارده', '🟡 Today'), list: items.filter((f) => { const t = new Date(f.due_at).getTime(); return t >= now && t <= endOfDay.getTime(); }) },
    { key: 'next', title: tr('🟢 الجاية', '🟢 Upcoming'), list: items.filter((f) => new Date(f.due_at).getTime() > endOfDay.getTime()) },
  ];
  const nameOf = (uid: string) => team.find((t) => t.id === uid)?.full_name ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{tr('المتابعات', 'Follow-ups')}</h1>
          <p className="text-sm text-slate-500">{tr(`${items.length} متابعة مفتوحة`, `${items.length} open follow-ups`)}</p>
        </div>
        {viewAll && (
          <select className="input w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value={profile.id}>{tr('متابعاتي أنا', 'My follow-ups')}</option>
            <option value="all">{tr('كل الفريق', 'Whole team')}</option>
            {team.filter((u) => u.is_active && u.id !== profile.id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
      </div>

      {items.length === 0 && <div className="card"><Empty text={tr('مفيش متابعات مفتوحة 🎉', 'No open follow-ups 🎉')} icon={CalendarClock} /></div>}

      {groups.filter((g) => g.list.length).map((g) => (
        <div key={g.key} className="card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold">{g.title} ({g.list.length})</div>
          <div className="divide-y divide-slate-100">
            {g.list.map((f) => {
              const wa = waLink(f.lead?.phone);
              return (
                <div key={f.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${busyId === f.id ? 'animate-pulse' : ''}`}>
                  <div className={`w-28 shrink-0 text-xs font-bold ${g.key === 'late' ? 'text-rose-600' : 'text-slate-600'}`}>
                    {fromNow(f.due_at)}
                    <div className="font-normal text-slate-400">{fmtDateTime(f.due_at)}</div>
                  </div>
                  <button onClick={() => openLead(f.lead_id, load)} className="min-w-[180px] flex-1 text-start">
                    <div className="flex items-center gap-2">
                      <span className="font-bold hover:text-indigo-600">{f.lead?.full_name}</span>
                      {f.lead && <StageBadge status={f.lead.status} />}
                    </div>
                    <div className="text-xs text-slate-500">
                      {L(findOpt(FOLLOWUP_TYPES, f.type))}{f.note ? ` · ${f.note}` : ''}{who === 'all' ? ` · ${nameOf(f.user_id)}` : ''}
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.lead?.phone && <a href={`tel:${f.lead.phone}`} className="btn-ghost btn-sm"><Phone size={14} /></a>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-emerald-600"><MessageCircle size={14} /></a>}
                    <select className="input w-auto py-1 text-xs" value="" disabled={busyId === f.id} onChange={(e) => e.target.value && snooze(f, e.target.value)}>
                      <option value="">{tr('⏱ تأجيل', '⏱ Snooze')}</option>
                      <option value="30m">{tr('30 دقيقة', '30 min')}</option>
                      <option value="1h">{tr('ساعة', '1 hour')}</option>
                      <option value="2h">{tr('ساعتين', '2 hours')}</option>
                      <option value="tomorrow">{tr('بكرة', 'Tomorrow')}</option>
                      <option value="1w">{tr('أسبوع', '1 week')}</option>
                    </select>
                    <button className="btn-success btn-sm" disabled={busyId === f.id} onClick={() => done(f)}><Check size={14} /> {tr('تمت', 'Done')}</button>
                    <button className="btn-secondary btn-sm" onClick={() => openLead(f.lead_id, load)}><ClipboardEdit size={14} /> {tr('سجّل تواصل', 'Log contact')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
