'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { NoAccess, Spinner } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { LOST_REASONS, SERVICES, SOURCES, findOpt } from '@/lib/constants';

type SalesRow = {
  user_id: string; full_name: string; role: string; assigned: number; contacted: number; advanced: number;
  won: number; lost: number; won_value: number; avg_response_min: number | null; notes_count: number; overdue_followups: number;
};
type BreakRow = { label: string; total: number; contacted: number; won: number; lost: number; won_value: number };

const RANGES = [
  { key: 'today', ar: 'النهارده', en: 'Today' },
  { key: '7d', ar: 'آخر 7 أيام', en: 'Last 7 days' },
  { key: 'month', ar: 'الشهر ده', en: 'This month' },
  { key: 'last_month', ar: 'الشهر اللي فات', en: 'Last month' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
];

const DIMS = [
  { key: 'source', ar: 'حسب المصدر', en: 'By source' },
  { key: 'service', ar: 'حسب الخدمة', en: 'By service' },
  { key: 'campaign', ar: 'حسب الحملة', en: 'By campaign' },
  { key: 'lost_reason', ar: 'أسباب الخسارة', en: 'Lost reasons' },
];

function rangeDates(key: string, from: string, to: string): [Date, Date] {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  switch (key) {
    case 'today': return [start, end];
    case '7d': { const s = new Date(start); s.setDate(s.getDate() - 6); return [s, end]; }
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1), end];
    case 'last_month': return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
    default: {
      const s = from ? new Date(from + 'T00:00:00') : start;
      const e = to ? new Date(to + 'T00:00:00') : start;
      e.setDate(e.getDate() + 1);
      return [s, e];
    }
  }
}

const pct = (a: number, b: number) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

