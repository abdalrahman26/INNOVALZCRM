'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File as FileIcon, FileText, ImageIcon, Paperclip, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { Spinner } from './ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type LeadFile = {
  id: string; kind: string; file_name: string; mime_type: string | null; size_bytes: number;
  user_id: string | null; created_at: string;
};
type Upload = { key: string; name: string; pct: number; error?: string };

const KINDS = [
  { value: 'quote', ar: 'عرض سعر', en: 'Quote' },
  { value: 'image', ar: 'صورة', en: 'Image' },
  { value: 'contract', ar: 'عقد', en: 'Contract' },
  { value: 'other', ar: 'ملف تاني', en: 'Other' },
];
const KIND_TONE: Record<string, string> = {
  quote: 'bg-cyan-50 text-cyan-700', image: 'bg-violet-50 text-violet-700', contract: 'bg-emerald-50 text-emerald-700', other: 'bg-slate-100 text-slate-600',
};

export const fmtSize = (b: number) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isImage = (m: string | null) => !!m && /^image\/(png|jpe?g|gif|webp|avif)$/.test(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ApiErr = { ar?: string; en?: string; retry_after?: number };

/** رفع جزء مع نسبة التقدم */
function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void) {
  return new Promise<{ status: number; body: ApiErr & { ok?: boolean } }>((resolve) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => { let body = {}; try { body = JSON.parse(x.responseText); } catch { /* */ } resolve({ status: x.status, body }); };
    x.onerror = () => resolve({ status: 0, body: {} });
    x.send(blob);
  });
}

