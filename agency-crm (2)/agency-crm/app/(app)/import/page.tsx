'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { NoAccess, UserPicker } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES, STAGES } from '@/lib/constants';
import {
  BASIC_KEYS, FIELDS, clean, guessMap, makeOwnerMatcher, parseDate, parseStatus, uuid, yesterday, type FieldKey,
} from '@/lib/import-utils';
import { fmtNum, normalizePhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type Row = Record<string, unknown>;

type Prepared = {
  id: string;
  lead: Record<string, unknown>;
  comment: string;
  owner: string | null;
  ownerRaw: string;
  worked: boolean;
  date: Date | null;
  followup: Date | null;
};

export default function ImportPage() {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [defSource, setDefSource] = useState('');
  const [defService, setDefService] = useState('');
  const [keepExtra, setKeepExtra] = useState(true);
  const [mode, setMode] = useState<'pool' | 'now' | 'hold'>('pool');
  const [users, setUsers] = useState<string[]>([]);
  const [leadsState, setLeadsState] = useState<'new' | 'worked'>('new');
  const [workedStage, setWorkedStage] = useState('contacted');
  const [workedDate, setWorkedDate] = useState(yesterday);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    total: number; inserted: number; dupFile: number; dupDb: number; skipped: number;
    assigned: number; comments: number; followups: number; worked: number; warnings: string[];
  } | null>(null);

  const canAssign = can(profile, 'assign');
  const canEditAll = can(profile, 'edit_all');
  const matchOwner = useMemo(() => makeOwnerMatcher(team), [team]);

  // تجهيز الصفوف (بيتحسب تاني لما الإعدادات تتغير)
  const prepared = useMemo(() => {
    const out: Prepared[] = [];
    let dupFile = 0;
    let skipped = 0;
    if (step !== 2 && !running) return { out, dupFile, skipped };
    const mapped = new Set(Object.values(map).filter(Boolean));
    const seen = new Set<string>();
    const fallbackDate = workedDate ? new Date(`${workedDate}T12:00:00`) : null;

    for (const r of rows) {
      const lead: Record<string, unknown> = {};
      for (const k of BASIC_KEYS) {
        const col = map[k];
        const v = col ? clean(r[col]) : '';
        lead[k] = v || null;
      }
      if (!lead.full_name && !lead.phone) { skipped++; continue; }
      if (!lead.full_name) lead.full_name = lead.phone;
      const np = normalizePhone(lead.phone as string | null);
      if (np) {
        if (seen.has(np)) { dupFile++; continue; }
        seen.add(np);
      }
      lead.source = lead.source || defSource || null;
      lead.service = lead.service || defService || null;

      const extra: Record<string, string> = {};
      if (keepExtra) {
        for (const h of headers) {
          if (mapped.has(h)) continue;
          const v = clean(r[h]);
          if (v) extra[h] = v;
        }
      }
      lead.extra = extra;

      const rawStatus = map.status ? clean(r[map.status]) : '';
      const parsed = rawStatus ? parseStatus(rawStatus) : null;
      let status = parsed ?? (leadsState === 'worked' ? workedStage : 'new');
      if (rawStatus && !parsed && leadsState === 'new') status = 'contacted'; // فيه حالة مكتوبة = اتشغل عليه
      const worked = status !== 'new';
      const rowDate = map.created_date ? parseDate(r[map.created_date]) : null;
      const date = rowDate && rowDate.getTime() <= Date.now() ? rowDate : worked ? fallbackDate : null;

      const ownerRaw = map.owner && canAssign ? clean(r[map.owner]) : '';
      const owner = ownerRaw ? matchOwner(ownerRaw) : null;

      out.push({
        id: uuid(),
        lead: { ...lead, status },
        comment: map.comment ? clean(r[map.comment]) : '',
        owner,
        ownerRaw,
        worked,
        date,
        followup: map.followup_date ? parseDate(r[map.followup_date]) : null,
      });
    }
    return { out, dupFile, skipped };
  }, [step, running, rows, map, headers, keepExtra, defSource, defService, leadsState, workedStage, workedDate, canAssign, matchOwner]);

  const summary = useMemo(() => {
    const p = prepared.out;
    const unknownOwners = new Map<string, number>();
    const perOwner = new Map<string, number>();
    p.forEach((x) => {
      if (x.ownerRaw && !x.owner) unknownOwners.set(x.ownerRaw, (unknownOwners.get(x.ownerRaw) ?? 0) + 1);
      if (x.owner) perOwner.set(x.owner, (perOwner.get(x.owner) ?? 0) + 1);
    });
    return {
      total: p.length,
      worked: p.filter((x) => x.worked).length,
      withComment: p.filter((x) => x.comment).length,
      withFollowup: p.filter((x) => x.followup).length,
      withOwner: p.filter((x) => x.owner).length,
      perOwner,
      unknownOwners,
    };
  }, [prepared]);

  if (!can(profile, 'import')) return <NoAccess />;

  async function onFile(f: File) {
    try {
      const XLSX = await import('xlsx');
      const isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
      const wb = isCsv
        ? XLSX.read(await f.text(), { type: 'string', raw: true })
        : XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const head = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })[0] ?? [])
        .map((h) => clean(h)).filter(Boolean);
      const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: '', raw: true });
      if (!data.length || !head.length) return toast.error(tr('الشيت فاضي', 'The sheet is empty'));
      setHeaders(head);
      setRows(data);
      setMap(guessMap(head));
      setFileName(f.name);
      setStep(2);
    } catch (e) {
      toast.error(tr('مقدرناش نقرا الملف: ', "Couldn't read the file: ") + (e as Error).message);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      FIELDS.map((f) => f.ar.replace(/^[^\p{L}]+/u, '')),
      ['أحمد محمد', '01012345678', 'ahmed@mail.com', 'براند X', 'مدير تسويق', 'إعلانات ممولة', 'Meta Ads', 'Ramadan Campaign', '20,000', 'القاهرة',
        'طالب عرض سعر لإدارة الصفحات', team.find((u) => u.role === 'sales')?.full_name ?? 'اسم السيلز', 'مهتم', '20/10/2026 11:00', '01/10/2026'],
    ]);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, 'leads-template.xlsx');
  }

  async function runImport() {
    if (!map.full_name && !map.phone) return toast.error(tr('لازم تحدد عمود الاسم أو الموبايل', 'Map the name or phone column'));
    const needsUsers = mode === 'now' && prepared.out.some((x) => !x.owner);
    if (needsUsers && !users.length) return toast.error(tr('اختار السيلز اللي هتتوزع عليهم الليدز', 'Choose reps to assign the leads to'));
    if (leadsState === 'worked' && !workedDate) return toast.error(tr('حدد تاريخ الليدز القديمة', 'Set a date for the older leads'));
    setRunning(true);
    setProgress(0);
    const warnings: string[] = [];
    const items = prepared.out;

    const { data: batch } = await supabase.from('import_batches').insert({ file_name: fileName, total_rows: rows.length }).select('id').single();
    const batchId = (batch as { id: string } | null)?.id ?? null;

    // الليدز القديمة من غير سيلز + "وزّعهم دلوقتي": بتتوزع بالدور بهدوء (من غير إشعار "ليد جديد")
    let rr = 0;
    for (const x of items) {
      if (!x.owner && x.worked && mode === 'now' && users.length) {
        x.owner = users[rr % users.length];
        rr++;
      }
    }

    // 1) الليدز
    const payload = items.map((x) => {
      const iso = x.date ? x.date.toISOString() : undefined;
      const row: Record<string, unknown> = { ...x.lead, id: x.id, import_batch_id: batchId };
      if (iso) row.created_at = iso;
      if (x.worked && iso) {
        row.first_contact_at = iso;
        row.last_activity_at = iso;
      }
      if (x.owner && x.worked) {
        // ليد قديم ليه سيلز: يتسجل باسمه بهدوء (من غير إشعار "ليد جديد" ومن غير ما يتحسب من الحد اليومي)
        row.assigned_to = x.owner;
        row.assigned_at = iso ?? null;
        row.in_pool = false;
      } else if (x.owner) {
        row.assigned_to = null;
        row.in_pool = false; // هيتوزع عليه بعد الإضافة مع إشعار
      } else {
        row.assigned_to = null;
        row.in_pool = mode === 'pool' && !x.worked;
      }
      return row;
    });

    const inserted = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('leads')
        .upsert(chunk, { onConflict: 'phone_normalized', ignoreDuplicates: true })
        .select('id');
      if (error) {
        toast.error(tr('حصل خطأ أثناء الاستيراد: ', 'Import error: ') + error.message);
        setRunning(false);
        return;
      }
      ((data as { id: string }[]) ?? []).forEach((d) => inserted.add(d.id));
      setProgress(Math.round(((i + chunk.length) / Math.max(payload.length, 1)) * 70));
    }
    const done = items.filter((x) => inserted.has(x.id));

    // 2) التعليقات
    let comments = 0;
    const notes = done.filter((x) => x.comment).map((x) => ({
      lead_id: x.id, user_id: profile.id, body: x.comment, source: 'import',
      ...(x.worked && x.date ? { created_at: x.date.toISOString() } : {}),
    }));
    for (let i = 0; i < notes.length; i += CHUNK) {
      const { error } = await supabase.from('lead_notes').insert(notes.slice(i, i + CHUNK));
      if (error) { warnings.push(tr('التعليقات: ', 'Comments: ') + error.message); break; }
      comments += Math.min(CHUNK, notes.length - i);
    }
    setProgress(80);

    // 3) المتابعات
    let followups = 0;
    const fus = done.filter((x) => x.followup).map((x) => {
      const ownerNow = x.owner && x.worked ? x.owner : null;
      return {
        lead_id: x.id,
        user_id: ownerNow && (ownerNow === profile.id || canEditAll) ? ownerNow : profile.id,
        due_at: x.followup!.toISOString(),
        type: 'call',
        note: x.comment ? x.comment.slice(0, 200) : null,
      };
    });
    for (let i = 0; i < fus.length; i += CHUNK) {
      const { error } = await supabase.from('followups').insert(fus.slice(i, i + CHUNK));
      if (error) { warnings.push(tr('المتابعات: ', 'Follow-ups: ') + error.message); break; }
      followups += Math.min(CHUNK, fus.length - i);
    }
    setProgress(88);

    // 4) التوزيع (مع إشعار) — الليدز الجديدة اللي ليها سيلز في الشيت، أو "وزّعهم دلوقتي"
    let assigned = done.filter((x) => x.owner && x.worked).length;
    const groups = new Map<string, string[]>();
    done.filter((x) => x.owner && !x.worked).forEach((x) => groups.set(x.owner!, [...(groups.get(x.owner!) ?? []), x.id]));
    for (const [uid, ids] of groups) {
      for (let i = 0; i < ids.length; i += 1000) {
        const { error } = await supabase.rpc('assign_leads', { p_lead_ids: ids.slice(i, i + 1000), p_user_ids: [uid] });
        if (error) warnings.push(error.message); else assigned += Math.min(1000, ids.length - i);
      }
    }
    if (mode === 'now' && users.length) {
      const rest = done.filter((x) => !x.owner).map((x) => x.id);
      for (let i = 0; i < rest.length; i += 1000) {
        const { error } = await supabase.rpc('assign_leads', { p_lead_ids: rest.slice(i, i + 1000), p_user_ids: users });
        if (error) warnings.push(error.message); else assigned += Math.min(1000, rest.length - i);
      }
    }

    const dupDb = items.length - done.length;
    if (batchId) await supabase.from('import_batches').update({ inserted: done.length, duplicates: dupDb + prepared.dupFile }).eq('id', batchId);

    setResult({
      total: rows.length, inserted: done.length, dupFile: prepared.dupFile, dupDb, skipped: prepared.skipped,
      assigned, comments, followups, worked: done.filter((x) => x.worked).length, warnings,
    });
    setProgress(100);
    setRunning(false);
    setStep(3);
  }

  function reset() {
    setStep(1); setRows([]); setHeaders([]); setResult(null); setProgress(0); setUsers([]);
  }

  const preview = rows.slice(0, 5);
  const activeUsers = team.filter((u) => u.is_active);
  const nameOf = (id: string) => team.find((u) => u.id === id)?.full_name ?? id;
  const visibleFields = FIELDS.filter((f) => f.key !== 'owner' || canAssign);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{tr('استيراد ليدز من شيت', 'Import leads from a sheet')}</h1>
          <p className="text-sm text-slate-500">{tr('Excel أو CSV — من Meta Lead Ads أو Google Sheets أو أي شيت', 'Excel or CSV — from Meta Lead Ads, Google Sheets, or any sheet')}</p>
        </div>
        <button className="btn-secondary" onClick={downloadTemplate}><Download size={16} /> {tr('تحميل نموذج شيت', 'Download template')}</button>
      </div>

      <div className="flex gap-2 text-xs font-bold">
        {[tr('رفع الملف', 'Upload'), tr('ربط الأعمدة', 'Map columns'), tr('النتيجة', 'Result')].map((t, i) => (
          <div key={t} className={`flex-1 rounded-full py-1.5 text-center ${step >= i + 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            {i + 1}. {t}
          </div>
        ))}
      </div>

      {step === 1 && (
        <label
          className="card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed p-12 text-center hover:border-indigo-400"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        >
          <FileSpreadsheet size={48} className="text-indigo-500" />
          <div className="font-bold">{tr('اسحب الملف هنا أو دوس للاختيار', 'Drop the file here or click to choose')}</div>
          <div className="text-xs text-slate-400">
            {tr('.xlsx · .xls · .csv — من Google Sheets: File ← Download ← Excel أو CSV', '.xlsx · .xls · .csv — from Google Sheets: File → Download → Excel or CSV')}
          </div>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </label>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">{tr('ربط أعمدة الشيت', 'Map sheet columns')}</h2>
              <span className="text-xs text-slate-500">{fileName} · {fmtNum(rows.length)} {tr('صف', 'rows')}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleFields.map((f) => (
                <div key={f.key}>
                  <label className="label">{L(f)}</label>
                  <select className={`input ${map[f.key] ? 'border-emerald-300 bg-emerald-50/40' : ''}`} value={map[f.key] ?? ''}
                    onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                    <option value="">{tr('— تجاهل —', '— Skip —')}</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto p-4">
            <h2 className="mb-2 font-bold">{tr('معاينة أول 5 صفوف', 'Preview — first 5 rows')}</h2>
            <table className="w-full min-w-[600px] text-xs">
              <thead><tr>{visibleFields.filter((f) => map[f.key]).map((f) => <th key={f.key} className="th">{L(f)}</th>)}</tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {visibleFields.filter((f) => map[f.key]).map((f) => <td key={f.key} className="td text-xs">{clean(r[map[f.key]])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* حالة الليدز — جديدة ولا اتشغل عليها */}
          <div className="card space-y-3 p-4">
            <h2 className="font-bold">{tr('حالة الليدز في الشيت', 'Lead status in this sheet')}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${leadsState === 'new' ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                <input type="radio" className="mt-1 accent-indigo-600" checked={leadsState === 'new'} onChange={() => setLeadsState('new')} />
                <span className="text-sm"><b>{tr('ليدز جديدة', 'New leads')}</b><br />
                  <span className="text-xs text-slate-500">{tr('محدش كلمها لسه', 'Nobody has contacted them yet')}</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${leadsState === 'worked' ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                <input type="radio" className="mt-1 accent-indigo-600" checked={leadsState === 'worked'} onChange={() => setLeadsState('worked')} />
                <span className="text-sm"><b>{tr('اتشغل عليها قبل كده (فولو أب)', 'Already worked on (follow-up)')}</b><br />
                  <span className="text-xs text-slate-500">
                    {tr('مش هتظهر للسيلز كليدز جديدة، ومن غير إشعار «ليد جديد»', "Won't show as new leads, and no “new lead” alert")}
                  </span></span>
              </label>
            </div>
            {leadsState === 'worked' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">{tr('المرحلة (للصفوف اللي مفيهاش حالة)', 'Stage (for rows without a status)')}</label>
                  <select className="input" value={workedStage} onChange={(e) => setWorkedStage(e.target.value)}>
                    {STAGES.filter((s) => s.value !== 'new').map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{tr('تاريخ الليدز (لو مش موجود في الشيت)', 'Lead date (if not in the sheet)')}</label>
                  <input type="date" className="input" dir="ltr" max={new Date().toISOString().slice(0, 10)} value={workedDate} onChange={(e) => setWorkedDate(e.target.value)} />
                </div>
              </div>
            )}
            {map.status && (
              <p className="text-xs text-slate-500">
                {tr('عمود الحالة متربط — كل صف هياخد حالته من الشيت (جديد، مهتم، فولو أب، اجتماع…).', 'Status column mapped — each row takes its own status from the sheet (new, interested, follow-up, meeting…).')}
              </p>
            )}
          </div>

          <div className="card grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-3">
              <h2 className="font-bold">{tr('قيم افتراضية', 'Defaults')}</h2>
              <div>
                <label className="label">{tr('المصدر (لو مش موجود في الشيت)', 'Source (if not in the sheet)')}</label>
                <select className="input" value={defSource} onChange={(e) => setDefSource(e.target.value)}>
                  <option value="">—</option>{SOURCES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{tr('الخدمة (لو مش موجودة في الشيت)', 'Service (if not in the sheet)')}</label>
                <select className="input" value={defService} onChange={(e) => setDefService(e.target.value)}>
                  <option value="">—</option>{SERVICES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-indigo-600" checked={keepExtra} onChange={(e) => setKeepExtra(e.target.checked)} />
                {tr('احفظ باقي الأعمدة كبيانات إضافية في الليد', 'Keep other columns as extra lead data')}
              </label>
            </div>
            <div className="space-y-3">
              <h2 className="font-bold">{tr('التوزيع', 'Assignment')}</h2>
              {map.owner && canAssign && (
                <p className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
                  {tr('الصفوف اللي فيها سيلز معروف هتروح له مباشرة. الاختيار ده للصفوف الباقية:', 'Rows with a recognized rep go straight to them. This choice is for the rest:')}
                </p>
              )}
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'pool'} onChange={() => setMode('pool')} />
                  <span><b>{tr('يدخلوا التوزيع التلقائي', 'Send to auto distribution')}</b><br />
                    <span className="text-xs text-slate-500">
                      {tr('هيتوزعوا دفعات حسب الإعدادات (الليدز القديمة هتفضل غير موزعة)', 'Distributed in batches per settings (older leads stay unassigned)')}
                    </span></span></label>
                {canAssign && (
                  <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'now'} onChange={() => setMode('now')} />
                    <span><b>{tr('وزّعهم دلوقتي', 'Assign now')}</b><br />
                      <span className="text-xs text-slate-500">{tr('بالتساوي على السيلز اللي هتختارهم', 'Evenly across the reps you pick')}</span></span></label>
                )}
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'hold'} onChange={() => setMode('hold')} />
                  <span><b>{tr('سيبهم من غير توزيع', 'Keep unassigned')}</b><br />
                    <span className="text-xs text-slate-500">{tr('توزعهم بإيدك بعدين من صفحة الليدز', 'Assign them manually later from Leads')}</span></span></label>
              </div>
              {mode === 'now' && <UserPicker users={activeUsers} value={users} onChange={setUsers} />}
            </div>
          </div>

          {/* ملخص قبل الاستيراد */}
          <div className="card space-y-2 p-4 text-sm">
            <h2 className="font-bold">{tr('ملخص قبل الاستيراد', 'Summary before import')}</h2>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-lg bg-slate-100 px-2 py-1">{fmtNum(summary.total)} {tr('ليد', 'leads')}</span>
              <span className="rounded-lg bg-sky-50 px-2 py-1 text-sky-700">{fmtNum(summary.total - summary.worked)} {tr('جديد', 'new')}</span>
              <span className="rounded-lg bg-indigo-50 px-2 py-1 text-indigo-700">{fmtNum(summary.worked)} {tr('اتشغل عليه', 'worked on')}</span>
              {map.comment && <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">{fmtNum(summary.withComment)} {tr('بتعليق', 'with comments')}</span>}
              {map.followup_date && <span className="rounded-lg bg-violet-50 px-2 py-1 text-violet-700">{fmtNum(summary.withFollowup)} {tr('بميعاد متابعة', 'with follow-up date')}</span>}
              {map.owner && canAssign && <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">{fmtNum(summary.withOwner)} {tr('ليهم سيلز', 'with a rep')}</span>}
            </div>
            {summary.perOwner.size > 0 && (
              <div className="text-xs text-slate-600">
                {[...summary.perOwner.entries()].map(([id, n]) => `${nameOf(id)}: ${n}`).join(' · ')}
              </div>
            )}
            {summary.unknownOwners.size > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {tr('أسماء سيلز مش متعرّف عليها (هتمشي حسب اختيار التوزيع): ', 'Unrecognized rep names (will follow the assignment choice): ')}
                  {[...summary.unknownOwners.entries()].slice(0, 12).map(([k, n]) => `«${k}» (${n})`).join('، ')}
                  <br />{tr('اكتب اسم السيلز في الشيت زي ما هو في السيستم بالظبط، أو الإيميل بتاعه.', 'Write the rep name exactly as in the system, or their email.')}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button className="btn-secondary" onClick={reset} disabled={running}>{tr('رجوع', 'Back')}</button>
            <div className="flex items-center gap-3">
              {running && (
                <div className="w-40">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-1 text-center text-xs text-slate-500">{progress}%</div>
                </div>
              )}
              <button className="btn-primary" onClick={runImport} disabled={running}>
                <Upload size={16} /> {running ? tr('جاري الاستيراد…', 'Importing…') : tr(`استيراد ${fmtNum(summary.total)} ليد`, `Import ${fmtNum(summary.total)} leads`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="card space-y-5 p-8 text-center">
          <CheckCircle2 size={56} className="mx-auto text-emerald-500" />
          <h2 className="text-xl font-bold">{tr('تم الاستيراد', 'Import complete')}</h2>
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tr('اتضاف', 'Added')} value={result.inserted} tone="text-emerald-600" />
            <Stat label={tr('مكرر في السيستم', 'Already in system')} value={result.dupDb} tone="text-amber-600" />
            <Stat label={tr('مكرر في الشيت', 'Duplicate in sheet')} value={result.dupFile} tone="text-amber-600" />
            <Stat label={tr('صفوف فاضية', 'Empty rows')} value={result.skipped} tone="text-slate-500" />
            <Stat label={tr('اتشغل عليها (مش جديدة)', 'Worked on (not new)')} value={result.worked} tone="text-indigo-600" />
            <Stat label={tr('اتوزعت', 'Assigned')} value={result.assigned} tone="text-indigo-600" />
            <Stat label={tr('تعليقات', 'Comments')} value={result.comments} tone="text-amber-700" />
            <Stat label={tr('متابعات', 'Follow-ups')} value={result.followups} tone="text-violet-600" />
          </div>
          {result.warnings.length > 0 && (
            <div className="mx-auto max-w-2xl rounded-xl bg-amber-50 p-3 text-start text-xs text-amber-800">
              {result.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}
          <div className="flex justify-center gap-2">
            <button className="btn-secondary" onClick={reset}>{tr('استيراد ملف تاني', 'Import another file')}</button>
            <Link href="/leads" className="btn-primary">{tr('عرض الليدز', 'View leads')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className={`text-2xl font-extrabold ${tone}`}>{fmtNum(value)}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
