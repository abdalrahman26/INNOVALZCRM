import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';
import { I18nProvider } from '@/lib/i18n';
import { LANG_COOKIE, normLang } from '@/lib/lang';
import './globals.css';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'Agency CRM',
  description: 'Agency sales CRM',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = normLang((await cookies()).get(LANG_COOKIE)?.value) ?? 'ar';
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <Toaster position="top-center" richColors dir={dir} closeButton />
      </body>
    </html>
  );
}
