'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Mail, MessageCircle, Pencil, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Spinner, StageBadge } from './ui';
import LogContact from './LogContact';
import LeadComments from './LeadComments';
import LeadInfoForm from './LeadInfoForm';
import { useSupabase } from '@/lib/hooks';
import { FOLLOWUP_TYPES, SERVICES, SOURCES, findOpt } from '@/lib/constants';
import { fmtDateTime, fromNow, waLink } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { LEAD_SELECT } from '@/lib/leads';
import type { Followup, Lead, Note } from '@/lib/types';

/** نافذة سريعة للعميل: تسجيل تواصل + متابعة + تعليقات — من غير ما تسيب الصفحة */
export default function LeadQuickModal({
  leadId, onClose, onChanged,
}: { leadId: string; onClose: () => void; onChanged?: () => void }) {
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [fus, setFus] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [l, n, f] = await Promise.all([
      supabase.from('leads').select(LEAD_SELECT).eq('id', leadId).maybeSingle(),
      supabase.from('lead_notes').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(200),
      supabase.from('followups').select('*').eq('lead_id', leadId).eq('done', false).order('due_at'),
    ]);
    setLead((l.data as Lead) ?? null);
    setNotes((n.data as Note[]) ?? []);
    setFus((f.data as Followup[]) ?? []);
    setLoading(false);
  }, [supabase, leadId]);

  useEffect(() => { load(); }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  async function markDone(f: Followup) {
    if (busyId) return;
    setBusyId(f.id);
    const { error } = await supabase.from('followups').update({ done: true }).eq('id', f.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    changed();
  }

  const wa = waLink(lead?.phone);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={lead ? (
        <span className="flex flex-wrap items-center gap-2">
          {lead.full_name} <StageBadge status={lead.status} />
        </span>
      ) : tr('العميل', 'Client')}
    >
      {loading ? (
        <div className="py-16"><Spinner className="mx-auto h-7 w-7" /></div>
      ) : !lead ? (
        <p className="py-10 text-center text-slate-500">{tr('الليد مش موجود أو مش متاح ليك.', 'Lead not found or not accessible.')}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
            <div className="min-w-0 flex-1 text-sm">
              {lead.phone && <div className="font-semibold tabular-nums"><span dir="ltr">{lead.phone}</span></div>}
              <div className="text-xs text-slate-500">
                {[lead.company, lead.service && L(findOpt(SERVICES, lead.service)), lead.source && L(findOpt(SOURCES, lead.source))]
                  .filter(Boolean).join(' · ') || '—'}
                {lead.assignee?.full_name && ` · ${tr('المسؤول', 'Owner')}: ${lead.assignee.full_name}`}
              </div>
            </div>
            {lead.phone && <a href={`tel:${lead.phone}`} className="btn-secondary btn-sm"><Phone size={14} /> {tr('اتصال', 'Call')}</a>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-success btn-sm"><MessageCircle size={14} /> {tr('واتساب', 'WhatsApp')}</a>}
            {lead.email && <a href={`mailto:${lead.email}`} className="btn-secondary btn-sm"><Mail size={14} /></a>}
            <button className={editing ? 'chip-on' : 'btn-secondary btn-sm'} onClick={() => setEditing((e) => !e)}>
              <Pencil size={14} /> {tr('تعديل البيانات', 'Edit details')}
            </button>
            <Link href={`/leads/${lead.id}`} className="btn-ghost btn-sm"><ExternalLink size={14} /> {tr('الصفحة الكاملة', 'Full page')}</Link>
          </div>

          {editing && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
              <LeadInfoForm lead={lead} onSaved={changed} bare onDone={() => setEditing(false)} />
            </div>
          )}

          {fus.length > 0 && (
            <div className="space-y-1.5">
              <div className="label">{tr('متابعات مفتوحة', 'Open follow-ups')}</div>
              {fus.map((f) => {
                const late = new Date(f.due_at).getTime() < Date.now();
                return (
                  <div key={f.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${late ? 'border-rose-200 bg-rose-50' : 'border-slate-200'}`}>
                    <span className={`flex-1 ${late ? 'font-bold text-rose-600' : ''}`}>
                      {L(findOpt(FOLLOWUP_TYPES, f.type))} — {fmtDateTime(f.due_at)} ({fromNow(f.due_at)})
                      {f.note && <span className="block text-xs font-normal text-slate-500">{f.note}</span>}
                    </span>
                    <button className="btn-success btn-sm" disabled={busyId === f.id} onClick={() => markDone(f)}>
                      <Check size={14} /> {tr('تمت', 'Done')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <LogContact lead={lead} onSaved={changed} bare />

          <div className="border-t border-slate-100 pt-4">
            <LeadComments leadId={lead.id} notes={notes} onChanged={changed} bare />
          </div>
        </div>
      )}
    </Modal>
  );
}
