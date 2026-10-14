'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, MessageCircle, Phone, Plus, Search, Trash2, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { AddLeadModal, AssignModal } from '@/components/LeadModals';
import { Empty, Spinner, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES, STAGES } from '@/lib/constants';
import { fmtDateTime, fmtNum, fromNow, waLink } from '@/lib/format';
import { EMPTY_FILTERS, buildLeadsQuery, exportLeadsXlsx, type LeadFilters } from '@/lib/leads';
import type { Lead } from '@/lib/types';

const PAGE = 50;

function LeadsInner() {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const sp = useSearchParams();
  const viewAll = can(profile, 'view_all');
  const canAssign = can(profile, 'assign');
  const canExport = can(profile, 'export');
  const canDelete = can(profile, 'delete');

  const [filters, setFilters] = useState<LeadFilters>({
    ...EMPTY_FILTERS,
    status: sp.get('status') ?? '',
    assigned: sp.get('assigned') ?? '',
    followup: sp.get('followup') ?? '',
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

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, count, error } = await buildLeadsQuery(supabase, filters, profile.id, true).range((page - 1) * PAGE, page * PAGE - 1);
    if (error) toast.error(error.message);
    setRows((data as Lead[]) ?? []);
    setCount(count ?? 0);
    setSelected(new Set());
    setLoading(false);
  }, [supabase, filters, page, profile.id]);

  useEffect(() => { load(); }, [load]);

  const setF = (k: keyof LeadFilters) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function bulkStatus(status: string) {
    if (!status) return;
    const ids = [...selected];
    const { error } = await supabase.from('leads').update({ status }).in('id', ids);
    if (error) return toast.error(error.message);
    toast.success(`تم تحديث ${ids.length} ليد`);
    load();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!confirm(`متأكد إنك عاوز تحذف ${ids.length} ليد؟ مفيش رجوع.`)) return;
    const { error } = await supabase.from('leads').delete().in('id', ids);
    if (error) return toast.error(error.message);
    toast.success('تم الحذف');
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
      await exportLeadsXlsx(all, team);
      toast.success(`تم تصدير ${all.length} ليد`);
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
          <h1 className="page-title">الليدز</h1>
          <p className="text-sm text-slate-500">{fmtNum(count)} ليد</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(profile, 'import') && <Link href="/import" className="btn-secondary"><Upload size={16} /> استيراد</Link>}
          {canExport && (
            <button className="btn-secondary" disabled={exporting} onClick={() => exportRows(false)}>
              {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} تصدير Excel
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> ليد جديد</button>
        </div>
      </div>

      <div className="card grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative lg:col-span-2">
          <Search size={16} className="absolute right-3 top-2.5 text-slate-400" />
          <input className="input pr-9" placeholder="بحث بالاسم، الرقم، الشركة…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select className="input" value={filters.status} onChange={setF('status')}>
          <option value="">كل المراحل</option>{STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="input" value={filters.service} onChange={setF('service')}>
          <option value="">كل الخدمات</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" value={filters.source} onChange={setF('source')}>
          <option value="">كل المصادر</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" value={filters.followup} onChange={setF('followup')}>
          <option value="">كل المتابعات</option>
          <option value="overdue">متابعة متأخرة</option>
          <option value="today">متابعة النهارده</option>
          <option value="none">بدون متابعة</option>
        </select>
        {viewAll ? (
          <select className="input" value={filters.assigned} onChange={setF('assigned')}>
            <option value="">كل السيلز</option>
            <option value="me">ليدزي أنا</option>
            <option value="none">غير موزعة</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        ) : (
          <select className="input" value={filters.sort} onChange={setF('sort')}>
            <option value="created_at">الأحدث</option>
            <option value="next_followup_at">أقرب متابعة</option>
            <option value="last_activity_at">آخر نشاط</option>
          </select>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 border-indigo-200 bg-indigo-50 p-3">
          <span className="text-sm font-bold text-indigo-700">تم تحديد {selected.size}</span>
          <div className="flex-1" />
          {canAssign && <button className="btn-primary btn-sm" onClick={() => setShowAssign(true)}><Users size={14} /> توزيع / تحويل</button>}
          <select className="input w-auto py-1.5 text-xs" value="" onChange={(e) => bulkStatus(e.target.value)}>
            <option value="">تغيير المرحلة…</option>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {canExport && <button className="btn-secondary btn-sm" onClick={() => exportRows(true)}><Download size={14} /> تصدير المحدد</button>}
          {canDelete && <button className="btn-danger btn-sm" onClick={bulkDelete}><Trash2 size={14} /> حذف</button>}
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
                <th className="th">الاسم</th>
                <th className="th">الموبايل</th>
                <th className="th">الخدمة</th>
                <th className="th">المصدر</th>
                <th className="th">المرحلة</th>
                {viewAll && <th className="th">المسؤول</th>}
                <th className="th">المتابعة القادمة</th>
                <th className="th">أُضيف</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-16"><Spinner className="mx-auto h-7 w-7" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9}><Empty text="مفيش ليدز بالفلاتر دي" icon={Users} /></td></tr>
              ) : rows.map((r) => {
                const late = r.next_followup_at && new Date(r.next_followup_at).getTime() < Date.now();
                const wa = waLink(r.phone);
                return (
                  <tr key={r.id} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected.has(r.id) ? 'bg-indigo-50/50' : ''}`}
                    onClick={() => router.push(`/leads/${r.id}`)}>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="td">
                      <div className="font-bold text-slate-900">{r.full_name}</div>
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
                    <td className="td text-xs">{r.service ?? '—'}</td>
                    <td className="td text-xs">{r.source ?? '—'}</td>
                    <td className="td"><StageBadge status={r.status} /></td>
                    {viewAll && (
                      <td className="td text-xs">
                        {r.assignee?.full_name ?? <span className="text-amber-600">{r.in_pool ? 'في انتظار التوزيع' : 'غير موزع'}</span>}
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
            <span className="text-slate-500">صفحة {page} من {pages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronRight size={14} /> السابق</button>
              <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>التالي <ChevronLeft size={14} /></button>
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
