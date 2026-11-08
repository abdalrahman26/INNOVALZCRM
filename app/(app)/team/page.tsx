'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, Pencil, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { Modal, NoAccess, Toggle } from '@/components/ui';
import { can } from '@/lib/perms';
import { useSupabase } from '@/lib/hooks';
import { PERMISSION_FLAGS, ROLE_LABELS } from '@/lib/constants';
import { useI18n } from '@/lib/i18n';
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
  const { tr, L } = useI18n();
  const supabase = useSupabase();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!can(profile, 'manage_team')) return <NoAccess />;

  // التحكم السريع: السيلز يشوف ليدزه بس ولا كل الليدز
  async function toggleViewAll(u: Profile) {
    if (busyId) return;
    setBusyId(u.id);
    const next = !u.can_view_all;
    const { data, error } = await supabase.from('profiles').update({ can_view_all: next }).eq('id', u.id).select('id');
    setBusyId(null);
    if (error || !data?.length) return toast.error(error?.message ?? tr('الصلاحية دي للأدمن بس', 'Admins only'));
    toast.success(next
      ? tr(`${u.full_name} بقى يشوف كل الليدز`, `${u.full_name} can now see all leads`)
      : tr(`${u.full_name} بقى يشوف ليدزه بس`, `${u.full_name} now sees only their own leads`));
    await refreshTeam();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{tr('الفريق والصلاحيات', 'Team & permissions')}</h1>
          <p className="text-sm text-slate-500">{team.length} {tr('يوزر', 'users')}</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><UserPlus size={16} /> {tr('إضافة يوزر', 'Add user')}</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-slate-50"><tr>
              <th className="th">{tr('الاسم', 'Name')}</th><th className="th">{tr('الإيميل', 'Email')}</th><th className="th">{tr('الدور', 'Role')}</th><th className="th">{tr('بيشوف', 'Sees')}</th><th className="th">{tr('الصلاحيات', 'Permissions')}</th><th className="th">{tr('الحالة', 'Status')}</th><th className="th" />
            </tr></thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id} className={`border-t border-slate-100 ${u.is_active ? '' : 'opacity-50'}`}>
                  <td className="td font-semibold">{u.full_name}</td>
                  <td className="td text-xs" dir="ltr">{u.email}</td>
                  <td className="td text-xs">{ROLE_LABELS[u.role] ? L(ROLE_LABELS[u.role]) : u.role}</td>
                  <td className="td">
                    {u.role === 'sales' ? (
                      <button onClick={() => toggleViewAll(u)} disabled={busyId === u.id}
                        title={tr('دوس عشان تغيّر', 'Click to change')}
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold transition ${u.can_view_all
                          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                        {u.can_view_all ? <Eye size={13} /> : <EyeOff size={13} />}
                        {u.can_view_all ? tr('كل الليدز', 'All leads') : tr('ليدزه بس', 'Own leads only')}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-500"
                        title={tr('المدير والأدمن بيشوفوا كل الليدز دايماً — غيّر الدور لـ «سيلز» لو عاوز تقفلها', 'Managers and admins always see all leads — change the role to Sales to restrict')}>
                        <Lock size={12} /> {tr('كل الليدز (بسبب الدور)', 'All leads (role)')}
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {u.role === 'admin' ? <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{tr('كل الصلاحيات', 'All permissions')}</span> :
                        PERMISSION_FLAGS.filter((p) => p.key !== 'can_view_all' && u[p.key]).map((p) => (
                          <span key={p.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{L(p)}</span>
                        ))}
                      {u.receives_auto_leads && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{tr('توزيع تلقائي', 'Auto leads')}</span>}
                    </div>
                  </td>
                  <td className="td text-xs">{u.is_active ? tr('✅ نشط', '✅ Active') : tr('⛔ موقوف', '⛔ Disabled')}</td>
                  <td className="td"><button className="btn-ghost btn-sm" onClick={() => setEditing(u)}><Pencil size={14} /> {tr('تعديل', 'Edit')}</button></td>
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
  const { tr, L, lang } = useI18n();
  const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!f.full_name.trim() || !f.email.trim()) return toast.error(tr('الاسم والإيميل مطلوبين', 'Name and email are required'));
    setSaving(true);
    const res = user ? await updateUserAction(user.id, f) : await createUserAction(f);
    setSaving(false);
    if (!res.ok) return toast.error(lang === 'en' && res.error_en ? res.error_en : res.error);
    toast.success(user ? tr('تم الحفظ', 'Saved') : tr('تم إنشاء الحساب — ابعت له الإيميل والباسورد', 'Account created — send them the email and password'));
    await onSaved();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={user ? `${tr('تعديل', 'Edit')} ${user.full_name}` : tr('إضافة يوزر جديد', 'Add new user')} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">{tr('الاسم *', 'Name *')}</label><input className="input" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></div>
          <div><label className="label">{tr('الإيميل *', 'Email *')}</label><input className="input" dir="ltr" type="email" disabled={!!user} value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div>
            <label className="label">{user ? tr('باسورد جديد (سيبه فاضي لو مش هتغيره)', 'New password (leave empty to keep)') : tr('الباسورد *', 'Password *')}</label>
            <input className="input" dir="ltr" type="text" value={f.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          <div><label className="label">{tr('الموبايل', 'Phone')}</label><input className="input" dir="ltr" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></div>
        </div>

        <div>
          <label className="label">{tr('الدور', 'Role')}</label>
          <div className="flex flex-wrap gap-1.5">
            {(['sales', 'manager', 'admin'] as Role[]).map((r) => (
              <button key={r} type="button" className={f.role === r ? 'chip-on' : 'chip-off'}
                onClick={() => setF((p) => ({ ...p, role: r, ...ROLE_DEFAULTS[r] }))}>
                {L(ROLE_LABELS[r])}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {f.role === 'admin' ? tr('كل حاجة: الفريق، الإعدادات، كل الليدز.', 'Everything: team, settings, all leads.') :
              f.role === 'manager' ? tr('يشوف ويعدّل كل الليدز، يتحكم في التوزيع، ويشوف التقارير.', 'Sees and edits all leads, controls distribution, sees reports.') :
                tr('يشوف ليدزه بس ويسجّل تواصل ومتابعات.', 'Sees only their own leads; logs contacts and follow-ups.')}
          </p>
        </div>

        {f.role !== 'admin' && (
          <div>
            <label className="label">{tr('صلاحيات إضافية', 'Extra permissions')}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSION_FLAGS.map((p) => {
                const locked = p.key === 'can_view_all' && f.role === 'manager';
                return (
                  <label key={p.key} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${p.key === 'can_view_all' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'} ${locked ? 'opacity-60' : ''}`}>
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" disabled={locked} checked={locked || f[p.key]} onChange={(e) => set(p.key, e.target.checked)} />
                    {L(p)}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {f.role === 'manager'
                ? tr('🔒 مدير المبيعات بيشوف كل الليدز دايماً. لو عاوزه يشوف ليدزه بس خلّي دوره «سيلز».', '🔒 Sales managers always see all leads. Set the role to Sales to restrict them.')
                : f.can_view_all
                  ? tr('👁 هيشوف كل ليدز الشركة.', '👁 Will see every lead in the company.')
                  : tr('✅ هيشوف الليدز اللي باسمه بس.', '✅ Will see only the leads assigned to them.')}
            </p>
          </div>
        )}

        <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
          <Toggle checked={f.receives_auto_leads} onChange={(v) => set('receives_auto_leads', v)} label={tr('يستقبل ليدز من التوزيع التلقائي', 'Receives auto-distributed leads')} />
          <div className="flex items-center gap-2 text-sm">
            {tr('حد أقصى يومي', 'Daily cap')}
            <input type="number" min={0} className="input w-24 py-1" dir="ltr" placeholder={tr('مفتوح', 'No limit')} value={f.daily_cap ?? ''}
              onChange={(e) => set('daily_cap', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
          </div>
          {user && <Toggle checked={f.is_active ?? true} onChange={(v) => set('is_active', v)} label={f.is_active ? tr('الحساب نشط', 'Account active') : tr('الحساب موقوف (مش هيقدر يدخل)', 'Account disabled (cannot sign in)')} />}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{tr('إلغاء', 'Cancel')}</button>
          <button className="btn-primary" disabled={saving}>{saving ? tr('جاري الحفظ…', 'Saving…') : tr('حفظ', 'Save')}</button>
        </div>
      </form>
    </Modal>
  );
}