export default function ReportsPage() {
  const { profile } = useApp();
  const supabase = useSupabase();
  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dim, setDim] = useState('source');
  const [sales, setSales] = useState<SalesRow[] | null>(null);
  const [breakdown, setBreakdown] = useState<BreakRow[]>([]);
  const [hideEmpty, setHideEmpty] = useState(true);
  const { tr, L } = useI18n();
  const dimLabel = (v: string) => L(findOpt(dim === 'service' ? SERVICES : dim === 'lost_reason' ? LOST_REASONS : SOURCES, v));

  const [start, end] = useMemo(() => rangeDates(range, from, to), [range, from, to]);

  const load = useCallback(async () => {
    setSales(null);
    const [s, b] = await Promise.all([
      supabase.rpc('sales_report', { p_from: start.toISOString(), p_to: end.toISOString() }),
      supabase.rpc('breakdown_report', { p_from: start.toISOString(), p_to: end.toISOString(), p_dim: dim }),
    ]);
    if (s.error) toast.error(s.error.message);
    setSales((s.data as SalesRow[]) ?? []);
    setBreakdown((b.data as BreakRow[]) ?? []);
  }, [supabase, start, end, dim]);

  useEffect(() => { if (can(profile, 'reports')) load(); }, [load, profile]);

  if (!can(profile, 'reports')) return <NoAccess />;

  const rows = (sales ?? []).filter((r) => !hideEmpty || Number(r.assigned) > 0 || Number(r.notes_count) > 0);
  const tot = rows.reduce((a, r) => ({
    assigned: a.assigned + Number(r.assigned), contacted: a.contacted + Number(r.contacted), won: a.won + Number(r.won), value: a.value + Number(r.won_value),
  }), { assigned: 0, contacted: 0, won: 0, value: 0 });
  const maxBreak = Math.max(1, ...breakdown.map((b) => Number(b.total)));

  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }, { RTL: true }] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
      [tr('السيلز', 'Rep')]: r.full_name, [tr('ليدز', 'Leads')]: Number(r.assigned), [tr('تم التواصل', 'Contacted')]: Number(r.contacted),
      [tr('اجتماع فما فوق', 'Meeting+')]: Number(r.advanced), [tr('تعاقد', 'Won')]: Number(r.won), [tr('خسارة', 'Lost')]: Number(r.lost),
      [tr('قيمة التعاقدات', 'Won value')]: Number(r.won_value), [tr('نسبة التحويل %', 'Conversion %')]: pct(r.won, r.assigned),
      [tr('متوسط سرعة الرد (دقيقة)', 'Avg response (min)')]: r.avg_response_min ?? '', [tr('ملاحظات', 'Notes')]: Number(r.notes_count),
      [tr('متابعات متأخرة', 'Overdue follow-ups')]: Number(r.overdue_followups),
    }))), 'Sales');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(breakdown.map((b) => ({
      [tr('البند', 'Item')]: dim === 'campaign' ? b.label : dimLabel(b.label), [tr('ليدز', 'Leads')]: Number(b.total),
      [tr('تم التواصل', 'Contacted')]: Number(b.contacted), [tr('تعاقد', 'Won')]: Number(b.won), [tr('خسارة', 'Lost')]: Number(b.lost),
      [tr('قيمة', 'Value')]: Number(b.won_value), [tr('نسبة التحويل %', 'Conversion %')]: pct(b.won, b.total),
    }))), 'Breakdown');
    XLSX.writeFile(wb, `report-${start.toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{tr('التقارير', 'Reports')}</h1>
        {can(profile, 'export') && <button className="btn-secondary" onClick={exportXlsx} disabled={!sales}><Download size={16} /> {tr('تصدير Excel', 'Export Excel')}</button>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {RANGES.map((r) => (
          <button key={r.key} className={range === r.key ? 'chip-on' : 'chip-off'} onClick={() => setRange(r.key)}>{L(r)}</button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="input w-auto py-1" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>{tr('إلى', 'to')}</span>
            <input type="date" className="input w-auto py-1" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tr('ليدز اتوزعت', 'Leads assigned')} value={fmtNum(tot.assigned)} />
        <Kpi label={tr('نسبة التواصل', 'Contact rate')} value={`${pct(tot.contacted, tot.assigned)}%`} />
        <Kpi label={tr('تعاقدات', 'Won')} value={fmtNum(tot.won)} sub={`${tr('تحويل', 'Conversion')} ${pct(tot.won, tot.assigned)}%`} />
        <Kpi label={tr('قيمة التعاقدات', 'Won value')} value={fmtNum(tot.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold">{tr('أداء السيلز', 'Rep performance')}</h2>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" className="accent-indigo-600" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> {tr('إخفاء اللي معندهمش ليدز', 'Hide reps without leads')}
          </label>
        </div>
        {!sales ? <div className="py-12"><Spinner className="mx-auto h-7 w-7" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50"><tr>
                <th className="th">{tr('السيلز', 'Rep')}</th><th className="th">{tr('ليدز', 'Leads')}</th><th className="th">{tr('تم التواصل', 'Contacted')}</th><th className="th">{tr('اجتماع+', 'Meeting+')}</th>
                <th className="th">{tr('تعاقد', 'Won')}</th><th className="th">{tr('خسارة', 'Lost')}</th><th className="th">{tr('القيمة', 'Value')}</th><th className="th">{tr('التحويل', 'Conversion')}</th>
                <th className="th">{tr('سرعة الرد', 'Response time')}</th><th className="th">{tr('ملاحظات', 'Notes')}</th><th className="th">{tr('متابعات متأخرة', 'Overdue')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className="border-t border-slate-100">
                    <td className="td font-semibold">{r.full_name}</td>
                    <td className="td tabular-nums">{fmtNum(r.assigned)}</td>
                    <td className="td tabular-nums">{fmtNum(r.contacted)} <span className="text-xs text-slate-400">({pct(r.contacted, r.assigned)}%)</span></td>
                    <td className="td tabular-nums">{fmtNum(r.advanced)}</td>
                    <td className="td tabular-nums font-bold text-emerald-600">{fmtNum(r.won)}</td>
                    <td className="td tabular-nums text-rose-600">{fmtNum(r.lost)}</td>
                    <td className="td tabular-nums">{fmtNum(r.won_value)}</td>
                    <td className="td tabular-nums font-bold">{pct(r.won, r.assigned)}%</td>
                    <td className="td tabular-nums text-xs">{r.avg_response_min != null ? `${fmtNum(r.avg_response_min)} ${tr('د', 'min')}` : '—'}</td>
                    <td className="td tabular-nums">{fmtNum(r.notes_count)}</td>
                    <td className={`td tabular-nums ${Number(r.overdue_followups) ? 'font-bold text-rose-600' : ''}`}>{fmtNum(r.overdue_followups)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sm text-slate-400">{tr('مفيش بيانات في الفترة دي', 'No data for this period')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DIMS.map((d) => <button key={d.key} className={dim === d.key ? 'chip-on' : 'chip-off'} onClick={() => setDim(d.key)}>{L(d)}</button>)}
        </div>
        {breakdown.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">{tr('مفيش بيانات', 'No data')}</p> : (
          <div className="space-y-3">
            {breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold">{dim === 'campaign' ? b.label : dimLabel(b.label)}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {fmtNum(b.total)} {tr('ليد', 'leads')}{dim !== 'lost_reason' && <> · {fmtNum(b.won)} {tr('تعاقد', 'won')} · {tr('تحويل', 'conv.')} {pct(b.won, b.total)}%{Number(b.won_value) ? ` · ${fmtNum(b.won_value)}` : ''}</>}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${dim === 'lost_reason' ? 'bg-rose-400' : 'bg-indigo-500'}`} style={{ width: `${(Number(b.total) / maxBreak) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
