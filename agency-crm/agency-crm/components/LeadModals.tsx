'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Modal, UserPicker } from './ui';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { SERVICES, SOURCES } from '@/lib/constants';

export function AddLeadModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { profile, team } = useApp();
  const supabase = useSupabase();
  const canAssign = can(profile, 'assign');
  const empty = { full_name: '', phone: '', email: '', company: '', job_title: '', service: '', source: '', budget: '', city: '', note: '' };
  const [f, setF] = useState(empty);
  const [assignTo, setAssignTo] = useState<string>(canAssign ? 'pool' : profile.id);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.full_name.trim() && !f.phone.trim()) return toast.error('اكتب الاسم أو الموبايل');
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
      return toast.error(error.code === '23505' ? 'الرقم ده موجود قبل كده في السيستم' : error.message);
    }
    if (note.trim()) await supabase.from('lead_notes').insert({ lead_id: data.id, user_id: profile.id, body: note.trim() });
    setSaving(false);
    toast.success('تمت إضافة الليد');
    setF(empty);
    onSaved();
    onClose();
  }

  const salesUsers = team.filter((u) => u.is_active);

  return (
    <Modal open={open} onClose={onClose} title="إضافة ليد جديد" wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">الاسم *</label><input className="input" value={f.full_name} onChange={set('full_name')} /></div>
          <div><label className="label">الموبايل</label><input className="input" dir="ltr" value={f.phone} onChange={set('phone')} /></div>
          <div><label className="label">الإيميل</label><input className="input" dir="ltr" value={f.email} onChange={set('email')} /></div>
          <div><label className="label">الشركة / البراند</label><input className="input" value={f.company} onChange={set('company')} /></div>
          <div>
            <label className="label">الخدمة المطلوبة</label>
            <select className="input" value={f.service} onChange={set('service')}>
              <option value="">—</option>{SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">المصدر</label>
            <select className="input" value={f.source} onChange={set('source')}>
              <option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label className="label">الميزانية</label><input className="input" value={f.budget} onChange={set('budget')} /></div>
          <div><label className="label">المدينة</label><input className="input" value={f.city} onChange={set('city')} /></div>
        </div>
        <div><label className="label">ملاحظة</label><textarea className="input" rows={2} value={f.note} onChange={set('note')} /></div>
        {canAssign && (
          <div>
            <label className="label">التوزيع</label>
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="pool">يدخل التوزيع التلقائي</option>
              <option value="hold">يفضل بدون توزيع</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>تحويل لـ {u.full_name}</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" disabled={saving}>{saving ? 'جاري الحفظ…' : 'حفظ'}</button>
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
  const [users, setUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const active = team.filter((u) => u.is_active);

  async function run(toPool: boolean) {
    if (!toPool && !users.length) return toast.error('اختار سيلز واحد على الأقل');
    setBusy(true);
    const { error } = await supabase.rpc('assign_leads', { p_lead_ids: leadIds, p_user_ids: toPool ? [] : users });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(toPool ? 'رجعت الليدز للتوزيع التلقائي' : `تم توزيع ${leadIds.length} ليد`);
    setUsers([]);
    onDone();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`توزيع ${leadIds.length} ليد`}>
      <p className="mb-3 text-sm text-slate-500">
        اختار سيلز واحد أو أكتر — الليدز هتتوزع عليهم بالتساوي (بالدور).
      </p>
      <UserPicker users={active} value={users} onChange={setUsers} />
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <button className="btn-ghost" disabled={busy} onClick={() => run(true)}>رجوع للتوزيع التلقائي</button>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" disabled={busy} onClick={() => run(false)}>توزيع</button>
        </div>
      </div>
    </Modal>
  );
}
