'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Modal, UserPicker } from './ui';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES } from '@/lib/constants';
import { useI18n } from '@/lib/i18n';

export function AddLeadModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const canAssign = can(profile, 'assign');
  const empty = { full_name: '', phone: '', email: '', company: '', job_title: '', service: '', source: '', budget: '', city: '', note: '' };
  const [f, setF] = useState(empty);
  const [assignTo, setAssignTo] = useState<string>(canAssign ? 'pool' : profile.id);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!f.full_name.trim() && !f.phone.trim()) return toast.error(tr('اكتب الاسم أو الموبايل', 'Enter a name or phone'));
    setSaving(true);
    const { note, ...fields } = f;
    const row: Record<string, unknown> = {};
    Object.entries(fields).forEach(([k, v]) => { row[k] = v.trim() || null; });
    row.full_name = f.full_name.trim() || f.phone.trim();
    if (assignTo === 'pool') { row.assigned_to = null; row.in_pool = true; }
    else if (assignTo === 'hold') { row.assigned_to = null; row.in_pool = false; }
    else row.assigned_to = assignTo;

    const { data, error } = await supabase.from('leads').insert(row).select('id').single();
    if (error) {
      setSaving(false);
      return toast.error(error.code === '23505' ? tr('الرقم ده موجود قبل كده في السيستم', 'This phone number already exists') : error.message);
    }
    if (note.trim()) await supabase.from('lead_notes').insert({ lead_id: data.id, user_id: profile.id, body: note.trim() });
    setSaving(false);
    toast.success(tr('تمت إضافة الليد', 'Lead added'));
    setF(empty);
    onSaved();
    onClose();
  }

  const salesUsers = team.filter((u) => u.is_active);

  return (
    <Modal open={open} onClose={onClose} title={tr('إضافة ليد جديد', 'Add new lead')} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">{tr('الاسم *', 'Name *')}</label><input className="input" value={f.full_name} onChange={set('full_name')} /></div>
          <div><label className="label">{tr('الموبايل', 'Phone')}</label><input className="input" dir="ltr" value={f.phone} onChange={set('phone')} /></div>
          <div><label className="label">{tr('الإيميل', 'Email')}</label><input className="input" dir="ltr" value={f.email} onChange={set('email')} /></div>
          <div><label className="label">{tr('الشركة / البراند', 'Company / Brand')}</label><input className="input" value={f.company} onChange={set('company')} /></div>
          <div>
            <label className="label">{tr('الخدمة المطلوبة', 'Service')}</label>
            <select className="input" value={f.service} onChange={set('service')}>
              <option value="">—</option>{SERVICES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{tr('المصدر', 'Source')}</label>
            <select className="input" value={f.source} onChange={set('source')}>
              <option value="">—</option>{SOURCES.map((s) => <option key={s.value} value={s.value}>{L(s)}</option>)}
            </select>
          </div>
          <div><label className="label">{tr('الميزانية', 'Budget')}</label><input className="input" value={f.budget} onChange={set('budget')} /></div>
          <div><label className="label">{tr('المدينة', 'City')}</label><input className="input" value={f.city} onChange={set('city')} /></div>
        </div>
        <div><label className="label">{tr('ملاحظة', 'Note')}</label><textarea className="input" rows={2} value={f.note} onChange={set('note')} /></div>
        {canAssign && (
          <div>
            <label className="label">{tr('التوزيع', 'Assignment')}</label>
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="pool">{tr('يدخل التوزيع التلقائي', 'Send to auto distribution')}</option>
              <option value="hold">{tr('يفضل بدون توزيع', 'Keep unassigned')}</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>{tr('تحويل لـ', 'Assign to')} {u.full_name}</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{tr('إلغاء', 'Cancel')}</button>
          <button className="btn-primary" disabled={saving}>{saving ? tr('جاري الحفظ…', 'Saving…') : tr('حفظ', 'Save')}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignModal({
  open, onClose, leadIds, onDone,
}: { open: boolean; onClose: () => void; leadIds: string[]; onDone: () => void }) {
  const { team } = useApp();
  const supabase = useSupabase();
  const { tr } = useI18n();
  const [users, setUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const active = team.filter((u) => u.is_active);

  async function run(toPool: boolean) {
    if (busy) return;
    if (!toPool && !users.length) return toast.error(tr('اختار سيلز واحد على الأقل', 'Pick at least one rep'));
    setBusy(true);
    const { error } = await supabase.rpc('assign_leads', { p_lead_ids: leadIds, p_user_ids: toPool ? [] : users });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(toPool
      ? tr('رجعت الليدز للتوزيع التلقائي', 'Leads returned to auto distribution')
      : tr(`تم توزيع ${leadIds.length} ليد`, `${leadIds.length} leads assigned`));
    setUsers([]);
    onDone();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={tr(`توزيع ${leadIds.length} ليد`, `Assign ${leadIds.length} leads`)}>
      <p className="mb-3 text-sm text-slate-500">
        {tr('اختار سيلز واحد أو أكتر — الليدز هتتوزع عليهم بالتساوي (بالدور).', 'Pick one or more reps — leads are split evenly (round-robin).')}
      </p>
      <UserPicker users={active} value={users} onChange={setUsers} />
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <button className="btn-ghost" disabled={busy} onClick={() => run(true)}>{tr('رجوع للتوزيع التلقائي', 'Back to auto distribution')}</button>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>{tr('إلغاء', 'Cancel')}</button>
          <button className="btn-primary" disabled={busy} onClick={() => run(false)}>{busy ? tr('جاري…', 'Working…') : tr('توزيع', 'Assign')}</button>
        </div>
      </div>
    </Modal>
  );
}
