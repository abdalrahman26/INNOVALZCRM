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
import type { DistributionSettings } from '@/lib/types';

type Run = { id: number; ran_at: string; total: number; recycled: number; forced: boolean };

export default function DistributionPage() {
  const { profile, team, refreshTeam } = useApp();
  const supabase = useSupabase();
  const { settings, pool, reload } = useDistribution(15_000);
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
    if (form.work_start >= form.work_end) return toast.error('ميعاد بداية الشغل لازم يكون قبل النهاية');
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
    toast.success('تم حفظ الإعدادات');
    await reload();
    const { data } = await supabase.from('distribution_settings').select('*').eq('id', 1).single();
    setForm(data as DistributionSettings);
  }

  async function runNow() {
    if (!confirm('توزيع دفعة دلوقتي على كل السيلز المفعّلين؟')) return;
    setRunning(true);
    const { data, error } = await supabase.rpc('run_auto_distribution', { p_force: true });
    setRunning(false);
    if (error) return toast.error(error.message);
    toast.success(`تم توزيع ${data ?? 0} ليد`);
    reload();
    loadExtra();
  }

  async function setParticipation(uid: string, receives: boolean, cap: number | null) {
    const { error } = await supabase.rpc('set_auto_participation', { p_user: uid, p_receives: receives, p_cap: cap });
    if (error) return toast.error(error.message);
    refreshTeam();
  }

  const toggleDay = (d: number) =>
    set('work_days', form.work_days.includes(d) ? form.work_days.filter((x) => x !== d) : [...form.work_days, d]);
  const participants = team.filter((u) => u.is_active);
  const activeCount = participants.filter((u) => u.receives_auto_leads).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">التوزيع التلقائي</h1>
          <p className="text-sm text-slate-500">السيستم بيوزّع دفعة ليدز على السيلز كل فترة إنت بتحددها</p>
        </div>
        <button className="btn-secondary" onClick={runNow} disabled={running || pool === 0}>
          <Play size={16} /> {running ? 'جاري التوزيع…' : 'وزّع دفعة دلوقتي'}
        </button>
      </div>

      <DistributionCountdown big />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-slate-500">في انتظار التوزيع</div><div className="text-2xl font-extrabold">{fmtNum(pool)}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">سيلز مفعّلين في التوزيع</div><div className="text-2xl font-extrabold">{activeCount}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">آخر دفعة</div><div className="text-sm font-bold">{settings?.last_run_at ? `${fmtDateTime(settings.last_run_at)} · ${settings.last_run_count} ليد` : '—'}</div></div>
      </div>

      <div className="card space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold"><Shuffle size={18} /> الإعدادات</h2>
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label={form.enabled ? 'شغّال' : 'متوقف'} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">كل قد إيه ينزل دفعة؟ (بالدقايق)</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 120, 240].map((m) => (
                <button key={m} type="button" className={form.interval_minutes === m ? 'chip-on' : 'chip-off'} onClick={() => set('interval_minutes', m)}>
                  {m < 60 ? `${m} د` : `${m / 60} س`}
                </button>
              ))}
            </div>
            <input type="number" min={1} className="input" dir="ltr" value={form.interval_minutes}
              onChange={(e) => set('interval_minutes', Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div>
            <label className="label">عدد الليدز لكل سيلز في الدفعة</label>
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
          <label className="label">أيام الشغل</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => (
              <button key={d.value} type="button" className={form.work_days.includes(d.value) ? 'chip-on' : 'chip-off'} onClick={() => toggleDay(d.value)}>{d.label}</button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label">من الساعة</label><input type="time" className="input" dir="ltr" value={form.work_start.slice(0, 5)} onChange={(e) => set('work_start', e.target.value)} /></div>
          <div><label className="label">لحد الساعة</label><input type="time" className="input" dir="ltr" value={form.work_end.slice(0, 5)} onChange={(e) => set('work_end', e.target.value)} /></div>
          <div>
            <label className="label">التوقيت</label>
            <select className="input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">الأولوية</label>
            <select className="input" value={form.pick_order} onChange={(e) => set('pick_order', e.target.value as 'newest' | 'oldest')}>
              <option value="newest">الأحدث الأول (الليد السخن)</option>
              <option value="oldest">الأقدم الأول</option>
            </select>
          </div>
          <div className="flex items-end">
            <Toggle checked={form.show_countdown} onChange={(v) => set('show_countdown', v)} label="إظهار العداد للسيلز" />
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <Toggle checked={form.recycle_enabled} onChange={(v) => set('recycle_enabled', v)} label="إعادة توزيع الليدز اللي محدش كلمها" />
          {form.recycle_enabled && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              لو الليد فضل «جديد» من غير تواصل لمدة
              <input type="number" min={5} className="input w-24" dir="ltr" value={form.recycle_after_minutes}
                onChange={(e) => set('recycle_after_minutes', Math.max(5, Number(e.target.value) || 5))} />
              دقيقة، يرجع للتوزيع ويروح لسيلز تاني.
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'جاري الحفظ…' : 'حفظ الإعدادات'}</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 font-bold">السيلز المشتركين في التوزيع</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-slate-50"><tr>
              <th className="th">الاسم</th><th className="th">الدور</th><th className="th">يستقبل ليدز</th><th className="th">حد أقصى يومي</th><th className="th">استلم النهارده</th>
            </tr></thead>
            <tbody>
              {participants.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="td font-semibold">{u.full_name}</td>
                  <td className="td text-xs text-slate-500">{ROLE_LABELS[u.role]}</td>
                  <td className="td"><Toggle checked={u.receives_auto_leads} onChange={(v) => setParticipation(u.id, v, u.daily_cap)} /></td>
                  <td className="td">
                    <input type="number" min={0} placeholder="مفتوح" className="input w-24 py-1" dir="ltr" defaultValue={u.daily_cap ?? ''}
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
        <h2 className="mb-3 flex items-center gap-2 font-bold"><History size={18} /> آخر الدفعات</h2>
        {runs.length === 0 ? <p className="text-sm text-slate-400">لسه مفيش دفعات</p> : (
          <div className="divide-y divide-slate-100 text-sm">
            {runs.map((r) => (
              <div key={r.id} className="flex justify-between py-2">
                <span>{fmtDateTime(r.ran_at)} {r.forced && <span className="text-xs text-indigo-600">(يدوي)</span>}</span>
                <span className="tabular-nums">{r.total} ليد{r.recycled ? ` · ${r.recycled} اترجّع` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