/** ملفات العميل: عروض أسعار، صور، عقود — بتتخزن على تليجرام */
export default function LeadFiles({
  leadId, leadStatus, onChanged, bare = false,
}: { leadId: string; leadStatus?: string; onChanged?: () => void; bare?: boolean }) {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const { tr, L, lang } = useI18n();
  const [files, setFiles] = useState<LeadFile[] | null>(null);
  const [kind, setKind] = useState(leadStatus === 'quote_requested' || leadStatus === 'proposal' ? 'quote' : 'other');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [missing, setMissing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canDeleteAll = can(profile, 'edit_all');
  const pick = (e: ApiErr) => (lang === 'en' ? e.en : e.ar) || tr('حصل خطأ', 'Something went wrong');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lead_files')
      .select('id, kind, file_name, mime_type, size_bytes, user_id, created_at')
      .eq('lead_id', leadId).eq('status', 'ready').order('created_at', { ascending: false });
    setMissing(!!error && /lead_files/.test(error.message));
    setFiles((data as LeadFile[]) ?? []);
  }, [supabase, leadId]);
  useEffect(() => { load(); }, [load]);

  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function uploadOne(file: File, k: string) {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
    const start = await fetch('/api/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, file_name: file.name, mime_type: file.type, size_bytes: file.size, kind: k }),
    });
    const s = (await start.json().catch(() => ({}))) as ApiErr & { ok?: boolean; id?: string; parts?: number; chunk?: number };
    if (!start.ok || !s.id) { patch(key, { error: pick(s) }); return false; }

    for (let i = 0; i < s.parts!; i++) {
      const from = i * s.chunk!;
      const blob = file.slice(from, Math.min(from + s.chunk!, file.size));
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        const r = await putPart(`/api/files/${s.id}/part?i=${i}`, blob, (loaded) => patch(key, { pct: Math.min(99, Math.round(((from + loaded) / file.size) * 100)) }));
        if (r.status === 200) { ok = true; break; }
        if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 409 || attempt === 4) { patch(key, { error: pick(r.body) }); return false; }
        await sleep(((r.body.retry_after ?? 0) + attempt * 2) * 1000); // تليجرام أو الشبكة — نستنى ونعيد
      }
    }
    const fin = await fetch(`/api/files/${s.id}/finish`, { method: 'POST' });
    if (!fin.ok) { patch(key, { error: pick(await fin.json().catch(() => ({}))) }); return false; }
    setUploads((u) => u.filter((x) => x.key !== key));
    return true;
  }

  async function uploadAll(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;
    let okCount = 0;
    let quote = false;
    for (const f of arr) {
      const k = kind === 'other' && f.type.startsWith('image/') ? 'image' : kind;
      if (await uploadOne(f, k)) { okCount++; if (k === 'quote') quote = true; }
    }
    if (okCount) {
      await load();
      onChanged?.();
      if (quote && leadStatus === 'quote_requested') {
        toast.success(tr('اترفع عرض السعر 📄', 'Quote uploaded 📄'), {
          description: tr('تحب تنقل العميل لـ «تم إرسال عرض»؟', 'Move the client to “Proposal sent”?'),
          duration: 10000,
          action: {
            label: tr('انقله', 'Move'),
            onClick: async () => {
              const { error } = await supabase.from('leads').update({ status: 'proposal' }).eq('id', leadId);
              if (error) toast.error(error.message); else { toast.success(tr('اتنقل لـ «تم إرسال عرض»', 'Moved to “Proposal sent”')); onChanged?.(); }
            },
          },
        });
      } else {
        toast.success(okCount > 1 ? tr(`اترفع ${okCount} ملفات`, `${okCount} files uploaded`) : tr('اترفع الملف', 'File uploaded'));
      }
    }
  }

  async function remove(f: LeadFile) {
    if (!confirm(tr(`تمسح «${f.file_name}»؟`, `Delete “${f.file_name}”?`))) return;
    const r = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    if (!r.ok) return toast.error(pick(await r.json().catch(() => ({}))));
    toast.success(tr('اتمسح الملف', 'File deleted'));
    load();
    onChanged?.();
  }

  const nameOf = (id: string | null) => team.find((u) => u.id === id)?.full_name ?? '';
  const images = (files ?? []).filter((f) => isImage(f.mime_type));
  const docs = (files ?? []).filter((f) => !isImage(f.mime_type));
  const busy = uploads.some((u) => !u.error);

  const body = (
    <div
      className={`min-w-0 space-y-3 rounded-xl transition ${drag ? 'bg-indigo-50 ring-2 ring-indigo-300' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) uploadAll(e.dataTransfer.files); }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 font-bold"><Paperclip size={16} className="text-slate-400" /> {tr('الملفات', 'Files')}
          {files && files.length > 0 && <span className="text-xs font-normal text-slate-400">({files.length})</span>}</h3>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => (
            <button key={k.value} className={kind === k.value ? 'chip-on' : 'chip-off'} onClick={() => setKind(k.value)}>{L(k)}</button>
          ))}
          <button className="btn-primary btn-sm" disabled={busy || missing} onClick={() => input.current?.click()}>
            <UploadCloud size={14} /> {tr('إرفاق', 'Attach')}
          </button>
          <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) uploadAll(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {missing && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{tr('الملفات لسه متفعلتش — الأدمن يشغّل migration-v9.sql', 'Files are not enabled yet — run migration-v9.sql')}</p>}

      {uploads.map((u) => (
        <div key={u.key} className={`rounded-lg border p-2 text-xs ${u.error ? 'border-rose-200 bg-rose-50' : 'border-indigo-100 bg-indigo-50/50'}`}>
          <div className="flex items-center gap-2">
            {u.error ? <X size={14} className="text-rose-500" /> : <Spinner className="h-3.5 w-3.5" />}
            <span className="min-w-0 flex-1 truncate font-semibold">{u.name}</span>
            {u.error
              ? <button className="text-rose-500" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}><X size={14} /></button>
              : <span className="tabular-nums text-indigo-700">{u.pct}%</span>}
          </div>
          {u.error ? <div className="mt-1 text-rose-700">{u.error}</div>
            : <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-indigo-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${u.pct}%` }} /></div>}
        </div>
      ))}

      {files === null ? (
        <div className="py-4"><Spinner className="mx-auto" /></div>
      ) : files.length === 0 && uploads.length === 0 ? (
        <button onClick={() => input.current?.click()} disabled={missing}
          className="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-200 py-5 text-xs text-slate-400 hover:border-indigo-300 hover:text-indigo-500">
          <UploadCloud size={22} />
          {tr('اسحب ملفات هنا أو دوس للإرفاق — عروض أسعار، صور، عقود', 'Drop files here or click to attach — quotes, images, contracts')}
        </button>
      ) : (
        <>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 [&>*]:min-w-0">
              {images.map((f) => (
                <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block h-full w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${f.id}`} alt={f.file_name} loading="lazy" className="block h-full w-full max-w-full object-cover" />
                  </a>
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                    <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                    <a href={`/api/files/${f.id}?download=1`} className="rounded p-0.5 hover:bg-white/20" title={tr('تحميل', 'Download')}><Download size={12} /></a>
                    {(f.user_id === profile.id || canDeleteAll) && (
                      <button onClick={() => remove(f)} className="rounded p-0.5 hover:bg-white/20" title={tr('مسح', 'Delete')}><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {docs.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {docs.map((f) => {
                const k = KINDS.find((x) => x.value === f.kind) ?? KINDS[3];
                return (
                  <div key={f.id} className="flex items-center gap-2.5 px-3 py-2">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${KIND_TONE[f.kind] ?? KIND_TONE.other}`}>
                      {f.kind === 'quote' || f.mime_type === 'application/pdf' ? <FileText size={17} /> : f.kind === 'image' ? <ImageIcon size={17} /> : <FileIcon size={17} />}
                    </span>
                    <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold hover:text-indigo-600">{f.file_name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {[L(k), fmtSize(f.size_bytes), nameOf(f.user_id), fmtDateTime(f.created_at)].filter(Boolean).join(' · ')}
                      </span>
                    </a>
                    <a href={`/api/files/${f.id}?download=1`} className="btn-ghost btn-sm" title={tr('تحميل', 'Download')}><Download size={14} /></a>
                    {(f.user_id === profile.id || canDeleteAll) && (
                      <button onClick={() => remove(f)} className="btn-ghost btn-sm text-rose-500" title={tr('مسح', 'Delete')}><Trash2 size={14} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );

  return bare ? body : <div className="card min-w-0 p-4">{body}</div>;
}
