'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { NoAccess, UserPicker } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES } from '@/lib/constants';
import { fmtNum, normalizePhone } from '@/lib/format';

type Row = Record<string, unknown>;

const FIELDS = [
  { key: 'full_name', label: 'الاسم', guesses: ['full_name', 'full name', 'name', 'الاسم', 'اسم', 'الاسم بالكامل', 'client', 'customer', 'اسم العميل'] },
  { key: 'phone', label: 'الموبايل', guesses: ['phone_number', 'phone', 'mobile', 'phone number', 'رقم', 'رقم الموبايل', 'موبايل', 'الموبايل', 'الهاتف', 'رقم الهاتف', 'تليفون', 'whatsapp', 'واتساب', 'رقم الجوال', 'جوال'] },
  { key: 'email', label: 'الإيميل', guesses: ['email', 'e-mail', 'mail', 'الإيميل', 'الايميل', 'البريد'] },
  { key: 'company', label: 'الشركة / البراند', guesses: ['company', 'company_name', 'business', 'brand', 'الشركة', 'اسم الشركة', 'البراند', 'النشاط'] },
  { key: 'job_title', label: 'المسمى الوظيفي', guesses: ['job_title', 'job title', 'title', 'position', 'الوظيفة', 'المسمى'] },
  { key: 'service', label: 'الخدمة', guesses: ['service', 'services', 'الخدمة', 'خدمة', 'interest', 'الخدمة المطلوبة'] },
  { key: 'source', label: 'المصدر', guesses: ['source', 'platform', 'المصدر', 'مصدر', 'المنصة'] },
  { key: 'campaign', label: 'الحملة', guesses: ['campaign_name', 'campaign', 'ad_name', 'adset_name', 'الحملة', 'اسم الحملة', 'form_name'] },
  { key: 'budget', label: 'الميزانية', guesses: ['budget', 'الميزانية', 'ميزانية'] },
  { key: 'city', label: 'المدينة', guesses: ['city', 'المدينة', 'مدينة', 'country', 'الدولة', 'المحافظة'] },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function guessMap(headers: string[]): Record<FieldKey, string> {
  const used = new Set<string>();
  const map = {} as Record<FieldKey, string>;
  const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, ' ').trim();
  for (const f of FIELDS) {
    const g = f.guesses.map(norm);
    const hit = headers.find((h) => !used.has(h) && g.includes(norm(h)))
      ?? headers.find((h) => !used.has(h) && g.some((x) => x.length > 3 && norm(h).includes(x)));
    map[f.key] = hit ?? '';
    if (hit) used.add(hit);
  }
  return map;
}

