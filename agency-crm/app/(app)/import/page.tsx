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
  BASIC_KEYS, FIELDS, clean, guessMap, guessNoteCols, makeOwnerMatcher, parseDate, parseStatus, uuid, yesterday, type FieldKey,
} from '@/lib/import-utils';
import { fmtNum, normalizePhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type Row = Record<string, unknown>;

type Prepared = {
  id: string;
  lead: Record<string, unknown>;
  comment: string;
  statusRaw: string;
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
  const [ownerPick, setOwnerPick] = useState<Record<string, string>>({}); // اسم السيلز في الشيت ← يوزر في السيستم
  const [updateExisting, setUpdateExisting] = useState(true);
  const [noteCols, setNoteCols] = useState<string[]>([]); // كل الأعمدة اللي هتتحفظ كتعليقات
  const [statusPick, setStatusPick] = useState<Record<string, string>>({}); // قيمة الحالة في الشيت ← مرحلة في السيستم
  const [workedStage, setWorkedStage] = useState('contacted');
  const [workedDate, setWorkedDate] = useState(yesterday);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    total: number; inserted: number; dupFile: number; dupDb: number; skipped: number;
    assigned: number; comments: number; followups: number; worked: number; updated: number;
    stageCounts: Record<string, number>; warnings: string[];
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
    const mapped = new Set([...Object.values(map).filter(Boolean), ...noteCols]);
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
      // الحالة: من جدول ربط الحالات (لو اتغيرت) ← التعرّف التلقائي ← "تم التواصل" لأي حالة مكتوبة مش معروفة
      const status = rawStatus
        ? (statusPick[rawStatus] || parseStatus(rawStatus) || 'contacted')
        : (leadsState === 'worked' ? workedStage : 'new');
      const worked = status !== 'new';

      // التعليقات: كل الأعمدة المختارة في تعليق واحد (لو أكتر من عمود، كل سطر باسم العمود)
      const parts = noteCols.map((h) => [h, clean(r[h])] as const).filter(([, v]) => v);
      const comment = parts.length === 1 && noteCols.length === 1 ? parts[0][1] : parts.map(([h, v]) => `${h}: ${v}`).join('\n');
      const rowDate = map.created_date ? parseDate(r[map.created_date]) : null;
      const date = rowDate && rowDate.getTime() <= Date.now() ? rowDate : worked ? fallbackDate : null;

      const ownerRaw = map.owner && canAssign ? clean(r[map.owner]) : '';
      const owner = ownerRaw ? (ownerRaw in ownerPick ? ownerPick[ownerRaw] || null : matchOwner(ownerRaw)) : null;

      out.push({
        id: uuid(),
        lead: { ...lead, status },
        comment,
        statusRaw: rawStatus,
        owner,
        ownerRaw,
        worked,
        date,
        followup: map.followup_date ? parseDate(r[map.followup_date]) : null,
      });
    }
    return { out, dupFile, skipped };
  }, [step, running, rows, map, headers, keepExtra, defSource, defService, leadsState, workedStage, workedDate, canAssign, matchOwner, ownerPick, noteCols, statusPick]);

  const summary = useMemo(() => {
    const p = prepared.out;
    const unknownOwners = new Map<string, number>();
    const ownerNames = new Map<string, number>();
    const statusValues = new Map<string, number>();
    const perOwner = new Map<string, number>();
    p.forEach((x) => {
      if (x.statusRaw) statusValues.set(x.statusRaw, (statusValues.get(x.statusRaw) ?? 0) + 1);
      if (x.ownerRaw) ownerNames.set(x.ownerRaw, (ownerNames.get(x.ownerRaw) ?? 0) + 1);
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
      ownerNames,
      statusValues,
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
      const gm = guessMap(head);
      setMap(gm);
      setNoteCols(guessNoteCols(head, gm));
      setOwnerPick({});
      setStatusPick({});
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
    const stageCounts: Record<string, number> = {};
    done.forEach((x) => { const st = x.lead.status as string; stageCounts[st] = (stageCounts[st] ?? 0) + 1; });

    // حفظ التعليقات — ولو كود الداتابيز v2 مش متشغل، بنحفظها برضو (من غير علامة "من الشيت")
    let oldDb = false;
    const insertNotes = async (list: Record<string, unknown>[], onSaved?: (chunk: Record<string, unknown>[]) => void) => {
      let saved = 0;
      for (let i = 0; i < list.length; i += CHUNK) {
        let chunk = list.slice(i, i + CHUNK);
        let { error } = await supabase.from('lead_notes').insert(chunk);
        if (error && /source|parent_id|column|schema cache/i.test(error.message)) {
          chunk = chunk.map((n) => { const { source: _s, ...rest } = n; void _s; return rest; });
          ({ error } = await supabase.from('lead_notes').insert(chunk));
          if (!error) oldDb = true;
        }
        if (error) { warnings.push(tr('التعليقات: ', 'Comments: ') + error.message); break; }
        saved += chunk.length;
        onSaved?.(chunk);
      }
      return saved;
    };

    // 2) التعليقات
    const notes = done.filter((x) => x.comment).map((x) => ({
      lead_id: x.id, user_id: profile.id, body: x.comment, source: 'import',
      ...(x.worked && x.date ? { created_at: x.date.toISOString() } : {}),
    }));
    let comments = await insertNotes(notes);
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

    // 5) الليدز اللي كانت موجودة قبل كده: توزيعها على السيلز اللي في الشيت + تعليقها + حالتها
    let updated = 0;
    const dupItems = items.filter((x) => !inserted.has(x.id));
    if (updateExisting && dupItems.length) {
      const byPhone = new Map<string, Prepared>();
      dupItems.forEach((x) => { const np = normalizePhone(x.lead.phone as string | null); if (np) byPhone.set(np, x); });
      type Ex = { id: string; phone_normalized: string; assigned_to: string | null; status: string; next_followup_at: string | null };
      const existing: Ex[] = [];
      const phones = [...byPhone.keys()];
      for (let i = 0; i < phones.length; i += 200) {
        const { data, error } = await supabase.from('leads')
          .select('id, phone_normalized, assigned_to, status, next_followup_at')
          .in('phone_normalized', phones.slice(i, i + 200));
        if (error) { warnings.push(error.message); break; }
        existing.push(...((data as Ex[]) ?? []));
      }
      setProgress(92);

      const reassign = new Map<string, string[]>();
      const statusUpd = new Map<string, string[]>(); // ليدز لسه "جديد" ← المرحلة من الشيت
      const statusForce = new Map<string, string[]>(); // الشيت فيه حالة صريحة ← تتسجل حتى لو الليد مش جديد
      const touched = new Set<string>();
      const exNotes: { lead_id: string; body: string; created_at?: string }[] = [];
      const exFus: Record<string, unknown>[] = [];
      for (const ex of existing) {
        const x = byPhone.get(ex.phone_normalized);
        if (!x) continue;
        let target = x.owner;
        if (!target && !ex.assigned_to && mode === 'now' && users.length) { target = users[rr % users.length]; rr++; }
        if (target && target !== ex.assigned_to) {
          reassign.set(target, [...(reassign.get(target) ?? []), ex.id]);
          touched.add(ex.id);
        }
        const st = x.lead.status as string;
        if (x.statusRaw && st !== ex.status) {
          statusForce.set(st, [...(statusForce.get(st) ?? []), ex.id]);
          stageCounts[st] = (stageCounts[st] ?? 0) + 1;
          touched.add(ex.id);
        } else if (x.worked && ex.status === 'new' && st !== 'new') {
          statusUpd.set(st, [...(statusUpd.get(st) ?? []), ex.id]);
          stageCounts[st] = (stageCounts[st] ?? 0) + 1;
          touched.add(ex.id);
        }
        if (x.comment) exNotes.push({ lead_id: ex.id, body: x.comment, ...(x.worked && x.date ? { created_at: x.date.toISOString() } : {}) });
        const fuOwner = target ?? ex.assigned_to;
        if (x.followup && !ex.next_followup_at) {
          exFus.push({
            lead_id: ex.id,
            user_id: fuOwner && (fuOwner === profile.id || canEditAll) ? fuOwner : profile.id,
            due_at: x.followup.toISOString(), type: 'call', note: x.comment ? x.comment.slice(0, 200) : null,
          });
          touched.add(ex.id);
        }
      }

      for (const [uid, ids] of reassign) {
        for (let i = 0; i < ids.length; i += 1000) {
          const { error } = await supabase.rpc('assign_leads', { p_lead_ids: ids.slice(i, i + 1000), p_user_ids: [uid] });
          if (error) warnings.push(error.message); else assigned += Math.min(1000, ids.length - i);
        }
      }
      for (const [st, ids] of statusUpd) {
        for (let i = 0; i < ids.length; i += 500) {
          const { error } = await supabase.from('leads').update({ status: st }).in('id', ids.slice(i, i + 500)).eq('status', 'new');
          if (error) warnings.push(error.message);
        }
      }
      for (const [st, ids] of statusForce) {
        for (let i = 0; i < ids.length; i += 500) {
          const { error } = await supabase.from('leads').update({ status: st }).in('id', ids.slice(i, i + 500));
          if (error) warnings.push(error.message);
        }
      }
      // التعليقات من غير تكرار (لو نفس التعليق اتضاف قبل كده مش هيتضاف تاني)
      if (exNotes.length) {
        const have = new Set<string>();
        const ids = [...new Set(exNotes.map((n) => n.lead_id))];
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabase.from('lead_notes').select('lead_id, body').in('lead_id', ids.slice(i, i + 200));
          ((data as { lead_id: string; body: string }[]) ?? []).forEach((n) => have.add(`${n.lead_id}|${n.body.trim()}`));
        }
        const fresh = exNotes.filter((n) => !have.has(`${n.lead_id}|${n.body.trim()}`))
          .map((n) => ({ ...n, user_id: profile.id, source: 'import' }));
        comments += await insertNotes(fresh, (chunk) => chunk.forEach((n) => touched.add(n.lead_id as string)));
      }
      for (let i = 0; i < exFus.length; i += CHUNK) {
        const { error } = await supabase.from('followups').insert(exFus.slice(i, i + CHUNK));
        if (error) { warnings.push(tr('المتابعات: ', 'Follow-ups: ') + error.message); break; }
        followups += Math.min(CHUNK, exFus.length - i);
      }
      updated = touched.size;
      if (existing.length < byPhone.size) {
        warnings.push(tr(
          `${byPhone.size - existing.length} ليد موجودين بس مش ظاهرين ليك (صلاحية «يشوف كل الليدز» مطلوبة لتحديثهم)`,
          `${byPhone.size - existing.length} existing leads aren't visible to you ("view all leads" permission is needed to update them)`,
        ));
      }
    }

    if (oldDb) {
      warnings.push(tr(
        'التعليقات اتحفظت، بس كود الداتابيز الجديد (migration-v2.sql) لسه مش متشغل في Supabase — شغّله عشان علامة «من الشيت» والردود تشتغل.',
        'Comments were saved, but the new database script (migration-v2.sql) has not been run in Supabase yet — run it to enable the “From sheet” tag and replies.',
      ));
    }

    const dupDb = items.length - done.length;
    if (batchId) await supabase.from('import_batches').update({ inserted: done.length, duplicates: dupDb + prepared.dupFile }).eq('id', batchId);

    setResult({
      total: rows.length, inserted: done.length, dupFile: prepared.dupFile, dupDb, skipped: prepared.skipped,
      assigned, comments, followups, worked: done.filter((x) => x.worked).length, updated, stageCounts, warnings,
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
  const visibleFields = FIELDS.filter((f) => f.key !== 'comment' && (f.key !== 'owner' || canAssign));
  const toggleNoteCol = (h: string) => setNoteCols((c) => (c.includes(h) ? c.filter((x) => x !== h) : [...c, h]));

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
              <thead><tr>
                {visibleFields.filter((f) => map[f.key]).map((f) => <th key={f.key} className="th">{L(f)}</th>)}
                {noteCols.length > 0 && <th className="th">💬 {tr('التعليق', 'Comment')}</th>}
              </tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {visibleFields.filter((f) => map[f.key]).map((f) => <td key={f.key} className="td text-xs">{clean(r[map[f.key]])}</td>)}
                    {noteCols.length > 0 && (
                      <td className="td max-w-xs whitespace-pre-line text-xs">
                        {noteCols.map((h) => clean(r[h])).filter(Boolean).join(' · ')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* أعمدة التعليقات — ممكن أكتر من عمود */}
          <div className="card space-y-3 p-4">
            <div>
              <h2 className="font-bold">💬 {tr('أعمدة التعليقات والملاحظات', 'Comment & note columns')}</h2>
              <p className="text-xs text-slate-500">
                {tr('علّم على كل عمود فيه ملاحظات — هيتحفظ كتعليق على الليد (لو أكتر من عمود، كل واحد في سطر باسمه).',
                  'Tick every column that holds notes — it is saved as a comment on the lead (several columns become one line each).')}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {headers.map((h) => (
                <button key={h} type="button" onClick={() => toggleNoteCol(h)} className={noteCols.includes(h) ? 'chip-on' : 'chip-off'}>
                  {noteCols.includes(h) ? '✓ ' : ''}{h}
                </button>
              ))}
            </div>
            {noteCols.length === 0 && (
              <p className="text-xs text-amber-700">{tr('مفيش عمود متعلّم — مش هيتحفظ أي تعليق.', 'No column ticked — no comments will be saved.')}</p>
            )}
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
            {map.status && summary.statusValues.size > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">{tr('ربط الحالات اللي في الشيت بمراحل السيستم', 'Match sheet statuses to pipeline stages')}</div>
                <p className="text-xs text-slate-500">
                  {tr('الحالات باللون الأصفر السيستم ما عرفهاش وحطها «تم التواصل» — غيّرها لو محتاج.',
                    'Statuses in yellow were not recognized and default to “Contacted” — change them if needed.')}
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[420px]">
                    <thead className="bg-slate-50"><tr>
                      <th className="th">{tr('الحالة في الشيت', 'Status in sheet')}</th>
                      <th className="th">{tr('عدد الليدز', 'Leads')}</th>
                      <th className="th">{tr('المرحلة في السيستم', 'Pipeline stage')}</th>
                    </tr></thead>
                    <tbody>
                      {[...summary.statusValues.entries()].sort((a, b) => b[1] - a[1]).map(([raw, n]) => {
                        const auto = parseStatus(raw);
                        const current = statusPick[raw] || auto || 'contacted';
                        const guessed = !statusPick[raw] && !auto;
                        return (
                          <tr key={raw} className={`border-t border-slate-100 ${guessed ? 'bg-amber-50' : ''}`}>
                            <td className="td font-semibold">{raw}</td>
                            <td className="td tabular-nums">{fmtNum(n)}</td>
                            <td className="td">
                              <select className="input py-1.5" value={current} onChange={(e) => setStatusPick((p) => ({ ...p, [raw]: e.target.value }))}>
                                {STAGES.map((st) => <option key={st.value} value={st.value}>{L(st)}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
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
              {noteCols.length > 0 && <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">{fmtNum(summary.withComment)} {tr('بتعليق', 'with comments')}</span>}
              {map.followup_date && <span className="rounded-lg bg-violet-50 px-2 py-1 text-violet-700">{fmtNum(summary.withFollowup)} {tr('بميعاد متابعة', 'with follow-up date')}</span>}
              {map.owner && canAssign && <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">{fmtNum(summary.withOwner)} {tr('ليهم سيلز', 'with a rep')}</span>}
            </div>
            {map.owner && canAssign && summary.ownerNames.size > 0 && (
              <div className="space-y-2 pt-2">
                <div className="font-semibold">{tr('ربط أسماء السيلز اللي في الشيت', 'Match rep names from the sheet')}</div>
                {summary.unknownOwners.size > 0 && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {tr('الأسماء اللي باللون الأحمر السيستم ما عرفهاش — اختار لها السيلز بنفسك، وإلا هتمشي حسب اختيار التوزيع.',
                      'Names in red were not recognized — pick the rep yourself, otherwise they follow the assignment choice.')}
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[420px]">
                    <thead className="bg-slate-50"><tr>
                      <th className="th">{tr('الاسم في الشيت', 'Name in sheet')}</th>
                      <th className="th">{tr('عدد الليدز', 'Leads')}</th>
                      <th className="th">{tr('السيلز في السيستم', 'Rep in system')}</th>
                    </tr></thead>
                    <tbody>
                      {[...summary.ownerNames.entries()].sort((a, b) => b[1] - a[1]).map(([raw, n]) => {
                        const current = raw in ownerPick ? ownerPick[raw] : (matchOwner(raw) ?? '');
                        return (
                          <tr key={raw} className={`border-t border-slate-100 ${current ? '' : 'bg-rose-50'}`}>
                            <td className={`td font-semibold ${current ? '' : 'text-rose-700'}`}>{raw}</td>
                            <td className="td tabular-nums">{fmtNum(n)}</td>
                            <td className="td">
                              <select className="input py-1.5" value={current} onChange={(e) => setOwnerPick((p) => ({ ...p, [raw]: e.target.value }))}>
                                <option value="">{tr('— بدون (حسب اختيار التوزيع) —', '— None (follow assignment choice) —')}</option>
                                {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <label className="flex items-start gap-2 pt-2 text-sm">
              <input type="checkbox" className="mt-1 accent-indigo-600" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span>
                <b>{tr('لو الليد موجود قبل كده في السيستم: حدّثه', 'If a lead already exists: update it')}</b><br />
                <span className="text-xs text-slate-500">
                  {tr('يتوزّع على السيلز اللي في الشيت، ويتضاف تعليقه، وتتحدث حالته لو لسه «جديد». من غير ما يتكرر.',
                    "Assign it to the sheet's rep, add its comment, and update its stage if still “New”. No duplicates are created.")}
                </span>
              </span>
            </label>
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
            {result.updated > 0 && <Stat label={tr('ليدز موجودة اتحدّثت', 'Existing leads updated')} value={result.updated} tone="text-emerald-600" />}
          </div>
          {Object.keys(result.stageCounts).length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              {STAGES.filter((st) => result.stageCounts[st.value]).map((st) => (
                <span key={st.value} className={`rounded-full px-2.5 py-1 font-bold ${st.color}`}>{L(st)}: {fmtNum(result.stageCounts[st.value])}</span>
              ))}
            </div>
          )}
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
