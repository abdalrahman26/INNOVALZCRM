// ============================================================
//  إعدادات السيستم — عدّل القوائم دي براحتك
// ============================================================

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Agency CRM';

/** مراحل البيع (Pipeline) — الـ value لازم تفضل إنجليزي */
export const STAGES = [
  { value: 'new', label: 'جديد', color: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' },
  { value: 'contacted', label: 'تم التواصل', color: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500' },
  { value: 'no_answer', label: 'لم يرد', color: 'bg-slate-200 text-slate-700', bar: 'bg-slate-400' },
  { value: 'interested', label: 'مهتم', color: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  { value: 'meeting', label: 'اجتماع محدد', color: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500' },
  { value: 'proposal', label: 'تم إرسال عرض', color: 'bg-fuchsia-100 text-fuchsia-700', bar: 'bg-fuchsia-500' },
  { value: 'negotiation', label: 'تفاوض', color: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  { value: 'won', label: 'تم التعاقد ✅', color: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  { value: 'lost', label: 'خسارة', color: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
] as const;

export const stageOf = (v: string | null | undefined) =>
  STAGES.find((s) => s.value === v) ?? { value: v ?? '', label: v ?? '—', color: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' };

/** خدمات الإيجنسي */
export const SERVICES = [
  'إدارة سوشيال ميديا',
  'إعلانات ممولة',
  'SEO',
  'تصميم موقع',
  'متجر إلكتروني',
  'هوية بصرية',
  'تصوير وفيديو',
  'كتابة محتوى',
  'باقة متكاملة',
];

/** مصادر الليدز */
export const SOURCES = [
  'Meta Ads',
  'TikTok Ads',
  'Google Ads',
  'Snapchat Ads',
  'LinkedIn',
  'الموقع',
  'واتساب',
  'ترشيح (Referral)',
  'Cold Call',
  'معرض / إيفنت',
  'أخرى',
];

export const LOST_REASONS = ['السعر', 'اختار منافس', 'مش جاهز دلوقتي', 'مش مهتم', 'رقم غلط / مش بيرد', 'أخرى'];

export const FOLLOWUP_TYPES = [
  { value: 'call', label: 'مكالمة 📞' },
  { value: 'whatsapp', label: 'واتساب 💬' },
  { value: 'meeting', label: 'اجتماع 🤝' },
  { value: 'email', label: 'إيميل ✉️' },
];
export const followupTypeLabel = (v: string) => FOLLOWUP_TYPES.find((t) => t.value === v)?.label ?? v;

export const FOLLOWUP_PRESETS = [
  { key: '30m', label: 'بعد 30 د' },
  { key: '1h', label: 'بعد ساعة' },
  { key: '2h', label: 'بعد ساعتين' },
  { key: 'tomorrow', label: 'بكرة 10 ص' },
  { key: '3d', label: 'بعد 3 أيام' },
  { key: '1w', label: 'بعد أسبوع' },
  { key: 'custom', label: 'موعد مخصص' },
] as const;

export function presetToDate(key: string, custom?: string): Date | null {
  const now = new Date();
  const plus = (min: number) => new Date(now.getTime() + min * 60_000);
  switch (key) {
    case '30m': return plus(30);
    case '1h': return plus(60);
    case '2h': return plus(120);
    case 'tomorrow': {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      t.setHours(10, 0, 0, 0);
      return t;
    }
    case '3d': return plus(3 * 24 * 60);
    case '1w': return plus(7 * 24 * 60);
    case 'custom': return custom ? new Date(custom) : null;
    default: return null;
  }
}

export const ROLE_LABELS: Record<string, string> = { admin: 'أدمن', manager: 'مدير مبيعات', sales: 'سيلز' };

export const PERMISSION_FLAGS = [
  { key: 'can_view_all', label: 'يشوف كل الليدز' },
  { key: 'can_assign', label: 'يوزّع ويحوّل ليدز' },
  { key: 'can_import', label: 'استيراد شيتات' },
  { key: 'can_export', label: 'تصدير' },
  { key: 'can_delete', label: 'حذف ليدز' },
] as const;

export const WEEK_DAYS = [
  { value: 6, label: 'السبت' },
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الاتنين' },
  { value: 2, label: 'التلات' },
  { value: 3, label: 'الأربع' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
];

export const TIMEZONES = [
  { value: 'Africa/Cairo', label: 'القاهرة' },
  { value: 'Asia/Riyadh', label: 'الرياض' },
  { value: 'Asia/Dubai', label: 'دبي' },
];
