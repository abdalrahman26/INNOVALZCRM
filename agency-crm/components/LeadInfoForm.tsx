'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabase } from '@/lib/hooks';
import { SERVICES, SOURCES } from '@/lib/constants';
import { useI18n } from '@/lib/i18n';
import type { Lead } from '@/lib/types';

export const INFO_FIELDS = ['full_name', 'phone', 'email', 'company', 'job_title', 'service', 'source', 'campaign', 'budget', 'city'] as const;
type F = Record<(typeof INFO_FIELDS)[number], string>;

export function infoLabel(k: string, tr: (ar: string, en: string) => string) {
  const labels: Record<string, string> = {
    full_name: tr('الاسم', 'Name'), phone: tr('الموبايل', 'Phone'), email: tr('الإيميل', 'Email'),
    company: tr('الشركة / البراند', 'Company / Brand'), job_title: tr('المسمى الوظيفي', 'Job title'),
    service: tr('الخدمة', 'Service'), source: tr('المصدر', 'Source'), campaign: tr('الحملة', 'Campaign'),
    budget: tr('الميزانية', 'Budget'), city: tr('المدينة', 'City'),
  };
  return labels[k] ?? k;
}

/** بيانات العميل — أي حد شايف الليد يقدر يعدّلها، والتعديل بيتسجل في سجل النشاط */
export default function LeadInfoForm({
  lead, onSaved, bare = false, onDone,
}: { lead: Lead; onSaved: () => void; bare?: boolean; onDone?: () => void }) {
  const supabase = useSupabase();
  const { tr, L } = useI18n();
  const init = () => Object.fromEntries(INFO_FIELDS.map((k) => [k, (lead[k] as string | null) ?? ''])) as F;
  const [f, setF] = useState<F>(init);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(init()); }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = INFO_FIELDS.some((k) => (f[k] || '').trim() !== ((lead[k] as string | null) ?? ''));

  async function save() {
    if (saving) return;
    if (!f.full_name.trim()) return toast.error(tr('الاسم مطلوب', 'Name is required'));
    setSaving(true);
    const fields: Record<string, string> = {};
    INFO_FIELDS.forEach((k) => { fields[k] = f[k].trim(); });

    let { error } = await supabase.rpc('update_lead_info', { p_lead: lead.id, p_fields: fields });
    // لو كود الداتابيز v3 لسه مش متشغل: نعدّل مباشرة ونتأكد إن التعديل اتحفظ فعلاً
    if (error && /update_lead_info|function|schema cache/i.test(error.message)) {
      const patch: Record<string, string | null> = {};
      INFO_FIELDS.forEach((k) => { patch[k] = fields[k] || null; });
      const res = await supabase.from('leads').update(patch).eq('id', lead.id).select('id');
      error = res.error;
      if (!error && !(res.data ?? []).length) {
        setSaving(false);
        return toast.error(tr('مش عندك صلاحية تعدّل الليد ده — شغّل كود الداتابيز migration-v3.sql', "You can't edit this lead — run migration-v3.sql"));
      }
    }
    setSaving(false);
    if (error) {
      return toast.error(/duplicate|23505|phone_normalized/i.test(error.message + (error.code ?? ''))
        ? tr('الرقم ده موجود في ليد تاني', 'This phone exists on another lead')
        : error.message);
    }
    toast.success(tr('تم حفظ البيانات', 'Saved'));
    onSaved();
    onDone?.();
  }

  const fields = INFO_FIELDS.map((k) => {
    const list = k === 'service' ? SERVICES : k === 'source' ? SOURCES : null;
    return (
      <div key={k}>
        <label className="label">{infoLabel(k, tr)}</label>
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
  });

  if (bare) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">{fields}</div>
        <div className="flex justify-end gap-2">
          {onDone && <button className="btn-secondary btn-sm" onClick={onDone}>{tr('إلغاء', 'Cancel')}</button>}
          <button className="btn-primary btn-sm" disabled={saving || !dirty} onClick={save}><Save size={14} /> {tr('حفظ البيانات', 'Save details')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-bold">{tr('بيانات العميل', 'Client details')}</h2>
      {fields}
      {dirty && <button className="btn-primary w-full" disabled={saving} onClick={save}><Save size={16} /> {tr('حفظ التعديلات', 'Save changes')}</button>}
    </div>
  );
}
