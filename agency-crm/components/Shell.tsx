'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, BellRing, Languages, LayoutDashboard, LogOut, Menu, ShieldCheck, Shuffle, Upload, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { AppContext } from './AppContext';
import NotificationBell from './NotificationBell';
import DistributionCountdown from './DistributionCountdown';
import LeadQuickModal from './LeadQuickModal';
import { useSupabase } from '@/lib/hooks';
import { can, type Perm } from '@/lib/perms';
import { APP_NAME, ROLE_LABELS } from '@/lib/constants';
import { I18nProvider, applyDocumentLang, setLangCookie, useI18n } from '@/lib/i18n';
import { normLang, type Lang } from '@/lib/lang';
import type { Profile } from '@/lib/types';

const NAV: { href: string; ar: string; en: string; icon: LucideIcon; perm?: Perm }[] = [
  { href: '/', ar: 'الرئيسية', en: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', ar: 'الليدز', en: 'Leads', icon: Users },
  { href: '/followups', ar: 'المتابعات', en: 'Follow-ups', icon: BellRing },
  { href: '/import', ar: 'استيراد شيت', en: 'Import sheet', icon: Upload, perm: 'import' },
  { href: '/distribution', ar: 'التوزيع التلقائي', en: 'Auto distribution', icon: Shuffle, perm: 'manage_distribution' },
  { href: '/reports', ar: 'التقارير', en: 'Reports', icon: BarChart3, perm: 'reports' },
  { href: '/team', ar: 'الفريق والصلاحيات', en: 'Team & permissions', icon: ShieldCheck, perm: 'manage_team' },
];

export default function Shell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  // لغة اليوزر: من البروفايل (لو اتحفظت) وإلا من الكوكي
  const outer = useI18n();
  const lang: Lang = normLang(profile.locale) ?? outer.lang;

  useEffect(() => {
    applyDocumentLang(lang);
    if (outer.lang !== lang) setLangCookie(lang);
  }, [lang, outer.lang]);

  return (
    <I18nProvider lang={lang}>
      <ShellInner profile={profile}>{children}</ShellInner>
    </I18nProvider>
  );
}

function ShellInner({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const supabase = useSupabase();
  const pathname = usePathname();
  const { tr, L, lang } = useI18n();
  const [team, setTeam] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<{ id: string; onChanged?: () => void } | null>(null);
  const [switching, setSwitching] = useState(false);

  const refreshTeam = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    setTeam((data as Profile[]) ?? []);
  }, [supabase]);

  const openLead = useCallback((id: string, onChanged?: () => void) => setQuick({ id, onChanged }), []);

  useEffect(() => { refreshTeam(); }, [refreshTeam]);
  useEffect(() => { setOpen(false); setQuick(null); }, [pathname]);

  async function switchLang() {
    const next: Lang = lang === 'en' ? 'ar' : 'en';
    setSwitching(true);
    const { error } = await supabase.rpc('set_my_locale', { p_locale: next });
    if (error && profile.locale) {
      setSwitching(false);
      toast.error(error.message);
      return;
    }
    setLangCookie(next);
    window.location.reload();
  }

  const nav = NAV.filter((n) => !n.perm || can(profile, n.perm));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <AppContext.Provider value={{ profile, team, refreshTeam, openLead }}>
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-200 transition-transform lg:sticky lg:top-0 lg:h-screen ${open ? '' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full'}`}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <Link href="/" className="flex items-center gap-2 font-extrabold text-white">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500">{APP_NAME.slice(0, 1)}</span>
              {APP_NAME}
            </Link>
            <button className="lg:hidden" onClick={() => setOpen(false)}><X size={20} /></button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive(n.href) ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
              >
                <n.icon size={18} /> {L(n)}
              </Link>
            ))}
          </nav>
          <div className="space-y-3 border-t border-slate-800 p-4">
            <div>
              <div className="text-sm font-bold text-white">{profile.full_name}</div>
              <div className="text-xs text-slate-400">{ROLE_LABELS[profile.role] ? L(ROLE_LABELS[profile.role]) : profile.role}</div>
            </div>
            <button onClick={switchLang} disabled={switching} className="flex items-center gap-2 text-sm text-slate-300 hover:text-white disabled:opacity-50">
              <Languages size={16} /> {lang === 'en' ? 'عربي' : 'English'}
            </button>
            <a href="/logout" className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
              <LogOut size={16} /> {tr('تسجيل خروج', 'Sign out')}
            </a>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
            <button className="btn-ghost p-2 lg:hidden" onClick={() => setOpen(true)} aria-label={tr('القائمة', 'Menu')}><Menu size={20} /></button>
            <div className="flex-1" />
            <DistributionCountdown />
            <NotificationBell />
          </header>
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
      {quick && (
        <LeadQuickModal
          leadId={quick.id}
          onClose={() => setQuick(null)}
          onChanged={quick.onChanged}
        />
      )}
    </AppContext.Provider>
  );
}
