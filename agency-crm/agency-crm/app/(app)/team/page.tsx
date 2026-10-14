'use client';

import { useState } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { Modal, NoAccess, Toggle } from '@/components/ui';
import { can } from '@/lib/perms';
import { PERMISSION_FLAGS, ROLE_LABELS } from '@/lib/constants';
import type { Profile, Role } from '@/lib/types';
import { createUserAction, updateUserAction, type UserInput } from './actions';

const ROLE_DEFAULTS: Record<Role, Partial<UserInput>> = {
  admin: { can_import: true, can_export: true, can_assign: true, can_delete: true, can_view_all: true, receives_auto_leads: false },
  manager: { can_import: true, can_export: true, can_assign: true, can_delete: false, can_view_all: true, receives_auto_leads: false },
  sales: { can_import: false, can_export: false, can_assign: false, can_delete: false, can_view_all: false, receives_auto_leads: true },
};

const blank = (): UserInput => ({
  full_name: '', email: '', password: '', phone: '', role: 'sales', is_active: true,
  receives_auto_leads: true, daily_cap: null,
  can_import: false, can_export: false, can_assign: false, can_delete: false, can_view_all: false,
});

export default function TeamPage() {
  const { profile, team, refreshTeam } = useApp();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);

  if (!can(profile, 'manage_team')) return <NoAccess />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">الفريق والصلاحيات</h1>
          <p className="text-sm text-slate-500">{team.length} يوزر</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} /> إضافة يوزر</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-slate-50"><tr>
              <th className="th">الاسم</th><th className="th">الإيميل</th><th className="th">الدور</th><th className="th">الصلاحيات</th><th className="th">الحالة</th><th className="th" />
            </tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id} className={`border-t border-slate-100 ${u.is_active ? '' : 'opacity-50'}`}>
                  <td className="td font-semibold">{u.full_name}</td>
                  <td className="td text-xs" dir="ltr">{u.email}</td>
                  <td className="td text-xs">{ROLE_LABELS[u.role]}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {u.role === 'admin' ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">كل الصلاحيات</span> :
                        PERMISSION_FLAGS.filter((p) => u[p.key]).map((p) => (
                          <span key={p.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{p.label}</span>
                        ))}
                      {u.receives_auto_leads && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">توزيع تلقائي</span>}
                    </div>
                  </td>
                  <td className="td text-xs">{u.is_active ? '✅ نشط' : '⛔ موقوف'}</td>
                  <td className="td"><button className="btn-ghost btn-sm" onClick={() => setEditing(u)}><Pencil size={14} /> تعديل</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && <UserForm onClose={() => setCreating(false)} onSaved={refreshTeam} />}
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={refreshTeam} />}
    </div>
  );
}

function UserForm({ user, onClose, onSaved }: { user?: Profile; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState<UserInput>(() => user ? {
    full_name: user.full_name, email: user.email ?? '', password: '', phone: user.phone ?? '', role: user.role, is_active: user.is_active,
    receives_auto_leads: user.receives_auto_leads, daily_cap: user.daily_cap,
    can_import: user.can_import, can_export: user.can_export, can_assign: user.can_assign, can_delete: user.can_delete, can_view_all: user.can_view_all,
  } : blank());
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.full_name.trim() || !f.email.trim()) return toast.error('الاسم والإيميل مطلوبين');
    setSaving(true);
    const res = user ? await updateUserAction(user.id, f) : await createUserAction(f);
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(user ? 'تم الحفظ' : 'تم إنشاء الحساب — ابعت له الإيميل والباسورد');
    await onSaved();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={user ? `تعديل ${user.full_name}` : 'إضافة يوزر جديد'} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">الاسم *</label><input className="input" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></div>
          <div><label className="label">الإيميل *</label><input className="input" dir="ltr" type="email" disabled={!!user} value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div>
            <label className="label">{user ? 'باسورد جديد (سيبه فاضي لو مش هتغيره)' : 'الباسورد *'}</label>
            <input className="input" dir="ltr" type="text" value={f.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          <div><label className="label">الموبايل</label><input className="input" dir="ltr" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></div>
        </div>

        <div>
          <label className="label">الدور</label>
          <div className="flex flex-wrap gap-1.5">
            {(['sales', 'manager', 'admin'] as Role[]).map((r) => (
              <button key={r} type="button" className={f.role === r ? 'chip-on' : 'chip-off'}
                onClick={() => setF((p) => ({ ...p, role: r, ...ROLE_DEFAULTS[r] }))}>
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {f.role === 'admin' ? 'كل حاجة: الفريق، الإعدادات، كل الليدز.' :
              f.role === 'manager' ? 'يشوف ويعدّل كل الليدز، يتحكم في التوزيع، ويشوف التقارير.' :
                'يشوف ليدزه بس ويسجّل تواصل ومتابعات.'}
          </p>
        </div>

        {f.role !== 'admin' && (
          <div>
            <label className="label">صلاحيات إضافية</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSION_FLAGS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={f[p.key]} onChange={(e) => set(p.key, e.target.checked)} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
          <Toggle checked={f.receives_auto_leads} onChange={(v) => set('receives_auto_leads', v)} label="يستقبل ليدز من التوزيع التلقائي" />
          <div className="flex items-center gap-2 text-sm">
            حد أقصى يومي
            <input type="number" min={0} className="input w-24 py-1" dir="ltr" placeholder="مفتوح" value={f.daily_cap ?? ''}
              onChange={(e) => set('daily_cap', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
          </div>
          {user && <Toggle checked={f.is_active ?? true} onChange={(v) => set('is_active', v)} label={f.is_active ? 'الحساب نشط' : 'الحساب موقوف (مش هيقدر يدخل)'} />}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" disabled={saving}>{saving ? 'جاري الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </Modal>
  );
}