export default function ImportPage() {
  const { profile, team } = useApp();
  const supabase = useSupabase();
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
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ total: number; inserted: number; dupFile: number; dupDb: number; skipped: number; assigned: number } | null>(null);

  if (!can(profile, 'import')) return <NoAccess />;
  const canAssign = can(profile, 'assign');

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
      if (!data.length || !head.length) return toast.error('الشيت فاضي');
      setHeaders(head);
      setRows(data);
      setMap(guessMap(head));
      setFileName(f.name);
      setStep(2);
    } catch (e) {
      toast.error('مقدرناش نقرا الملف: ' + (e as Error).message);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      FIELDS.map((f) => f.label),
      ['أحمد محمد', '01012345678', 'ahmed@mail.com', 'براند X', 'مدير تسويق', 'إعلانات ممولة', 'Meta Ads', 'Ramadan Campaign', '20,000', 'القاهرة'],
    ]);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, 'leads-template.xlsx');
  }

  async function runImport() {
    if (!map.full_name && !map.phone) return toast.error('لازم تحدد عمود الاسم أو الموبايل');
    if (mode === 'now' && !users.length) return toast.error('اختار السيلز اللي هتتوزع عليهم الليدز');
    setRunning(true);
    setProgress(0);

    const { data: batch } = await supabase.from('import_batches').insert({ file_name: fileName, total_rows: rows.length }).select('id').single();
    const batchId = (batch as { id: string } | null)?.id ?? null;

    const mapped = new Set(Object.values(map).filter(Boolean));
    const seen = new Set<string>();
    let dupFile = 0;
    let skipped = 0;
    const out: Record<string, unknown>[] = [];

    for (const r of rows) {
      const lead: Record<string, unknown> = {};
      for (const f of FIELDS) {
        const col = map[f.key];
        const v = col ? clean(r[col]) : '';
        lead[f.key] = v || null;
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
      lead.import_batch_id = batchId;
      lead.in_pool = mode === 'pool';
      lead.assigned_to = null;
      out.push(lead);
    }

    const insertedIds: string[] = [];
    const CHUNK = 500;
    for (let i = 0; i < out.length; i += CHUNK) {
      const chunk = out.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('leads')
        .upsert(chunk, { onConflict: 'phone_normalized', ignoreDuplicates: true })
        .select('id');
      if (error) {
        toast.error('حصل خطأ أثناء الاستيراد: ' + error.message);
        setRunning(false);
        return;
      }
      insertedIds.push(...((data as { id: string }[]) ?? []).map((d) => d.id));
      setProgress(Math.round(((i + chunk.length) / Math.max(out.length, 1)) * 100));
    }

    let assigned = 0;
    if (mode === 'now' && insertedIds.length) {
      const { error } = await supabase.rpc('assign_leads', { p_lead_ids: insertedIds, p_user_ids: users });
      if (error) toast.error('اتضافوا بس التوزيع فشل: ' + error.message);
      else assigned = insertedIds.length;
    }

    const dupDb = out.length - insertedIds.length;
    if (batchId) await supabase.from('import_batches').update({ inserted: insertedIds.length, duplicates: dupDb + dupFile }).eq('id', batchId);

    setResult({ total: rows.length, inserted: insertedIds.length, dupFile, dupDb, skipped, assigned });
    setRunning(false);
    setStep(3);
  }

  function reset() {
    setStep(1); setRows([]); setHeaders([]); setResult(null); setProgress(0); setUsers([]);
  }

  const preview = rows.slice(0, 5);
  const activeUsers = team.filter((u) => u.is_active);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">استيراد ليدز من شيت</h1>
          <p className="text-sm text-slate-500">Excel أو CSV — من Meta Lead Ads أو Google Sheets أو أي شيت</p>
        </div>
        <button className="btn-secondary" onClick={downloadTemplate}><Download size={16} /> تحميل نموذج شيت</button>
      </div>

      <div className="flex gap-2 text-xs font-bold">
        {['رفع الملف', 'ربط الأعمدة', 'النتيجة'].map((t, i) => (
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
          <div className="font-bold">اسحب الملف هنا أو دوس للاختيار</div>
          <div className="text-xs text-slate-400">.xlsx · .xls · .csv — من Google Sheets: File ← Download ← Excel أو CSV</div>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </label>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">ربط أعمدة الشيت</h2>
              <span className="text-xs text-slate-500">{fileName} · {fmtNum(rows.length)} صف</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <select className={`input ${map[f.key] ? 'border-emerald-300 bg-emerald-50/40' : ''}`} value={map[f.key] ?? ''}
                    onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                    <option value="">— تجاهل —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto p-4">
            <h2 className="mb-2 font-bold">معاينة أول 5 صفوف</h2>
            <table className="w-full min-w-[600px] text-xs">
              <thead><tr>{FIELDS.filter((f) => map[f.key]).map((f) => <th key={f.key} className="th">{f.label}</th>)}</tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {FIELDS.filter((f) => map[f.key]).map((f) => <td key={f.key} className="td text-xs">{clean(r[map[f.key]])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-3">
              <h2 className="font-bold">قيم افتراضية</h2>
              <div>
                <label className="label">المصدر (لو مش موجود في الشيت)</label>
                <select className="input" value={defSource} onChange={(e) => setDefSource(e.target.value)}>
                  <option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الخدمة (لو مش موجودة في الشيت)</label>
                <select className="input" value={defService} onChange={(e) => setDefService(e.target.value)}>
                  <option value="">—</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-indigo-600" checked={keepExtra} onChange={(e) => setKeepExtra(e.target.checked)} />
                احفظ باقي الأعمدة كبيانات إضافية في الليد
              </label>
            </div>
            <div className="space-y-3">
              <h2 className="font-bold">التوزيع</h2>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'pool'} onChange={() => setMode('pool')} />
                  <span><b>يدخلوا التوزيع التلقائي</b><br /><span className="text-xs text-slate-500">هيتوزعوا دفعات حسب الإعدادات</span></span></label>
                {canAssign && (
                  <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'now'} onChange={() => setMode('now')} />
                    <span><b>وزّعهم دلوقتي</b><br /><span className="text-xs text-slate-500">بالتساوي على السيلز اللي هتختارهم</span></span></label>
                )}
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-indigo-600" checked={mode === 'hold'} onChange={() => setMode('hold')} />
                  <span><b>سيبهم من غير توزيع</b><br /><span className="text-xs text-slate-500">توزعهم بإيدك بعدين من صفحة الليدز</span></span></label>
              </div>
              {mode === 'now' && <UserPicker users={activeUsers} value={users} onChange={setUsers} />}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button className="btn-secondary" onClick={reset} disabled={running}>رجوع</button>
            <div className="flex items-center gap-3">
              {running && (
                <div className="w-40">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-1 text-center text-xs text-slate-500">{progress}%</div>
                </div>
              )}
              <button className="btn-primary" onClick={runImport} disabled={running}><Upload size={16} /> {running ? 'جاري الاستيراد…' : `استيراد ${fmtNum(rows.length)} صف`}</button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="card space-y-5 p-8 text-center">
          <CheckCircle2 size={56} className="mx-auto text-emerald-500" />
          <h2 className="text-xl font-bold">تم الاستيراد</h2>
          <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="اتضاف" value={result.inserted} tone="text-emerald-600" />
            <Stat label="مكرر في السيستم" value={result.dupDb} tone="text-amber-600" />
            <Stat label="مكرر في الشيت" value={result.dupFile} tone="text-amber-600" />
            <Stat label="صفوف فاضية" value={result.skipped} tone="text-slate-500" />
          </div>
          {result.assigned > 0 && <p className="text-sm text-slate-600">اتوزع {fmtNum(result.assigned)} ليد على {users.length} سيلز ✅</p>}
          <div className="flex justify-center gap-2">
            <button className="btn-secondary" onClick={reset}>استيراد ملف تاني</button>
            <Link href="/leads" className="btn-primary">عرض الليدز</Link>
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
