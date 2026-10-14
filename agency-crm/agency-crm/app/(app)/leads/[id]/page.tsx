'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight, CalendarClock, Check, Mail, MessageCircle, Phone, Save, StickyNote, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { Empty, PageLoader, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import {
  FOLLOWUP_PRESETS, FOLLOWUP_TYPES, LOST_REASONS, SERVICES, SOURCES, STAGES, followupTypeLabel, presetToDate, stageOf,
} from '@/lib/constants';
import { fmtDateTime, fmtNum, fromNow, toLocalInput, waLink } from '@/lib/format';
import { LEAD_SELECT } from '@/lib/leads';
import type { Activity, Followup, Lead, Note } from '@/lib/types';

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [fus, setFus] = useState<Followup[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [l, n, f, a] = await Promise.all([
      supabase.from('leads').select(LEAD_SELECT).eq('id', id).maybeSingle(),
      supabase.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      supabase.from('followups').select('*').eq('lead_id', id).order('due_at', { ascending: true }),
      supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(100),
    ]);
    setLead((l.data as Lead) ?? null);
    setNotes((n.data as Note[]) ?? []);
    setFus((f.data as Followup[]) ?? []);
    setActs((a.data as Activity[]) ?? []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (uid?: string | null) => (uid ? team.find((t) => t.id === uid)?.full_name ?? 'يوزر' : 'السيستم');

  if (loading) return <PageLoader />;
  if (!lead) return <div className="card p-10 text-center text-slate-500">الليد مش موجود أو مش متاح ليك.</div>;

  const wa = waLink(lead.phone);
  const openFus = fus.filter((f) => !f.done);

  async function reassign(uid: string) {
    if (!lead) return;
    const { error } = await supabase.rpc('assign_leads', { p_lead_ids: [lead.id], p_user_ids: uid === 'pool' ? [] : [uid] });
    if (error) return toast.error(error.message);
    toast.success('تم التحويل');
    load();
  }

  async function remove() {
    if (!lead || !confirm('حذف الليد ده نهائياً؟')) return;
    const { error } = await supabase.from('leads').delete().eq('id', lead.id);
    if (error) return toast.error(error.message);
    toast.success('تم الحذف');
    router.push('/leads');
  }

  async function toggleDone(f: Followup) {
    const { error } = await supabase.from('followups').update({ done: !f.done }).eq('id', f.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function delFollowup(f: Followup) {
    const { error } = await supabase.from('followups').delete().eq('id', f.id);
    if (error) return toast.error(error.message);
    load();
  }

  // Timeline = notes + activities
  type Item = { key: string; at: string; node: React.ReactNode };
  const timeline: Item[] = [
    ...notes.map((n) => ({
      key: `n-${n.id}`,
      at: n.created_at,
      node: (
        <div>
          <div className="text-xs text-slate-400"><b className="text-slate-600">{nameOf(n.user_id)}</b> كتب ملاحظة</div>
          <div className="mt-1 whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm">{n.body}</div>
        </div>
      ),
    })),
    ...acts.map((a) => ({
      key: `a-${a.id}`,
      at: a.created_at,
      node: (
        <div className="text-xs text-slate-500">
          <b className="text-slate-600">{a.user_id ? nameOf(a.user_id) : 'التوزيع التلقائي'}</b>{' '}
          {a.type === 'status' && <>غيّر المرحلة من «{stageOf(a.data.from).label}» إلى «{stageOf(a.data.to).label}»</>}
          {a.type === 'assigned' && (a.data.to ? <>حوّل الليد إلى <b>{nameOf(a.data.to)}</b></> : <>رجّع الليد للتوزيع</>)}
        </div>
      ),
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="space-y-4">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600">
        <ArrowRight size={16} /> رجوع لليدز
      </Link>

      {/* Header */}
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-100 text-xl font-extrabold text-indigo-700">
          {lead.full_name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{lead.full_name}</h1>
            <StageBadge status={lead.status} />
          </div>
          <div className="text-sm text-slate-500">
            {[lead.company, lead.service, lead.source].filter(Boolean).join(' · ') || '—'}
          </div>
          {lead.phone && <div dir="ltr" className="text-right text-sm font-semibold tabular-nums text-slate-700">{lead.phone}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phone && <a href={`tel:${lead.phone}`} className="btn-secondary"><Phone size={16} /> اتصال</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-success"><MessageCircle size={16} /> واتساب</a>}
          {lead.email && <a href={`mailto:${lead.email}`} className="btn-secondary"><Mail size={16} /></a>}
          {can(profile, 'delete') && <button onClick={remove} className="btn-ghost text-rose-600"><Trash2 size={16} /></button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <LogContact lead={lead} onSaved={load} />

          {/* Follow-ups */}
          <div className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold"><CalendarClock size={18} /> المتابعات</h2>
            {fus.length === 0 ? <Empty text="مفيش متابعات" /> : (
              <div className="space-y-2">
                {[...openFus, ...fus.filter((f) => f.done).reverse()].map((f) => {
                  const late = !f.done && new Date(f.due_at).getTime() < Date.now();
                  return (
                    <div key={f.id} className={`flex items-center gap-3 rounded-xl border p-3 ${f.done ? 'border-slate-100 opacity-60' : late ? 'border-rose-200 bg-rose-50' : 'border-slate-200'}`}>
                      <button
                        onClick={() => toggleDone(f)}
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${f.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 hover:border-emerald-500'}`}
                        title={f.done ? 'إلغاء' : 'تمت'}
                      >
                        {f.done && <Check size={14} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold ${f.done ? 'line-through' : ''}`}>
                          {followupTypeLabel(f.type)} — {fmtDateTime(f.due_at)}
                          {!f.done && <span className={`mr-2 text-xs ${late ? 'text-rose-600' : 'text-slate-400'}`}>({fromNow(f.due_at)})</span>}
                        </div>
                        {f.note && <div className="text-xs text-slate-500">{f.note}</div>}
                        <div className="text-[11px] text-slate-400">لـ {nameOf(f.user_id)}</div>
                      </div>
                      <button onClick={() => delFollowup(f)} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold"><StickyNote size={18} /> سجل النشاط</h2>
            {timeline.length === 0 ? <Empty text="لسه مفيش نشاط" /> : (
              <ol className="relative space-y-4 border-r-2 border-slate-100 pr-4">
                {timeline.map((t) => (
                  <li key={t.key} className="relative">
                    <span className="absolute -right-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-400" />
                    {t.node}
                    <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(t.at)}</div>
                  </li>
                ))}
                <li className="relative">
                  <span className="absolute -right-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                  <div className="text-xs text-slate-500">تمت إضافة الليد{lead.source ? ` من ${lead.source}` : ''}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(lead.created_at)}</div>
                </li>
              </ol>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Owner */}
          <div className="card space-y-3 p-4">
            <h2 className="font-bold">المسؤول</h2>
            {can(profile, 'assign') ? (
              <select className="input" value={lead.assigned_to ?? 'pool'} onChange={(e) => reassign(e.target.value)}>
                <option value="pool">— في انتظار التوزيع —</option>
                {team.filter((u) => u.is_active || u.id === lead.assigned_to).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm font-semibold">{lead.assignee?.full_name ?? '—'}</div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-slate-400">اتوزّع</dt><dd>{fmtDateTime(lead.assigned_at)}</dd>
              <dt className="text-slate-400">أول تواصل</dt><dd>{fmtDateTime(lead.first_contact_at)}</dd>
              <dt className="text-slate-400">آخر نشاط</dt><dd>{fromNow(lead.last_activity_at)}</dd>
              {lead.deal_value != null && (<><dt className="text-slate-400">قيمة الصفقة</dt><dd className="font-bold text-emerald-600">{fmtNum(lead.deal_value)}</dd></>)}
              {lead.lost_reason && (<><dt className="text-slate-400">سبب الخسارة</dt><dd>{lead.lost_reason}</dd></>)}
            </dl>
          </div>

          <LeadInfo lead={lead} onSaved={load} />

          {lead.extra && Object.keys(lead.extra).length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 font-bold">بيانات إضافية من الشيت</h2>
              <dl className="space-y-1.5 text-xs">
                {Object.entries(lead.extra).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-slate-400">{k}</dt>
                    <dd className="break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** تسجيل تواصل: مرحلة + ملاحظة + ميعاد متابعة في خطوة واحدة */
function LogContact({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const { profile } = useApp();
  const supabase = useSupabase();
  const [status, setStatus] = useState(lead.status);
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState<string>('');
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [ftype, setFtype] = useState('call');
  const [lostReason, setLostReason] = useState(lead.lost_reason ?? '');
  const [dealValue, setDealValue] = useState(lead.deal_value != null ? String(lead.deal_value) : '');
  const [closeOpen, setCloseOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setStatus(lead.status); }, [lead.status]);

  async function save() {
    const statusChanged = status !== lead.status;
    if (!statusChanged && !note.trim() && !preset) return toast.error('اكتب ملاحظة أو غيّر المرحلة أو حدد متابعة');
    if (status === 'lost' && !lostReason) return toast.error('اختار سبب الخسارة');
    let due: Date | null = null;
    if (preset) {
      due = presetToDate(preset, custom);
      if (!due || isNaN(due.getTime())) return toast.error('حدد ميعاد المتابعة');
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (statusChanged) patch.status = status;
      if (status === 'lost') patch.lost_reason = lostReason;
      if (status === 'won' && dealValue) patch.deal_value = Number(dealValue);
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('leads').update(patch).eq('id', lead.id);
        if (error) throw error;
      }
      if (note.trim()) {
        const { error } = await supabase.from('lead_notes').insert({ lead_id: lead.id, user_id: profile.id, body: note.trim() });
        if (error) throw error;
      }
      if (closeOpen && (statusChanged || note.trim())) {
        await supabase.from('followups').update({ done: true }).eq('lead_id', lead.id).eq('done', false);
      }
      if (due) {
        const { error } = await supabase.from('followups').insert({
          lead_id: lead.id,
          user_id: lead.assigned_to ?? profile.id,
          due_at: due.toISOString(),
          type: ftype,
          note: note.trim() || null,
        });
        if (error) throw error;
      }
      toast.success(due ? `اتسجّل ✅ — هنفكّرك ${fromNow(due.toISOString())}` : 'اتسجّل ✅');
      setNote('');
      setPreset('');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(false);
  }

  return (
    <div className="card space-y-4 p-4">
      <h2 className="font-bold">تسجيل تواصل</h2>

      <div>
        <label className="label">المرحلة</label>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <button key={s.value} type="button" onClick={() => setStatus(s.value)} className={status === s.value ? 'chip-on' : 'chip-off'}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'lost' && (
        <div>
          <label className="label">سبب الخسارة *</label>
          <select className="input" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
            <option value="">اختار…</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      )}
      {status === 'won' && (
        <div>
          <label className="label">قيمة التعاقد</label>
          <input className="input" type="number" min={0} dir="ltr" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
        </div>
      )}

      <div>
        <label className="label">ملاحظة</label>
        <textarea className="input" rows={3} placeholder="حصل إيه في المكالمة؟" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div>
        <label className="label">فكّرني أتابع</label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setPreset('')} className={preset === '' ? 'chip-on' : 'chip-off'}>بدون</button>
          {FOLLOWUP_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={preset === p.key ? 'chip-on' : 'chip-off'}>
              {p.label}
            </button>
          ))}
        </div>
        {preset && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {preset === 'custom' && (
              <input type="datetime-local" className="input" dir="ltr" value={custom} onChange={(e) => setCustom(e.target.value)} />
            )}
            <select className="input" value={ftype} onChange={(e) => setFtype(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" className="accent-indigo-600" checked={closeOpen} onChange={(e) => setCloseOpen(e.target.checked)} />
          اقفل المتابعات المفتوحة القديمة
        </label>
        <button className="btn-primary" disabled={saving} onClick={save}><Save size={16} /> {saving ? 'جاري الحفظ…' : 'حفظ'}</button>
      </div>
    </div>
  );
}

function LeadInfo({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const supabase = useSupabase();
  const fields = ['full_name', 'phone', 'email', 'company', 'job_title', 'service', 'source', 'campaign', 'budget', 'city'] as const;
  type F = Record<(typeof fields)[number], string>;
  const init = () => Object.fromEntries(fields.map((k) => [k, (lead[k] as string | null) ?? ''])) as F;
  const [f, setF] = useState<F>(init);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(init()); }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels: Record<string, string> = {
    full_name: 'الاسم', phone: 'الموبايل', email: 'الإيميل', company: 'الشركة / البراند', job_title: 'المسمى الوظيفي',
    service: 'الخدمة', source: 'المصدر', campaign: 'الحملة', budget: 'الميزانية', city: 'المدينة',
  };
  const dirty = fields.some((k) => (f[k] || '') !== ((lead[k] as string | null) ?? ''));

  async function save() {
    if (!f.full_name.trim()) return toast.error('الاسم مطلوب');
    setSaving(true);
    const patch: Record<string, string | null> = {};
    fields.forEach((k) => { patch[k] = f[k].trim() || null; });
    const { error } = await supabase.from('leads').update(patch).eq('id', lead.id);
    setSaving(false);
    if (error) return toast.error(error.code === '23505' ? 'الرقم ده موجود في ليد تاني' : error.message);
    toast.success('تم حفظ البيانات');
    onSaved();
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-bold">بيانات العميل</h2>
      {fields.map((k) => (
        <div key={k}>
          <label className="label">{labels[k]}</label>
          {k === 'service' || k === 'source' ? (
            <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
              <option value="">—</option>
              {(k === 'service' ? SERVICES : SOURCES).map((s) => <option key={s}>{s}</option>)}
              {f[k] && !(k === 'service' ? SERVICES : SOURCES).includes(f[k]) && <option>{f[k]}</option>}
            </select>
          ) : (
            <input className="input" dir={k === 'phone' || k === 'email' ? 'ltr' : undefined} value={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          )}
        </div>
      ))}
      {dirty && <button className="btn-primary w-full" disabled={saving} onClick={save}><Save size={16} /> حفظ التعديلات</button>}
    </div>
  );
}
