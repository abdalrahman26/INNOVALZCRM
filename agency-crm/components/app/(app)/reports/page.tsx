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
type FunnelRow = {
  user_id: string; interested: number; quote_requested: number; proposals: number; negotiation: number;
  lost: number; fresh: number; cold: number; no_source: number;
};
type Row = SalesRow & Partial<Omit<FunnelRow, 'user_id' | 'lost'>>;
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
  { key: 'lead_temp', ar: 'فريش / كولد', en: 'Fresh / Cold' },
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

const TEMP: Record<string, { ar: string; en: string }> = {
  fresh: { ar: 'فريش 🔥', en: 'Fresh 🔥' },
  cold: { ar: 'كولد ❄️', en: 'Cold ❄️' },
  unknown: { ar: 'من غير مصدر', en: 'No source' },
};
const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

export default function ReportsPage() {
  const { profile } = useApp();
  const supabase = useSupabase();
  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dim, setDim] = useState('source');
  const [sales, setSales] = useState<Row[] | null>(null);
  const [hasFunnel, setHasFunnel] = useState(true);
  const [breakdown, setBreakdown] = useState<BreakRow[]>([]);
  const [hideEmpty, setHideEmpty] = useState(true);
  const { tr, L } = useI18n();
  const dimLabel = (v: string) => (dim === 'lead_temp'
    ? L(TEMP[v] ?? TEMP.unknown)
    : L(findOpt(dim === 'service' ? SERVICES : dim === 'lost_reason' ? LOST_REASONS : SOURCES, v)));

  const [start, end] = useMemo(() => rangeDates(range, from, to), [range, from, to]);

  const load = useCallback(async () => {
    setSales(null);
    const [s, b, f] = await Promise.all([
      supabase.rpc('sales_report', { p_from: start.toISOString(), p_to: end.toISOString() }),
      supabase.rpc('breakdown_report', { p_from: start.toISOString(), p_to: end.toISOString(), p_dim: dim }),
      supabase.rpc('funnel_report', { p_from: start.toISOString(), p_to: end.toISOString() }),
    ]);
    if (s.error) toast.error(s.error.message);
    // لو كود الداتابيز v5 لسه مش متشغل — التقرير القديم يفضل شغال عادي
    setHasFunnel(!f.error);
    const fm = new Map(((f.data as FunnelRow[]) ?? []).map((x) => [x.user_id, x]));
    setSales(((s.data as SalesRow[]) ?? []).map((r) => {
      const x = fm.get(r.user_id);
      return x ? { ...r, interested: x.interested, quote_requested: x.quote_requested, proposals: x.proposals, negotiation: x.negotiation, fresh: x.fresh, cold: x.cold, no_source: x.no_source } : r;
    }));
    setBreakdown((b.data as BreakRow[]) ?? []);
  }, [supabase, start, end, dim]);

  useEffect(() => { if (can(profile, 'reports')) load(); }, [load, profile]);

  if (!can(profile, 'reports')) return <NoAccess />;

  const rows = (sales ?? []).filter((r) => !hideEmpty || Number(r.assigned) > 0 || Number(r.notes_count) > 0);
  const tot = rows.reduce((a, r) => ({
    assigned: a.assigned + n(r.assigned), contacted: a.contacted + n(r.contacted), won: a.won + n(r.won), value: a.value + n(r.won_value),
    interested: a.interested + n(r.interested), quote: a.quote + n(r.quote_requested), proposals: a.proposals + n(r.proposals),
    negotiation: a.negotiation + n(r.negotiation), lost: a.lost + n(r.lost),
    fresh: a.fresh + n(r.fresh), cold: a.cold + n(r.cold), noSource: a.noSource + n(r.no_source),
  }), { assigned: 0, contacted: 0, won: 0, value: 0, interested: 0, quote: 0, proposals: 0, negotiation: 0, lost: 0, fresh: 0, cold: 0, noSource: 0 });
  const tempTotal = tot.fresh + tot.cold + tot.noSource;
  const maxBreak = Math.max(1, ...breakdown.map((b) => Number(b.total)));

  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }, { RTL: true }] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
      [tr('السيلز', 'Rep')]: r.full_name, [tr('ليدز', 'Leads')]: Number(r.assigned), [tr('تم التواصل', 'Contacted')]: Number(r.contacted),
      [tr('فريش', 'Fresh')]: n(r.fresh), [tr('كولد', 'Cold')]: n(r.cold),
      [tr('مهتمين', 'Interested')]: n(r.interested), [tr('طالب عرض سعر', 'Quote requested')]: n(r.quote_requested),
      [tr('تم إرسال عرض', 'Proposal sent')]: n(r.proposals), [tr('تفاوض', 'Negotiation')]: n(r.negotiation),
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

      {hasFunnel && sales && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-bold">{tr('الليدز وصلت لفين', 'Where the leads are')}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <Stage label={tr('مهتمين', 'Interested')} hint={tr('كل المراحل ما عدا الخسارة', 'Every stage except lost')} value={tot.interested} total={tot.assigned} tone="amber" />
              <Stage label={tr('طالب عرض سعر', 'Quote requested')} value={tot.quote} total={tot.assigned} tone="cyan" />
              <Stage label={tr('تم إرسال عرض', 'Proposal sent')} value={tot.proposals} total={tot.assigned} tone="fuchsia" />
              <Stage label={tr('تفاوض', 'Negotiation')} value={tot.negotiation} total={tot.assigned} tone="orange" />
              <Stage label={tr('خسارة', 'Lost')} value={tot.lost} total={tot.assigned} tone="rose" />
            </div>
          </div>
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-bold">{tr('فريش وكولد', 'Fresh vs cold')}</h2>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-700">{L(TEMP.fresh)}</div>
                <div className="text-3xl font-extrabold tabular-nums text-emerald-600">{fmtNum(tot.fresh)}</div>
              </div>
              <div className="text-end">
                <div className="text-xs font-semibold text-sky-700">{L(TEMP.cold)}</div>
                <div className="text-3xl font-extrabold tabular-nums text-sky-600">{fmtNum(tot.cold)}</div>
              </div>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
              {tempTotal > 0 && <>
                <div className="h-full bg-emerald-500" style={{ width: `${(tot.fresh / tempTotal) * 100}%` }} />
                <div className="h-full bg-slate-300" style={{ width: `${(tot.noSource / tempTotal) * 100}%` }} />
                <div className="h-full bg-sky-500" style={{ width: `${(tot.cold / tempTotal) * 100}%` }} />
              </>}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-500 tabular-nums">
              <span>{pct(tot.fresh, tempTotal)}%</span>
              {tot.noSource > 0 && <span>{L(TEMP.unknown)}: {fmtNum(tot.noSource)}</span>}
              <span>{pct(tot.cold, tempTotal)}%</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{tr('كولد = مصدره Cold Call أو داتا قديمة · الباقي فريش', 'Cold = source is Cold Call or old data · the rest is fresh')}</p>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold">{tr('أداء السيلز', 'Rep performance')}</h2>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" className="accent-indigo-600" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> {tr('إخفاء اللي معندهمش ليدز', 'Hide reps without leads')}
          </label>
        </div>
        {!sales ? <div className="py-12"><Spinner className="mx-auto h-7 w-7" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px]">
              <thead className="bg-slate-50"><tr>
                <th className="th">{tr('السيلز', 'Rep')}</th><th className="th">{tr('ليدز', 'Leads')}</th>
                {hasFunnel && <th className="th">{tr('فريش / كولد', 'Fresh / Cold')}</th>}
                <th className="th">{tr('تم التواصل', 'Contacted')}</th>
                {hasFunnel && <>
                  <th className="th">{tr('مهتمين', 'Interested')}</th><th className="th">{tr('طالب عرض', 'Quote req.')}</th>
                  <th className="th">{tr('عروض اتبعتت', 'Proposals')}</th><th className="th">{tr('تفاوض', 'Negotiation')}</th>
                </>}
                {!hasFunnel && <th className="th">{tr('اجتماع+', 'Meeting+')}</th>}
                <th className="th">{tr('تعاقد', 'Won')}</th><th className="th">{tr('خسارة', 'Lost')}</th><th className="th">{tr('القيمة', 'Value')}</th><th className="th">{tr('التحويل', 'Conversion')}</th>
                <th className="th">{tr('سرعة الرد', 'Response time')}</th><th className="th">{tr('ملاحظات', 'Notes')}</th><th className="th">{tr('متابعات متأخرة', 'Overdue')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} className="border-t border-slate-100">
                    <td className="td font-semibold">{r.full_name}</td>
                    <td className="td tabular-nums">{fmtNum(r.assigned)}</td>
                    {hasFunnel && (
                      <td className="td tabular-nums">
                        <span className="font-semibold text-emerald-600">{fmtNum(n(r.fresh))}</span>
                        <span className="text-slate-300"> / </span>
                        <span className="font-semibold text-sky-600">{fmtNum(n(r.cold))}</span>
                      </td>
                    )}
                    <td className="td tabular-nums">{fmtNum(r.contacted)} <span className="text-xs text-slate-400">({pct(r.contacted, r.assigned)}%)</span></td>
                    {hasFunnel ? <>
                      <td className="td tabular-nums font-semibold text-amber-700">{fmtNum(n(r.interested))}</td>
                      <td className="td tabular-nums">{fmtNum(n(r.quote_requested))}</td>
                      <td className="td tabular-nums">{fmtNum(n(r.proposals))}</td>
                      <td className="td tabular-nums">{fmtNum(n(r.negotiation))}</td>
                    </> : <td className="td tabular-nums">{fmtNum(r.advanced)}</td>}
                    <td className="td tabular-nums font-bold text-emerald-600">{fmtNum(r.won)}</td>
                    <td className="td tabular-nums text-rose-600">{fmtNum(r.lost)}</td>
                    <td className="td tabular-nums">{fmtNum(r.won_value)}</td>
                    <td className="td tabular-nums font-bold">{pct(r.won, r.assigned)}%</td>
                    <td className="td tabular-nums text-xs">{r.avg_response_min != null ? `${fmtNum(r.avg_response_min)} ${tr('د', 'min')}` : '—'}</td>
                    <td className="td tabular-nums">{fmtNum(r.notes_count)}</td>
                    <td className={`td tabular-nums ${Number(r.overdue_followups) ? 'font-bold text-rose-600' : ''}`}>{fmtNum(r.overdue_followups)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={16} className="py-10 text-center text-sm text-slate-400">{tr('مفيش بيانات في الفترة دي', 'No data for this period')}</td></tr>}
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

const TONES: Record<string, [string, string]> = {
  amber: ['text-amber-700', 'bg-amber-500'], cyan: ['text-cyan-700', 'bg-cyan-500'], fuchsia: ['text-fuchsia-700', 'bg-fuchsia-500'],
  orange: ['text-orange-700', 'bg-orange-500'], rose: ['text-rose-700', 'bg-rose-500'],
};
function Stage({ label, value, total, tone, hint }: { label: string; value: number; total: number; tone: string; hint?: string }) {
  const [txt, bar] = TONES[tone];
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3" title={hint}>
      <div className={`truncate text-xs font-bold ${txt}`}>{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-extrabold tabular-nums">{fmtNum(value)}</span>
        <span className="text-[11px] text-slate-400 tabular-nums">{pct(value, total)}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
      {hint && <div className="mt-1 truncate text-[10px] text-slate-400">{hint}</div>}
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
