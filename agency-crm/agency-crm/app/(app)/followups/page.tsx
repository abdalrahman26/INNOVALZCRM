'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Clock, MessageCircle, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { Empty, PageLoader, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { followupTypeLabel, presetToDate } from '@/lib/constants';
import { fmtDateTime, fromNow, waLink } from '@/lib/format';
import type { Followup } from '@/lib/types';

export default function FollowupsPage() {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const viewAll = can(profile, 'view_all');
  const [who, setWho] = useState<string>(profile.id);
  const [items, setItems] = useState<Followup[] | null>(null);

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
    const { error } = await supabase.from('followups').update({ done: true }).eq('id', f.id);
    if (error) return toast.error(error.message);
    toast.success('تمت ✅');
    load();
  }

  async function snooze(f: Followup, key: string) {
    const d = presetToDate(key);
    if (!d) return;
    const { error } = await supabase.from('followups').update({ due_at: d.toISOString() }).eq('id', f.id);
    if (error) return toast.error(error.message);
    toast.success(`اتأجلت ${fromNow(d.toISOString())}`);
    load();
  }

  if (!items) return <PageLoader />;

  const now = Date.now();
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const groups = [
    { key: 'late', title: '🔴 متأخرة', list: items.filter((f) => new Date(f.due_at).getTime() < now) },
    { key: 'today', title: '🟡 النهارده', list: items.filter((f) => { const t = new Date(f.due_at).getTime(); return t >= now && t <= endOfDay.getTime(); }) },
    { key: 'next', title: '🟢 الجاية', list: items.filter((f) => new Date(f.due_at).getTime() > endOfDay.getTime()) },
  ];
  const nameOf = (uid: string) => team.find((t) => t.id === uid)?.full_name ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">المتابعات</h1>
          <p className="text-sm text-slate-500">{items.length} متابعة مفتوحة</p>
        </div>
        {viewAll && (
          <select className="input w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value={profile.id}>متابعاتي أنا</option>
            <option value="all">كل الفريق</option>
            {team.filter((u) => u.is_active && u.id !== profile.id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
      </div>

      {items.length === 0 && <div className="card"><Empty text="مفيش متابعات مفتوحة 🎉" icon={CalendarClock} /></div>}

      {groups.filter((g) => g.list.length).map((g) => (
        <div key={g.key} className="card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold">{g.title} ({g.list.length})</div>
          <div className="divide-y divide-slate-100">
            {g.list.map((f) => {
              const wa = waLink(f.lead?.phone);
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className={`w-28 shrink-0 text-xs font-bold ${g.key === 'late' ? 'text-rose-600' : 'text-slate-600'}`}>
                    {fromNow(f.due_at)}
                    <div className="font-normal text-slate-400">{fmtDateTime(f.due_at)}</div>
                  </div>
                  <Link href={`/leads/${f.lead_id}`} className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold hover:text-indigo-600">{f.lead?.full_name}</span>
                      {f.lead && <StageBadge status={f.lead.status} />}
                    </div>
                    <div className="text-xs text-slate-500">
                      {followupTypeLabel(f.type)}{f.note ? ` · ${f.note}` : ''}{who === 'all' ? ` · ${nameOf(f.user_id)}` : ''}
                    </div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.lead?.phone && <a href={`tel:${f.lead.phone}`} className="btn-ghost btn-sm"><Phone size={14} /></a>}
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm text-emerald-600"><MessageCircle size={14} /></a>}
                    <select className="input w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && snooze(f, e.target.value)}>
                      <option value="">⏱ تأجيل</option>
                      <option value="30m">30 دقيقة</option>
                      <option value="1h">ساعة</option>
                      <option value="2h">ساعتين</option>
                      <option value="tomorrow">بكرة</option>
                      <option value="1w">أسبوع</option>
                    </select>
                    <button className="btn-success btn-sm" onClick={() => done(f)}><Check size={14} /> تمت</button>
                    <Link href={`/leads/${f.lead_id}`} className="btn-secondary btn-sm"><Clock size={14} /> سجّل تواصل</Link>
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
