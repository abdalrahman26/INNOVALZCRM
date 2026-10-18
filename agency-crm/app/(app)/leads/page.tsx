'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, ExternalLink, Inbox, MessageCircle, Phone, Plus, Search, Trash2, Upload, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { AddLeadModal, AssignModal } from '@/components/LeadModals';
import { Empty, Spinner, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES, STAGES, findOpt } from '@/lib/constants';
import { fmtDateTime, fmtNum, fromNow, waLink } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { EMPTY_FILTERS, SORTS, SORT_OPTIONS, buildLeadsQuery, exportLeadsXlsx, type LeadFilters } from '@/lib/leads';
import type { Lead } from '@/lib/types';

const PAGE = 50;
const SORT_KEY = 'crm_leads_sort';
function readSort() {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v && v in SORTS ? v : 'created_at';
  } catch {
    return 'created_at';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** الفلاتر اللي جاية من اللينك (من الرئيسية أو من الإشعارات) */
function filtersFromUrl(sp: URLSearchParams) {
  const ids = (sp.get('ids') ?? '').split(',').filter((x) => UUID.test(x)).slice(0, 200);
  const sort = sp.get('sort');
  return {
    status: sp.get('status') ?? '',
    assigned: sp.get('assigned') ?? '',
    followup: sp.get('followup') ?? '',
    ids: ids.length ? ids : undefined,
    sort: sort && sort in SORTS ? sort : null,
  };
}

function LeadsInner() {
  const { profile, team, openLead } = useApp();
  const supabase = useSupabase();
  const sp = useSearchParams();
  const { tr, L, lang } = useI18n();
  const viewAll = can(profile, 'view_all');
  const canAssign = can(profile, 'assign');
  const canExport = can(profile, 'export');
  const canDelete = can(profile, 'delete');

  const [filters, setFilters] = useState<LeadFilters>(() => {
    const { sort, ...rest } = filtersFromUrl(sp);
    return { ...EMPTY_FILTERS, ...rest, sort: sort ?? EMPTY_FILTERS.sort };
  });
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Lead[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // الترتيب اللي اليوزر اختاره آخر مرة (محفوظ على جهازه)
  useEffect(() => {
    const saved = filtersFromUrl(sp).sort ?? readSort();
    setFilters((f) => (f.sort === saved ? f : { ...f, sort: saved }));
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // لو اللينك اتغير وإنت في نفس الصفحة (مثلاً دوست على إشعار) — نطبّق الفلاتر الجديدة
  const spKey = sp.toString();
  const firstUrl = useRef(true);
  useEffect(() => {
    if (firstUrl.current) { firstUrl.current = false; return; }
    const { sort, ...rest } = filtersFromUrl(new URLSearchParams(spKey));
    setFilters((f) => ({ ...f, ...rest, sort: sort ?? f.sort }));
    setPage(1);
  }, [spKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, count, error } = await buildLeadsQuery(supabase, filters, profile.id, true).range((page - 1) * PAGE, page * PAGE - 1);
    if (error) toast.error(error.message);
    setRows((data as Lead[]) ?? []);
    setCount(count ?? 0);
    if (!silent) setSelected(new Set());
    setLoading(false);
  }, [supabase, filters, page, profile.id]);

  useEffect(() => { if (ready) load(); }, [load, ready]);

  const refreshSilently = useCallback(() => load(true), [load]);

  const setF = (k: keyof LeadFilters) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    if (k === 'sort') { try { localStorage.setItem(SORT_KEY, v); } catch { /* ignore */ } }
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function bulkStatus(status: string) {
    if (!status || bulkBusy) return;
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await supabase.from('leads').update({ status }).in('id', ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tr(`تم تحديث ${ids.length} ليد`, `${ids.length} leads updated`));
    load();
  }

  async function bulkDelete() {
    if (bulkBusy) return;
    const ids = [...selected];
    if (!confirm(tr(`متأكد إنك عاوز تحذف ${ids.length} ليد؟ مفيش رجوع.`, `Delete ${ids.length} leads? This can't be undone.`))) return;
    setBulkBusy(true);
    const { error } = await supabase.from('leads').delete().in('id', ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tr('تم الحذف', 'Deleted'));
    load();
  }

  async function exportRows(onlySelected: boolean) {
    setExporting(true);
    try {
      let all: Lead[] = [];
      if (onlySelected) {
        all = rows.filter((r) => selected.has(r.id));
      } else {
        for (let from = 0; from < 50_000; from += 1000) {
          const { data, error } = await buildLeadsQuery(supabase, filters, profile.id).range(from, from + 999);
          if (error) throw error;
          all = all.concat((data as Lead[]) ?? []);
          if (!data || data.length < 1000) break;
        }
      }
      await exportLeadsXlsx(all, team, lang);
      toast.success(tr(`تم تصدير ${all.length} ليد`, `${all.length} leads exported`));
    } catch (e) {
      toast.error((e as Error).message);
    }
    setExporting(false);
  }

  const pages = Math.max(1, Math.ceil(count / PAGE));
  const activeUsers = team.filter((u) => u.is_active);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{tr('الليدز', 'Leads')}</h1>
          <p className="text-sm text-slate-500">{fmtNum(count)} {tr('ليد', 'leads')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(profile, 'import') && <Link href="/import" className="btn-secondary"><Upload size={16} /> {tr('استيراد', 'Import')}</Link>}
          {canExport && (
            <button className="btn-secondary" disabled={exporting} onClick={() => exportRows(false)}>
              {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} {tr('تصدير Excel', 'Export Excel')}
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> {tr('ليد جديد', 'New lead')}</button>
        </div>
      </div>

      <div className="card grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="relative lg:col-span-2">
          <Search size={16} className="absolute start-3 top-2.5 text-slate-400" />
          <input className="input ps-9" placeholder={tr('بحث بالاسم، الرقم، الشركة…', 'Search name, phone, company…')} value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select className="input" value={filters.status} onChange={setF('status')}>
          <option value="">{tr('كل المراحل', 'All stages')}</option>{STAGES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
        </select>
        <select className="input" value={filters.service} onChange={setF('service')}>
          <option value="">{tr('كل الخدمات', 'All services')}</option>{SERVICES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
        </select>
        <select className="input" value={filters.source} onChange={setF('source')}>
          <option value="">{tr('كل المصادر', 'All sources')}</option>{SOURCES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
        </select>
        <select className="input" value={filters.followup} onChange={setF('followup')}>
          <option value="">{tr('كل المتابعات', 'All follow-ups')}</option>
          <option value="overdue">{tr('متابعة متأخرة', 'Overdue')}</option>
          <option value="today">{tr('متابعة النهارده', 'Due today')}</option>
          <option value="none">{tr('بدون متابعة', 'No follow-up')}</option>
        </select>
        {viewAll && (
          <select className="input" value={filters.assigned} onChange={setF('assigned')}>
            <option value="">{tr('كل السيلز', 'All reps')}</option>
            <option value="me">{tr('ليدزي أنا', 'My leads')}</option>
            <option value="none">{tr('غير موزعة', 'Unassigned')}</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
        <select className="input" value={filters.sort} onChange={setF('sort')} aria-label={tr('الترتيب', 'Sort')}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>↕ {L(o)}</option>)}
        </select>
      </div>

      {filters.ids && (
        <div className="card flex flex-wrap items-center gap-2 border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
          <Inbox size={16} className="text-indigo-600" />
          <span className="flex-1 font-semibold text-indigo-800">
            {tr(`بتشوف الليدز اللي اتحولتلك من الإشعار (${filters.ids.length})`, `Showing the leads from the notification (${filters.ids.length})`)}
          </span>
          <Link href="/leads" className="btn-secondary btn-sm"><X size={14} /> {tr('عرض كل الليدز', 'Show all leads')}</Link>
        </div>
      )}

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 border-indigo-200 bg-indigo-50 p-3">
          <span className="text-sm font-bold text-indigo-700">{tr(`تم تحديد ${selected.size}`, `${selected.size} selected`)}</span>
          {bulkBusy && <Spinner className="h-4 w-4" />}
          <div className="flex-1" />
          {canAssign && <button className="btn-primary btn-sm" onClick={() => setShowAssign(true)}><Users size={14} /> {tr('توزيع / تحويل', 'Assign / transfer')}</button>}
          <select className="input w-auto py-1.5 text-xs" value="" disabled={bulkBusy} onChange={(e) => bulkStatus(e.target.value)}>
            <option value="">{tr('تغيير المرحلة…', 'Change stage…')}</option>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
          </select>
          {canExport && <button className="btn-secondary btn-sm" onClick={() => exportRows(true)}><Download size={14} /> {tr('تصدير المحدد', 'Export selected')}</button>}
          {canDelete && <button className="btn-danger btn-sm" disabled={bulkBusy} onClick={bulkDelete}><Trash2 size={14} /> {tr('حذف', 'Delete')}</button>}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th w-10">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
                <th className="th">{tr('الاسم', 'Name')}</th>
                <th className="th">{tr('الموبايل', 'Phone')}</th>
                <th className="th">{tr('الخدمة', 'Service')}</th>
                <th className="th">{tr('المصدر', 'Source')}</th>
                <th className="th">{tr('المرحلة', 'Stage')}</th>
                {viewAll && <th className="th">{tr('المسؤول', 'Owner')}</th>}
                <th className="th">{tr('المتابعة القادمة', 'Next follow-up')}</th>
                <th className="th">{tr('أُضيف', 'Added')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-16"><Spinner className="mx-auto h-7 w-7" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9}><Empty text={tr('مفيش ليدز بالفلاتر دي', 'No leads match these filters')} icon={Users} /></td></tr>
              ) : rows.map((r) => {
                const late = r.next_followup_at && new Date(r.next_followup_at).getTime() < Date.now();
                const wa = waLink(r.phone);
                return (
                  <tr key={r.id} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected.has(r.id) ? 'bg-indigo-50/50' : ''}`}
                    onClick={() => openLead(r.id, refreshSilently)}>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">{r.full_name}</span>
                        <Link href={`/leads/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-slate-300 hover:text-indigo-600"
                          title={tr('الصفحة الكاملة', 'Full page')}>
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                      {r.company && <div className="text-xs text-slate-400">{r.company}</div>}
                    </td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      {r.phone ? (
                        <div className="flex items-center gap-2">
                          <span dir="ltr" className="tabular-nums">{r.phone}</span>
                          <a href={`tel:${r.phone}`} className="text-slate-400 hover:text-indigo-600"><Phone size={14} /></a>
                          {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-emerald-600"><MessageCircle size={14} /></a>}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="td text-xs">{r.service ? L(findOpt(SERVICES, r.service)) : '—'}</td>
                    <td className="td text-xs">{r.source ? L(findOpt(SOURCES, r.source)) : '—'}</td>
                    <td className="td"><StageBadge status={r.status} /></td>
                    {viewAll && (
                      <td className="td text-xs">
                        {r.assignee?.full_name ?? (
                          <span className="text-amber-600">
                            {r.in_pool ? tr('في انتظار التوزيع', 'Waiting for distribution') : tr('غير موزع', 'Unassigned')}
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`td text-xs ${late ? 'font-bold text-rose-600' : ''}`}>{r.next_followup_at ? fromNow(r.next_followup_at) : '—'}</td>
                    <td className="td text-xs text-slate-500">{fmtDateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">{tr(`صفحة ${page} من ${pages}`, `Page ${page} of ${pages}`)}</span>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronRight size={14} className="ltr:rotate-180" /> {tr('السابق', 'Previous')}
              </button>
              <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {tr('التالي', 'Next')} <ChevronLeft size={14} className="ltr:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </div>

      <AddLeadModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={load} />
      <AssignModal open={showAssign} onClose={() => setShowAssign(false)} leadIds={[...selected]} onDone={load} />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}
