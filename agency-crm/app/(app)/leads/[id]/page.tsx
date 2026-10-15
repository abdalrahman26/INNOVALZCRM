'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, Check, History, Mail, MessageCircle, Phone, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import LogContact from '@/components/LogContact';
import LeadComments from '@/components/LeadComments';
import { Empty, PageLoader, StageBadge } from '@/components/ui';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { FOLLOWUP_TYPES, LOST_REASONS, SERVICES, SOURCES, findOpt, stageOf } from '@/lib/constants';
import { fmtDateTime, fmtNum, fromNow, waLink } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { LEAD_SELECT } from '@/lib/leads';
import type { Activity, Followup, Lead, Note } from '@/lib/types';

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const { tr, L } = useI18n();
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [fus, setFus] = useState<Followup[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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

  const nameOf = (uid?: string | null) => (uid ? team.find((t) => t.id === uid)?.full_name ?? tr('يوزر', 'User') : tr('السيستم', 'System'));

  if (loading) return <PageLoader />;
  if (!lead) return <div className="card p-10 text-center text-slate-500">{tr('الليد مش موجود أو مش متاح ليك.', 'Lead not found or not accessible.')}</div>;

  const wa = waLink(lead.phone);
  const openFus = fus.filter((f) => !f.done);

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    if (busy) return;
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) return toast.error(error.message);
    if (ok) toast.success(ok);
    load();
  }

  const reassign = (uid: string) =>
    run('assign', () => supabase.rpc('assign_leads', { p_lead_ids: [lead.id], p_user_ids: uid === 'pool' ? [] : [uid] }), tr('تم التحويل', 'Reassigned'));

  async function remove() {
    if (!lead || !confirm(tr('حذف الليد ده نهائياً؟', 'Delete this lead permanently?'))) return;
    const { error } = await supabase.from('leads').delete().eq('id', lead.id);
    if (error) return toast.error(error.message);
    toast.success(tr('تم الحذف', 'Deleted'));
    router.push('/leads');
  }

  const toggleDone = (f: Followup) => run(f.id, () => supabase.from('followups').update({ done: !f.done }).eq('id', f.id));
  const delFollowup = (f: Followup) => run(f.id, () => supabase.from('followups').delete().eq('id', f.id));

  return (
    <div className="space-y-4">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600">
        <ArrowRight size={16} className="ltr:rotate-180" /> {tr('رجوع لليدز', 'Back to leads')}
      </Link>

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
            {[lead.company, lead.service && L(findOpt(SERVICES, lead.service)), lead.source && L(findOpt(SOURCES, lead.source))].filter(Boolean).join(' · ') || '—'}
          </div>
          {lead.phone && <div className="text-sm font-semibold tabular-nums text-slate-700"><span dir="ltr">{lead.phone}</span></div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phone && <a href={`tel:${lead.phone}`} className="btn-secondary"><Phone size={16} /> {tr('اتصال', 'Call')}</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-success"><MessageCircle size={16} /> {tr('واتساب', 'WhatsApp')}</a>}
          {lead.email && <a href={`mailto:${lead.email}`} className="btn-secondary"><Mail size={16} /></a>}
          {can(profile, 'delete') && <button onClick={remove} className="btn-ghost text-rose-600"><Trash2 size={16} /></button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <LogContact lead={lead} onSaved={load} />

          <div className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold"><CalendarClock size={18} /> {tr('المتابعات', 'Follow-ups')}</h2>
            {fus.length === 0 ? <Empty text={tr('مفيش متابعات', 'No follow-ups')} /> : (
              <div className="space-y-2">
                {[...openFus, ...fus.filter((f) => f.done).reverse()].map((f) => {
                  const late = !f.done && new Date(f.due_at).getTime() < Date.now();
                  return (
                    <div key={f.id} className={`flex items-center gap-3 rounded-xl border p-3 ${f.done ? 'border-slate-100 opacity-60' : late ? 'border-rose-200 bg-rose-50' : 'border-slate-200'} ${busy === f.id ? 'animate-pulse' : ''}`}>
                      <button
                        onClick={() => toggleDone(f)}
                        disabled={busy === f.id}
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${f.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 hover:border-emerald-500'}`}
                        title={f.done ? tr('إلغاء', 'Undo') : tr('تمت', 'Done')}
                      >
                        {f.done && <Check size={14} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold ${f.done ? 'line-through' : ''}`}>
                          {L(findOpt(FOLLOWUP_TYPES, f.type))} — {fmtDateTime(f.due_at)}
                          {!f.done && <span className={`ms-2 text-xs ${late ? 'text-rose-600' : 'text-slate-400'}`}>({fromNow(f.due_at)})</span>}
                        </div>
                        {f.note && <div className="text-xs text-slate-500">{f.note}</div>}
                        <div className="text-[11px] text-slate-400">{tr('لـ', 'For')} {nameOf(f.user_id)}</div>
                      </div>
                      <button onClick={() => delFollowup(f)} disabled={busy === f.id} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <LeadComments leadId={lead.id} notes={notes} onChanged={load} />

          <div className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold"><History size={18} /> {tr('سجل النشاط', 'Activity log')}</h2>
            <ol className="relative space-y-4 border-s-2 border-slate-100 ps-4">
              {acts.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -start-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-400" />
                  <div className="text-xs text-slate-500">
                    <b className="text-slate-600">{a.user_id ? nameOf(a.user_id) : tr('التوزيع التلقائي', 'Auto distribution')}</b>{' '}
                    {a.type === 'status' && tr(
                      `غيّر المرحلة من «${stageOf(a.data.from).ar}» إلى «${stageOf(a.data.to).ar}»`,
                      `changed stage from “${stageOf(a.data.from).en}” to “${stageOf(a.data.to).en}”`,
                    )}
                    {a.type === 'assigned' && (a.data.to
                      ? <>{tr('حوّل الليد إلى', 'assigned the lead to')} <b>{nameOf(a.data.to)}</b></>
                      : tr('رجّع الليد للتوزيع', 'returned the lead to distribution'))}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(a.created_at)}</div>
                </li>
              ))}
              <li className="relative">
                <span className="absolute -start-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                <div className="text-xs text-slate-500">
                  {tr('تمت إضافة الليد', 'Lead created')}{lead.source ? ` ${tr('من', 'from')} ${L(findOpt(SOURCES, lead.source))}` : ''}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(lead.created_at)}</div>
              </li>
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <h2 className="font-bold">{tr('المسؤول', 'Owner')}</h2>
            {can(profile, 'assign') ? (
              <select className="input" disabled={busy === 'assign'} value={lead.assigned_to ?? 'pool'} onChange={(e) => reassign(e.target.value)}>
                <option value="pool">{tr('— في انتظار التوزيع —', '— Waiting for distribution —')}</option>
                {team.filter((u) => u.is_active || u.id === lead.assigned_to).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm font-semibold">{lead.assignee?.full_name ?? '—'}</div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-slate-400">{tr('اتوزّع', 'Assigned')}</dt><dd>{fmtDateTime(lead.assigned_at)}</dd>
              <dt className="text-slate-400">{tr('أول تواصل', 'First contact')}</dt><dd>{fmtDateTime(lead.first_contact_at)}</dd>
              <dt className="text-slate-400">{tr('آخر نشاط', 'Last activity')}</dt><dd>{fromNow(lead.last_activity_at)}</dd>
              {lead.deal_value != null && (<><dt className="text-slate-400">{tr('قيمة الصفقة', 'Deal value')}</dt><dd className="font-bold text-emerald-600">{fmtNum(lead.deal_value)}</dd></>)}
              {lead.lost_reason && (<><dt className="text-slate-400">{tr('سبب الخسارة', 'Lost reason')}</dt><dd>{L(findOpt(LOST_REASONS, lead.lost_reason))}</dd></>)}
            </dl>
          </div>

          <LeadInfo lead={lead} onSaved={load} />

          {lead.extra && Object.keys(lead.extra).length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 font-bold">{tr('بيانات إضافية من الشيت', 'Extra data from sheet')}</h2>
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

function LeadInfo({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const fields = ['full_name', 'phone', 'email', 'company', 'job_title', 'service', 'source', 'campaign', 'budget', 'city'] as const;
  type F = Record<(typeof fields)[number], string>;
  const init = () => Object.fromEntries(fields.map((k) => [k, (lead[k] as string | null) ?? ''])) as F;
  const [f, setF] = useState<F>(init);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(init()); }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels: Record<string, string> = {
    full_name: tr('الاسم', 'Name'), phone: tr('الموبايل', 'Phone'), email: tr('الإيميل', 'Email'),
    company: tr('الشركة / البراند', 'Company / Brand'), job_title: tr('المسمى الوظيفي', 'Job title'),
    service: tr('الخدمة', 'Service'), source: tr('المصدر', 'Source'), campaign: tr('الحملة', 'Campaign'),
    budget: tr('الميزانية', 'Budget'), city: tr('المدينة', 'City'),
  };
  const dirty = fields.some((k) => (f[k] || '') !== ((lead[k] as string | null) ?? ''));

  async function save() {
    if (saving) return;
    if (!f.full_name.trim()) return toast.error(tr('الاسم مطلوب', 'Name is required'));
    setSaving(true);
    const patch: Record<string, string | null> = {};
    fields.forEach((k) => { patch[k] = f[k].trim() || null; });
    const { error } = await supabase.from('leads').update(patch).eq('id', lead.id);
    setSaving(false);
    if (error) return toast.error(error.code === '23505' ? tr('الرقم ده موجود في ليد تاني', 'This phone exists on another lead') : error.message);
    toast.success(tr('تم حفظ البيانات', 'Saved'));
    onSaved();
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-bold">{tr('بيانات العميل', 'Client details')}</h2>
      {fields.map((k) => {
        const list = k === 'service' ? SERVICES : k === 'source' ? SOURCES : null;
        return (
          <div key={k}>
            <label className="label">{labels[k]}</label>
            {list ? (
              <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                <option value="">—</option>
                {list.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
                {f[k] && !list.some((s) => s.value === f[k]) && <option value={f[k]}>{f[k]}</option>}
              </select>
            ) : (
              <input className="input" dir={k === 'phone' || k === 'email' ? 'ltr' : undefined} value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            )}
          </div>
        );
      })}
      {dirty && <button className="btn-primary w-full" disabled={saving} onClick={save}><Save size={16} /> {tr('حفظ التعديلات', 'Save changes')}</button>}
    </div>
  );
}
