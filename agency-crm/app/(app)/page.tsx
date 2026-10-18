'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, CalendarClock, Inbox, Sparkles, Trophy, Users } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import DistributionCountdown from '@/components/DistributionCountdown';
import DealsBoard from '@/components/DealsBoard';
import { Empty, PageLoader, StageBadge, StatCard } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { FOLLOWUP_TYPES, STAGES, findOpt } from '@/lib/constants';
import { fmtDateTime, fmtNum, fromNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Followup } from '@/lib/types';

type Stats = { total: number; fresh: number; today: number; overdue: number; todayF: number; won: number; wonValue: number; pool: number };
type BoardRow = { user_id: string; full_name: string; assigned: number; contacted: number; won: number; won_value: number };

export default function Dashboard() {
  const { profile, openLead } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const { tr, L } = useI18n();
  const manager = can(profile, 'view_all');
  const [stats, setStats] = useState<Stats | null>(null);
  const [fus, setFus] = useState<Followup[]>([]);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [board, setBoard] = useState<BoardRow[]>([]);

  const load = useCallback(async () => {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const head = { count: 'exact' as const, head: true };

    const [total, fresh, today, overdue, todayF, wonRows, stageRows, pool, list] = await Promise.all([
      supabase.from('leads').select('id', head),
      supabase.from('leads').select('id', head).eq('status', 'new'),
      supabase.from('leads').select('id', head).gte('assigned_at', dayStart.toISOString()),
      supabase.from('followups').select('id', head).eq('user_id', profile.id).eq('done', false).lt('due_at', now.toISOString()),
      supabase.from('followups').select('id', head).eq('user_id', profile.id).eq('done', false)
        .gte('due_at', now.toISOString()).lt('due_at', dayEnd.toISOString()),
      supabase.from('leads').select('deal_value').eq('status', 'won').gte('won_at', monthStart.toISOString()),
      supabase.rpc('stage_counts'),
      supabase.rpc('pool_count'),
      supabase.from('followups').select('*, lead:leads(id, full_name, phone, company, status)')
        .eq('user_id', profile.id).eq('done', false).order('due_at').limit(8),
    ]);

    const wonList = (wonRows.data as { deal_value: number | null }[]) ?? [];
    setStats({
      total: total.count ?? 0,
      fresh: fresh.count ?? 0,
      today: today.count ?? 0,
      overdue: overdue.count ?? 0,
      todayF: todayF.count ?? 0,
      won: wonList.length,
      wonValue: wonList.reduce((a, r) => a + Number(r.deal_value ?? 0), 0),
      pool: typeof pool.data === 'number' ? pool.data : 0,
    });
    const st: Record<string, number> = {};
    ((stageRows.data as { status: string; total: number }[]) ?? []).forEach((r) => { st[r.status] = Number(r.total); });
    setStages(st);
    setFus((list.data as Followup[]) ?? []);

    if (can(profile, 'reports')) {
      const { data } = await supabase.rpc('sales_report', { p_from: monthStart.toISOString(), p_to: dayEnd.toISOString() });
      setBoard(((data as BoardRow[]) ?? []).filter((r) => Number(r.assigned) > 0).slice(0, 6));
    }
  }, [supabase, profile]);

  useEffect(() => { load(); }, [load]);

  if (!stats) return <PageLoader />;
  const stageTotal = Object.values(stages).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{tr('أهلاً', 'Hi')} {profile.full_name.split(' ')[0]} 👋</h1>
        <p className="text-sm text-slate-500">
          {manager ? tr('نظرة عامة على مبيعات الفريق', 'Team sales overview') : tr('ده ملخص شغلك النهارده', "Here's your day at a glance")}
        </p>
      </div>

      <DistributionCountdown big />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={manager ? tr('كل الليدز', 'All leads') : tr('ليدزي', 'My leads')} value={fmtNum(stats.total)} icon={Users} onClick={() => router.push('/leads')} />
        <StatCard label={tr('جديدة لم يتم التواصل', 'New, not contacted')} value={fmtNum(stats.fresh)} icon={Sparkles} tone="sky" onClick={() => router.push('/leads?status=new')} />
        <StatCard label={tr('متابعات متأخرة', 'Overdue follow-ups')} value={fmtNum(stats.overdue)} icon={AlarmClock} tone="rose" onClick={() => router.push('/followups')} />
        <StatCard label={tr('متابعات باقي النهارده', 'Follow-ups left today')} value={fmtNum(stats.todayF)} icon={CalendarClock} tone="amber" onClick={() => router.push('/followups')} />
        <StatCard label={tr('اتوزعت النهارده', 'Assigned today')} value={fmtNum(stats.today)} icon={Inbox} tone="violet" />
        <StatCard label={tr('تعاقدات الشهر', 'Won this month')} value={fmtNum(stats.won)} icon={Trophy} tone="emerald"
          hint={stats.wonValue ? tr(`بقيمة ${fmtNum(stats.wonValue)}`, `Worth ${fmtNum(stats.wonValue)}`) : undefined} />
        {manager && (
          <StatCard label={tr('في انتظار التوزيع', 'Waiting for distribution')} value={fmtNum(stats.pool)} icon={Inbox} tone="indigo"
            onClick={() => router.push('/leads?assigned=none')} />
        )}
      </div>

      <DealsBoard onChanged={load} />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="card p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">{tr('متابعاتي الجاية', 'My upcoming follow-ups')}</h2>
            <Link href="/followups" className="text-xs font-semibold text-indigo-600">{tr('عرض الكل', 'View all')}</Link>
          </div>
          {fus.length === 0 ? (
            <Empty text={tr('مفيش متابعات مفتوحة 🎉', 'No open follow-ups 🎉')} icon={CalendarClock} />
          ) : (
            <div className="divide-y divide-slate-100">
              {fus.map((f) => {
                const late = new Date(f.due_at).getTime() < Date.now();
                return (
                  <button key={f.id} onClick={() => openLead(f.lead_id, load)} className="flex w-full items-center gap-3 py-2.5 text-start hover:bg-slate-50">
                    <div className={`w-24 shrink-0 text-xs font-bold ${late ? 'text-rose-600' : 'text-slate-500'}`}>{fromNow(f.due_at)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{f.lead?.full_name}</div>
                      <div className="truncate text-xs text-slate-400">{L(findOpt(FOLLOWUP_TYPES, f.type))} · {f.note || fmtDateTime(f.due_at)}</div>
                    </div>
                    {f.lead && <StageBadge status={f.lead.status} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-3 font-bold">{tr('توزيع المراحل', 'Pipeline by stage')}</h2>
          <div className="space-y-2.5">
            {STAGES.map((s) => (
              <Link key={s.value} href={`/leads?status=${s.value}`} className="block">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold">{L(s)}</span>
                  <span className="tabular-nums text-slate-500">{fmtNum(stages[s.value] ?? 0)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${((stages[s.value] ?? 0) / stageTotal) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {board.length > 0 && (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">{tr('ترتيب الفريق — الشهر ده', 'Team leaderboard — this month')}</h2>
            <Link href="/reports" className="text-xs font-semibold text-indigo-600">{tr('التقارير الكاملة', 'Full reports')}</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100">
                <th className="th">#</th>
                <th className="th">{tr('السيلز', 'Rep')}</th>
                <th className="th">{tr('ليدز', 'Leads')}</th>
                <th className="th">{tr('تم التواصل', 'Contacted')}</th>
                <th className="th">{tr('تعاقدات', 'Won')}</th>
                <th className="th">{tr('القيمة', 'Value')}</th>
                <th className="th">{tr('التحويل', 'Conversion')}</th>
              </tr></thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.user_id} className="border-b border-slate-50">
                    <td className="td">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                    <td className="td font-semibold">{r.full_name}</td>
                    <td className="td tabular-nums">{fmtNum(r.assigned)}</td>
                    <td className="td tabular-nums">{fmtNum(r.contacted)}</td>
                    <td className="td font-bold tabular-nums text-emerald-600">{fmtNum(r.won)}</td>
                    <td className="td tabular-nums">{fmtNum(r.won_value)}</td>
                    <td className="td tabular-nums">{Number(r.assigned) ? Math.round((Number(r.won) / Number(r.assigned)) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
