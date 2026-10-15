// ============================================================
//  إعدادات السيستم — عدّل القوائم دي براحتك (عربي + إنجليزي)
//  ملحوظة: الـ value هو اللي بيتسجل في الداتابيز — متغيرهوش للبيانات الموجودة
// ============================================================

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Agency CRM';

export type Opt = { value: string; ar: string; en: string };

/** مراحل البيع (Pipeline) */
export const STAGES = [
  { value: 'new', ar: 'جديد', en: 'New', color: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' },
  { value: 'contacted', ar: 'تم التواصل', en: 'Contacted', color: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500' },
  { value: 'no_answer', ar: 'لم يرد', en: 'No answer', color: 'bg-slate-200 text-slate-700', bar: 'bg-slate-400' },
  { value: 'interested', ar: 'مهتم', en: 'Interested', color: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  { value: 'meeting', ar: 'اجتماع محدد', en: 'Meeting set', color: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500' },
  { value: 'proposal', ar: 'تم إرسال عرض', en: 'Proposal sent', color: 'bg-fuchsia-100 text-fuchsia-700', bar: 'bg-fuchsia-500' },
  { value: 'negotiation', ar: 'تفاوض', en: 'Negotiation', color: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  { value: 'won', ar: 'تم التعاقد ✅', en: 'Won ✅', color: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  { value: 'lost', ar: 'خسارة', en: 'Lost', color: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
] as const;

export const stageOf = (v: string | null | undefined) =>
  STAGES.find((s) => s.value === v) ?? { value: v ?? '', ar: v ?? '—', en: v ?? '—', color: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' };

/** خدمات الإيجنسي */
export const SERVICES: Opt[] = [
  { value: 'إدارة سوشيال ميديا', ar: 'إدارة سوشيال ميديا', en: 'Social Media Management' },
  { value: 'إعلانات ممولة', ar: 'إعلانات ممولة', en: 'Paid Ads' },
  { value: 'SEO', ar: 'SEO', en: 'SEO' },
  { value: 'تصميم موقع', ar: 'تصميم موقع', en: 'Website Design' },
  { value: 'متجر إلكتروني', ar: 'متجر إلكتروني', en: 'E-commerce Store' },
  { value: 'هوية بصرية', ar: 'هوية بصرية', en: 'Brand Identity' },
  { value: 'تصوير وفيديو', ar: 'تصوير وفيديو', en: 'Photo & Video' },
  { value: 'كتابة محتوى', ar: 'كتابة محتوى', en: 'Content Writing' },
  { value: 'باقة متكاملة', ar: 'باقة متكاملة', en: 'Full Package' },
];

/** مصادر الليدز */
export const SOURCES: Opt[] = [
  { value: 'Meta Ads', ar: 'Meta Ads', en: 'Meta Ads' },
  { value: 'TikTok Ads', ar: 'TikTok Ads', en: 'TikTok Ads' },
  { value: 'Google Ads', ar: 'Google Ads', en: 'Google Ads' },
  { value: 'Snapchat Ads', ar: 'Snapchat Ads', en: 'Snapchat Ads' },
  { value: 'LinkedIn', ar: 'LinkedIn', en: 'LinkedIn' },
  { value: 'الموقع', ar: 'الموقع', en: 'Website' },
  { value: 'واتساب', ar: 'واتساب', en: 'WhatsApp' },
  { value: 'ترشيح (Referral)', ar: 'ترشيح (Referral)', en: 'Referral' },
  { value: 'Cold Call', ar: 'Cold Call', en: 'Cold Call' },
  { value: 'معرض / إيفنت', ar: 'معرض / إيفنت', en: 'Event / Exhibition' },
  { value: 'أخرى', ar: 'أخرى', en: 'Other' },
];

export const LOST_REASONS: Opt[] = [
  { value: 'السعر', ar: 'السعر', en: 'Price' },
  { value: 'اختار منافس', ar: 'اختار منافس', en: 'Chose a competitor' },
  { value: 'مش جاهز دلوقتي', ar: 'مش جاهز دلوقتي', en: 'Not ready yet' },
  { value: 'مش مهتم', ar: 'مش مهتم', en: 'Not interested' },
  { value: 'رقم غلط / مش بيرد', ar: 'رقم غلط / مش بيرد', en: 'Wrong number / no response' },
  { value: 'أخرى', ar: 'أخرى', en: 'Other' },
];

const MISC: Opt[] = [
  { value: 'غير محدد', ar: 'غير محدد', en: 'Unspecified' },
  { value: 'Webhook', ar: 'Webhook', en: 'Webhook' },
];

/** يرجّع الاختيار (أو القيمة زي ما هي لو مش في القائمة) */
export function findOpt(list: Opt[], v: string | null | undefined): Opt {
  const s = v ?? '';
  return list.find((o) => o.value === s) ?? MISC.find((o) => o.value === s) ?? { value: s, ar: s, en: s };
}

export const FOLLOWUP_TYPES: Opt[] = [
  { value: 'call', ar: 'مكالمة 📞', en: 'Call 📞' },
  { value: 'whatsapp', ar: 'واتساب 💬', en: 'WhatsApp 💬' },
  { value: 'meeting', ar: 'اجتماع 🤝', en: 'Meeting 🤝' },
  { value: 'email', ar: 'إيميل ✉️', en: 'Email ✉️' },
];

export const FOLLOWUP_PRESETS = [
  { key: '30m', ar: 'بعد 30 د', en: 'In 30 min' },
  { key: '1h', ar: 'بعد ساعة', en: 'In 1 hour' },
  { key: '2h', ar: 'بعد ساعتين', en: 'In 2 hours' },
  { key: 'tomorrow', ar: 'بكرة 10 ص', en: 'Tomorrow 10 AM' },
  { key: '3d', ar: 'بعد 3 أيام', en: 'In 3 days' },
  { key: '1w', ar: 'بعد أسبوع', en: 'In 1 week' },
  { key: 'custom', ar: 'موعد مخصص', en: 'Custom' },
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

export const ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  admin: { ar: 'أدمن', en: 'Admin' },
  manager: { ar: 'مدير مبيعات', en: 'Sales Manager' },
  sales: { ar: 'سيلز', en: 'Sales' },
};

export const PERMISSION_FLAGS = [
  { key: 'can_view_all', ar: 'يشوف كل الليدز', en: 'View all leads' },
  { key: 'can_assign', ar: 'يوزّع ويحوّل ليدز', en: 'Assign / transfer leads' },
  { key: 'can_import', ar: 'استيراد شيتات', en: 'Import sheets' },
  { key: 'can_export', ar: 'تصدير', en: 'Export' },
  { key: 'can_delete', ar: 'حذف ليدز', en: 'Delete leads' },
] as const;

export const WEEK_DAYS = [
  { value: 6, ar: 'السبت', en: 'Sat' },
  { value: 0, ar: 'الأحد', en: 'Sun' },
  { value: 1, ar: 'الاتنين', en: 'Mon' },
  { value: 2, ar: 'التلات', en: 'Tue' },
  { value: 3, ar: 'الأربع', en: 'Wed' },
  { value: 4, ar: 'الخميس', en: 'Thu' },
  { value: 5, ar: 'الجمعة', en: 'Fri' },
];

export const TIMEZONES = [
  { value: 'Africa/Cairo', ar: 'القاهرة', en: 'Cairo' },
  { value: 'Asia/Riyadh', ar: 'الرياض', en: 'Riyadh' },
  { value: 'Asia/Dubai', ar: 'دبي', en: 'Dubai' },
];
