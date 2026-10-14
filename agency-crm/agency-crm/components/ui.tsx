'use client';

import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROLE_LABELS, stageOf } from '@/lib/constants';
import type { Profile } from '@/lib/types';

export function Modal({
  open, onClose, title, children, wide = false,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="إغلاق"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StageBadge({ status }: { status: string }) {
  const s = stageOf(status);
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${s.color}`}>{s.label}</span>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent ${className}`} />;
}

export function PageLoader() {
  return <div className="grid place-items-center py-24"><Spinner className="h-8 w-8" /></div>;
}

export function Empty({ text, icon: Icon }: { text: string; icon?: LucideIcon }) {
  return (
    <div className="py-12 text-center text-sm text-slate-400">
      {Icon && <Icon className="mx-auto mb-2 text-slate-300" size={36} />}
      {text}
    </div>
  );
}

export function NoAccess() {
  return <div className="card p-10 text-center text-slate-500">مش عندك صلاحية تفتح الصفحة دي.</div>;
}

export function StatCard({
  label, value, icon: Icon, tone = 'indigo', hint, onClick,
}: {
  label: string; value: React.ReactNode; icon: LucideIcon;
  tone?: 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky' | 'violet'; hint?: string; onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <div
      className={`card flex items-center gap-3 p-4 ${onClick ? 'cursor-pointer hover:border-indigo-300' : ''}`}
      onClick={onClick}
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tones[tone]}`}><Icon size={22} /></div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-500">{label}</div>
        <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{value}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
    </div>
  );
}

export function UserPicker({
  users, value, onChange,
}: { users: Profile[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="rounded-xl border border-slate-200 p-2">
      <div className="mb-1 flex justify-between px-1 text-xs">
        <button type="button" className="font-semibold text-indigo-600" onClick={() => onChange(users.map((u) => u.id))}>تحديد الكل</button>
        <button type="button" className="text-slate-500" onClick={() => onChange([])}>إلغاء التحديد</button>
      </div>
      <div className="max-h-60 space-y-0.5 overflow-y-auto">
        {users.map((u) => (
          <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
            <span className="text-sm font-medium">{u.full_name}</span>
            <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
          </label>
        ))}
        {!users.length && <p className="p-2 text-sm text-slate-400">مفيش يوزرز</p>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-block h-6 w-11 rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'right-0.5' : 'right-[22px]'}`} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
