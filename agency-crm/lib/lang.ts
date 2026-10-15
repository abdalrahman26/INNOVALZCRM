export type Lang = 'ar' | 'en';

export const LANG_COOKIE = 'crm_locale';

export const normLang = (v?: string | null): Lang | null => (v === 'en' ? 'en' : v === 'ar' ? 'ar' : null);
