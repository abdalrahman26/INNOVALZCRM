'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { NoAccess, Spinner } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtNum } from '@/lib/format';

type SalesRow = {
  user_id: string; full_name: string; role: string; assigned: number; contacted: number; advanced: number;
  won: number; lost: number; won_value: number; avg_response_min: number | null; notes_count: number; overdue_followups: number;
};
type BreakRow = { label: string; total: number; contacted: number; won: number; lost: number; won_value: number };

const RANGES = [
  { key: 'today', label: 'النهارده' },
  { key: '7d', label: 'آخر 7 أيام' },
  { key: 'month', label: 'الشهر ده' },
  { key: 'last_month', label: 'الشهر اللي فات' },
  { key: 'custom', label: 'مخصص' },
];

const DIMS = [
  { key: 'source', label: 'حسب المصدر' },
  { key: 'service', label: 'حسب الخدمة' },
  { key: 'campaign', label: 'حسب الحملة' },
  { key: 'lost_reason', label: 'أسباب الخسارة' },
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
      'السيلز': r.full_name, 'ليدز': Number(r.assigned), 'تم التواصل': Number(r.contacted), 'اجتماع فما فوق': Number(r.advanced),
      'تعاقد': Number(r.won), 'خسارة': Number(r.lost), 'قيمة التعاقدات': Number(r.won_value), 'نسبة التحويل %': pct(r.won, r.assigned),
      'متوسط سرعة الرد (دقيقة)': r.avg_response_min ?? '', 'ملاحظات': Number(r.notes_count), 'متابعات متأخرة': Number(r.overdue_followups),
    }))), 'Sales');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(breakdown.map((b) => ({
      'البند': b.label, 'ليدز': Number(b.total), 'تم التواصل': Number(b.contacted), 'تعاقد': Number(b.won), 'خسارة': Number(b.lost),
      'قيمة': Number(b.won_value), 'نسبة التحويل %': pct(b.won, b.total),
    }))), 'Breakdown');
    XLSX.writeFile(wb, `report-${start.toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">التقارير</h1>
        {can(profile, 'export') && <button className="btn-secondary" onClick={exportXlsx} disabled={!sales}><Download size={16} /> تصدير Excel</button>}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {RANGES.map((r) => (
          <button key={r.key} className={range === r.key ? 'chip-on' : 'chip-off'} onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="input w-auto py-1" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>إلى</span>
            <input type="date" className="input w-auto py-1" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="ليدز اتوزعت" value={fmtNum(tot.assigned)} />
        <Kpi label="نسبة التواصل" value={`${pct(tot.contacted, tot.assigned)}%`} />
        <Kpi label="تعاقدات" value={fmtNum(tot.won)} sub={`تحويل ${pct(tot.won, tot.assigned)}%`} />
        <Kpi label="قيمة التعاقدات" value={fmtNum(tot.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold">أداء السيلز</h2>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" className="accent-indigo-600" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> إخفاء اللي معندهمش ليدز
          </label>
        </div>
        {!sales ? <div className="py-12"><Spinner className="mx-auto h-7 w-7" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50"><tr>
                <th className="th">السيلز</th><th className="th">ليدز</th><th className="th">تم التواصل</th><th className="th">اجتماع+</th>
                <th className="th">تعاقد</th><th className="th">خسارة</th><th className="th">القيمة</th><th className="th">التحويل</th>
                <th className="th">سرعة الرد</th><th className="th">ملاحظات</th><th className="th">متابعات متأخرة</th>
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
                    <td className="td tabular-nums text-xs">{r.avg_response_min != null ? `${fmtNum(r.avg_response_min)} د` : '—'}</td>
                    <td className="td tabular-nums">{fmtNum(r.notes_count)}</td>
                    <td className={`td tabular-nums ${Number(r.overdue_followups) ? 'font-bold text-rose-600' : ''}`}>{fmtNum(r.overdue_followups)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sm text-slate-400">مفيش بيانات في الفترة دي</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DIMS.map((d) => <button key={d.key} className={dim === d.key ? 'chip-on' : 'chip-off'} onClick={() => setDim(d.key)}>{d.label}</button>)}
        </div>
        {breakdown.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">مفيش بيانات</p> : (
          <div className="space-y-3">
            {breakdown.map((b) => (
              <div key={b.label}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold">{b.label}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {fmtNum(b.total)} ليد{dim !== 'lost_reason' && <> · {fmtNum(b.won)} تعاقد · تحويل {pct(b.won, b.total)}%{Number(b.won_value) ? ` · ${fmtNum(b.won_value)}` : ''}</>}
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
