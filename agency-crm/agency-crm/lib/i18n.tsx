'use client';

import { createContext, useContext, useMemo } from 'react';
import { setFormatLocale } from './format';
import { LANG_COOKIE, type Lang } from './lang';

export type Bi = { ar: string; en: string };

type I18n = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  /** tr('عربي', 'English') */
  tr: (ar: string, en: string) => string;
  /** L({ ar, en }) */
  L: (o: Bi) => string;
};

function make(lang: Lang): I18n {
  return {
    lang,
    dir: lang === 'en' ? 'ltr' : 'rtl',
    tr: (ar, en) => (lang === 'en' ? en : ar),
    L: (o) => (lang === 'en' ? o.en : o.ar),
  };
}

const I18nContext = createContext<I18n>(make('ar'));

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  setFormatLocale(lang);
  const value = useMemo(() => make(lang), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export function setLangCookie(lang: Lang) {
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* ignore */
  }
}

export function applyDocumentLang(lang: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
}
