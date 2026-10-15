'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Play, Save, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import DistributionCountdown from '@/components/DistributionCountdown';
import { NoAccess, PageLoader, Toggle } from '@/components/ui';
import { useDistribution, useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { ROLE_LABELS, TIMEZONES, WEEK_DAYS } from '@/lib/constants';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { DistributionSettings } from '@/lib/types';

type Run = { id: number; ran_at: string; total: number; recycled: number; forced: boolean };

export default function DistributionPage() {
  const { profile, team, refreshTeam } = useApp();
  const supabase = useSupabase();
  const { settings, pool, reload } = useDistribution(15_000);
  const { tr, L } = useI18n();
  const [partBusy, setPartBusy] = useState<string | null>(null);
  const [form, setForm] = useState<DistributionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [today, setToday] = useState<Record<string, number>>({});

  useEffect(() => { if (settings && !form) setForm(settings); }, [settings, form]);

  const loadExtra = useCallback(async () => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const [r, l] = await Promise.all([
      supabase.from('distribution_runs').select('*').order('ran_at', { ascending: false }).limit(10),
      supabase.from('leads').select('assigned_to').gte('assigned_at', dayStart.toISOString()).not('assigned_to', 'is', null).limit(10000),
    ]);
    setRuns((r.data as Run[]) ?? []);
    const counts: Record<string, number> = {};
    ((l.data as { assigned_to: string }[]) ?? []).forEach((x) => { counts[x.assigned_to] = (counts[x.assigned_to] ?? 0) + 1; });
    setToday(counts);
  }, [supabase]);

  useEffect(() => { loadExtra(); }, [loadExtra]);

  if (!can(profile, 'manage_distribution')) return <NoAccess />;
  if (!form) return <PageLoader />;

  const set = <K extends keyof DistributionSettings>(k: K, v: DistributionSettings[K]) => setForm({ ...form, [k]: v });

  async function save() {
    if (!form) return;
    if (form.work_start >= form.work_end) return toast.error(tr('ميعاد بداية الشغل لازم يكون قبل النهاية', 'Work start must be before work end'));
    setSaving(true);
    const { error } = await supabase.from('distribution_settings').update({
      enabled: form.enabled,
      interval_minutes: form.interval_minutes,
      batch_size: form.batch_size,
      pick_order: form.pick_order,
      work_days: form.work_days,
      work_start: form.work_start,
      work_end: form.work_end,
      timezone: form.timezone,
      show_countdown: form.show_countdown,
      recycle_enabled: form.recycle_enabled,
      recycle_after_minutes: form.recycle_after_minutes,
      next_run_at: null, // يعيد ضبط العداد
    }).eq('id', 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(tr('تم حفظ الإعدادات', 'Settings saved'));
    await reload();
    const { data } = await supabase.from('distribution_settings').select('*').eq('id', 1).single();
    setForm(data as DistributionSettings);
  }

  async function runNow() {
    if (!confirm(tr('توزيع دفعة دلوقتي على كل السيلز المفعّلين؟', 'Distribute a batch now to all active reps?'))) return;
    setRunning(true);
    const { data, error } = await supabase.rpc('run_auto_distribution', { p_force: true });
    setRunning(false);
    if (error) return toast.error(error.message);
    toast.success(tr(`تم توزيع ${data ?? 0} ليد`, `${data ?? 0} leads distributed`));
    reload();
    loadExtra();
  }

  async function setParticipation(uid: string, receives: boolean, cap: number | null) {
    if (partBusy) return;
    setPartBusy(uid);
    const { error } = await supabase.rpc('set_auto_participation', { p_user: uid, p_receives: receives, p_cap: cap });
    if (!error) await refreshTeam();
    setPartBusy(null);
    if (error) toast.error(error.message);
  }

  const toggleDay = (d: number) =>
    set('work_days', form.work_days.includes(d) ? form.work_days.filter((x) => x !== d) : [...form.work_days, d]);
  const participants = team.filter((u) => u.is_active);
  const activeCount = participants.filter((u) => u.receives_auto_leads).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{tr('التوزيع التلقائي', 'Auto distribution')}</h1>
          <p className="text-sm text-slate-500">{tr('السيستم بيوزّع دفعة ليدز على السيلز كل فترة إنت بتحددها', 'The system sends a batch of leads to reps at the interval you set')}</p>
        </div>
        <button className="btn-secondary" onClick={runNow} disabled={running || pool === 0}>
          <Play size={16} /> {running ? tr('جاري التوزيع…', 'Distributing…') : tr('وزّع دفعة دلوقتي', 'Distribute a batch now')}
        </button>
      </div>

      <DistributionCountdown big />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-slate-500">{tr('في انتظار التوزيع', 'Waiting for distribution')}</div><div className="text-2xl font-extrabold">{fmtNum(pool)}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">{tr('سيلز مفعّلين في التوزيع', 'Reps in distribution')}</div><div className="text-2xl font-extrabold">{activeCount}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">{tr('آخر دفعة', 'Last batch')}</div><div className="text-sm font-bold">{settings?.last_run_at ? `${fmtDateTime(settings.last_run_at)} · ${settings.last_run_count} ${tr('ليد', 'leads')}` : '—'}</div></div>
      </div>

      <div className="card space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold"><Shuffle size={18} /> {tr('الإعدادات', 'Settings')}</h2>
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label={form.enabled ? tr('شغّال', 'On') : tr('متوقف', 'Off')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">{tr('كل قد إيه ينزل دفعة؟ (بالدقايق)', 'Batch every (minutes)')}</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 120, 240].map((m) => (
                <button key={m} type="button" className={form.interval_minutes === m ? 'chip-on' : 'chip-off'} onClick={() => set('interval_minutes', m)}>
                  {m < 60 ? `${m} ${tr('د', 'min')}` : `${m / 60} ${tr('س', 'h')}`}
                </button>
              ))}
            </div>
            <input type="number" min={1} className="input" dir="ltr" value={form.interval_minutes}
              onChange={(e) => set('interval_minutes', Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div>
            <label className="label">{tr('عدد الليدز لكل سيلز في الدفعة', 'Leads per rep per batch')}</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[1, 3, 5, 10, 20].map((n) => (
                <button key={n} type="button" className={form.batch_size === n ? 'chip-on' : 'chip-off'} onClick={() => set('batch_size', n)}>{n}</button>
              ))}
            </div>
            <input type="number" min={1} className="input" dir="ltr" value={form.batch_size}
              onChange={(e) => set('batch_size', Math.max(1, Number(e.target.value) || 1))} />
          </div>
        </div>

        <div>
          <label className="label">{tr('أيام الشغل', 'Work days')}</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => (
              <button key={d.value} type="button" className={form.work_days.includes(d.value) ? 'chip-on' : 'chip-off'} onClick={() => toggleDay(d.value)}>{L(d)}</button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label">{tr('من الساعة', 'From')}</label><input type="time" className="input" dir="ltr" value={form.work_start.slice(0, 5)} onChange={(e) => set('work_start', e.target.value)} /></div>
          <div><label className="label">{tr('لحد الساعة', 'To')}</label><input type="time" className="input" dir="ltr" value={form.work_end.slice(0, 5)} onChange={(e) => set('work_end', e.target.value)} /></div>
          <div>
            <label className="label">{tr('التوقيت', 'Time zone')}</label>
            <select className="input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{L(t)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">{tr('الأولوية', 'Priority')}</label>
            <select className="input" value={form.pick_order} onChange={(e) => set('pick_order', e.target.value as 'newest' | 'oldest')}>
              <option value="newest">{tr('الأحدث الأول (الليد السخن)', 'Newest first (hot leads)')}</option>
              <option value="oldest">{tr('الأقدم الأول', 'Oldest first')}</option>
            </select>
          </div>
          <div className="flex items-end">
            <Toggle checked={form.show_countdown} onChange={(v) => set('show_countdown', v)} label={tr('إظهار العداد للسيلز', 'Show countdown to reps')} />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <Toggle checked={form.recycle_enabled} onChange={(v) => set('recycle_enabled', v)} label={tr('إعادة توزيع الليدز اللي محدش كلمها', 'Re-distribute leads nobody contacted')} />
          {form.recycle_enabled && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {tr('لو الليد فضل «جديد» من غير تواصل لمدة', 'If a lead stays “New” with no contact for')}
              <input type="number" min={5} className="input w-24" dir="ltr" value={form.recycle_after_minutes}
                onChange={(e) => set('recycle_after_minutes', Math.max(5, Number(e.target.value) || 5))} />
              {tr('دقيقة، يرجع للتوزيع ويروح لسيلز تاني.', 'minutes, it goes back to distribution for another rep.')}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}><Save size={16} /> {saving ? tr('جاري الحفظ…', 'Saving…') : tr('حفظ الإعدادات', 'Save settings')}</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 font-bold">{tr('السيلز المشتركين في التوزيع', 'Reps in auto distribution')}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-slate-50"><tr>
              <th className="th">{tr('الاسم', 'Name')}</th><th className="th">{tr('الدور', 'Role')}</th><th className="th">{tr('يستقبل ليدز', 'Receives leads')}</th><th className="th">{tr('حد أقصى يومي', 'Daily cap')}</th><th className="th">{tr('استلم النهارده', 'Received today')}</th>
            </tr></thead>
            <tbody>
              {participants.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="td font-semibold">{u.full_name}</td>
                  <td className="td text-xs text-slate-500">{ROLE_LABELS[u.role] ? L(ROLE_LABELS[u.role]) : u.role}</td>
                  <td className="td"><Toggle checked={u.receives_auto_leads} disabled={partBusy === u.id} onChange={(v) => setParticipation(u.id, v, u.daily_cap)} /></td>
                  <td className="td">
                    <input type="number" min={0} placeholder={tr('مفتوح', 'No limit')} className="input w-24 py-1" dir="ltr" defaultValue={u.daily_cap ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                        if (v !== u.daily_cap) setParticipation(u.id, u.receives_auto_leads, v);
                      }} />
                  </td>
                  <td className="td tabular-nums">{today[u.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-bold"><History size={18} /> {tr('آخر الدفعات', 'Recent batches')}</h2>
        {runs.length === 0 ? <p className="text-sm text-slate-400">{tr('لسه مفيش دفعات', 'No batches yet')}</p> : (
          <div className="divide-y divide-slate-100 text-sm">
            {runs.map((r) => (
              <div key={r.id} className="flex justify-between py-2">
                <span>{fmtDateTime(r.ran_at)} {r.forced && <span className="text-xs text-indigo-600">({tr('يدوي', 'manual')})</span>}</span>
                <span className="tabular-nums">{r.total} {tr('ليد', 'leads')}{r.recycled ? ` · ${r.recycled} ${tr('اترجّع', 'recycled')}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
