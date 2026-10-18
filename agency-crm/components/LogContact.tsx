'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { FOLLOWUP_PRESETS, FOLLOWUP_TYPES, LOST_REASONS, STAGES, presetToDate } from '@/lib/constants';
import { fromNow, toLocalInput } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Lead } from '@/lib/types';

// المراحل اللي بيتسجل فيها قيمة (عرض سعر / صفقة جارية / تعاقد)
const VALUE_STAGES = ['proposal', 'negotiation', 'won'];

/** تسجيل تواصل: مرحلة + ملاحظة + ميعاد متابعة في خطوة واحدة */
export default function LogContact({ lead, onSaved, bare = false }: { lead: Lead; onSaved: () => void; bare?: boolean }) {
  const { profile } = useApp();
  const supabase = useSupabase();
  const { tr, L } = useI18n();
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

  // اختيار "اجتماع محدد" بيفتح ميعاد الاجتماع على طول
  function pickStage(v: string) {
    setStatus(v);
    if (v === 'meeting') {
      setFtype('meeting');
      if (!preset) setPreset('custom');
    }
  }

  async function save() {
    if (saving) return;
    const statusChanged = status !== lead.status;
    if (!statusChanged && !note.trim() && !preset) {
      return toast.error(tr('اكتب ملاحظة أو غيّر المرحلة أو حدد متابعة', 'Add a note, change the stage, or set a follow-up'));
    }
    if (status === 'lost' && !lostReason) return toast.error(tr('اختار سبب الخسارة', 'Choose a lost reason'));
    let due: Date | null = null;
    if (preset) {
      due = presetToDate(preset, custom);
      if (!due || isNaN(due.getTime())) return toast.error(tr('حدد ميعاد المتابعة', 'Pick a follow-up time'));
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (statusChanged) patch.status = status;
      if (status === 'lost') patch.lost_reason = lostReason;
      if (VALUE_STAGES.includes(status) && dealValue !== '' && Number(dealValue) !== Number(lead.deal_value ?? NaN)) patch.deal_value = Number(dealValue);
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
      toast.success(due
        ? tr(`اتسجّل ✅ — هنفكّرك ${fromNow(due.toISOString())}`, `Saved ✅ — we'll remind you ${fromNow(due.toISOString())}`)
        : tr('اتسجّل ✅', 'Saved ✅'));
      setNote('');
      setPreset('');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(false);
  }

  return (
    <div className={bare ? 'space-y-4' : 'card space-y-4 p-4'}>
      {!bare && <h2 className="font-bold">{tr('تسجيل تواصل', 'Log contact')}</h2>}

      <div>
        <label className="label">{tr('المرحلة', 'Stage')}</label>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <button key={s.value} type="button" onClick={() => pickStage(s.value)} className={status === s.value ? 'chip-on' : 'chip-off'}>
              {L(s)}
            </button>
          ))}
        </div>
      </div>

      {status === 'lost' && (
        <div>
          <label className="label">{tr('سبب الخسارة *', 'Lost reason *')}</label>
          <select className="input" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
            <option value="">{tr('اختار…', 'Choose…')}</option>
            {LOST_REASONS.map((r) => <option key={r.value} value={r.value}>{L(r)}</option>)}
          </select>
        </div>
      )}
      {VALUE_STAGES.includes(status) && (
        <div>
          <label className="label">
            {status === 'proposal' ? tr('قيمة العرض', 'Proposal value')
              : status === 'negotiation' ? tr('قيمة الصفقة المتوقعة', 'Expected deal value')
                : tr('قيمة التعاقد', 'Deal value')}
          </label>
          <input className="input" type="number" min={0} dir="ltr" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
        </div>
      )}

      <div>
        <label className="label">{tr('ملاحظة', 'Note')}</label>
        <textarea className="input" rows={3} placeholder={tr('حصل إيه في المكالمة؟', 'What happened on the call?')} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div>
        <label className="label">
          {status === 'meeting' ? tr('ميعاد الاجتماع', 'Meeting time') : tr('فكّرني أتابع', 'Remind me to follow up')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setPreset('')} className={preset === '' ? 'chip-on' : 'chip-off'}>{tr('بدون', 'None')}</button>
          {FOLLOWUP_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={preset === p.key ? 'chip-on' : 'chip-off'}>
              {L(p)}
            </button>
          ))}
        </div>
        {preset && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {preset === 'custom' && (
              <input type="datetime-local" className="input" dir="ltr" value={custom} onChange={(e) => setCustom(e.target.value)} />
            )}
            <select className="input" value={ftype} onChange={(e) => setFtype(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <option key={t.value} value={t.value}>{L(t)}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" className="accent-indigo-600" checked={closeOpen} onChange={(e) => setCloseOpen(e.target.checked)} />
          {tr('اقفل المتابعات المفتوحة القديمة', 'Close older open follow-ups')}
        </label>
        <button className="btn-primary" disabled={saving} onClick={save}>
          <Save size={16} /> {saving ? tr('جاري الحفظ…', 'Saving…') : tr('حفظ', 'Save')}
        </button>
      </div>
    </div>
  );
}
