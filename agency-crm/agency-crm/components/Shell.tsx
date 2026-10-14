'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, BellRing, LayoutDashboard, LogOut, Menu, ShieldCheck, Shuffle, Upload, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppContext } from './AppContext';
import NotificationBell from './NotificationBell';
import DistributionCountdown from './DistributionCountdown';
import { useSupabase } from '@/lib/hooks';
import { can, type Perm } from '@/lib/perms';
import { APP_NAME, ROLE_LABELS } from '@/lib/constants';
import type { Profile } from '@/lib/types';

const NAV: { href: string; label: string; icon: LucideIcon; perm?: Perm }[] = [
  { href: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { href: '/leads', label: 'الليدز', icon: Users },
  { href: '/followups', label: 'المتابعات', icon: BellRing },
  { href: '/import', label: 'استيراد شيت', icon: Upload, perm: 'import' },
  { href: '/distribution', label: 'التوزيع التلقائي', icon: Shuffle, perm: 'manage_distribution' },
  { href: '/reports', label: 'التقارير', icon: BarChart3, perm: 'reports' },
  { href: '/team', label: 'الفريق والصلاحيات', icon: ShieldCheck, perm: 'manage_team' },
];

export default function Shell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const supabase = useSupabase();
  const pathname = usePathname();
  const [team, setTeam] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);

  const refreshTeam = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    setTeam((data as Profile[]) ?? []);
  }, [supabase]);

  useEffect(() => { refreshTeam(); }, [refreshTeam]);
  useEffect(() => { setOpen(false); }, [pathname]);

  const nav = NAV.filter((n) => !n.perm || can(profile, n.perm));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <AppContext.Provider value={{ profile, team, refreshTeam }}>
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 right-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-200 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : 'translate-x-full'}`}
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
                <n.icon size={18} /> {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-slate-800 p-4">
            <div className="text-sm font-bold text-white">{profile.full_name}</div>
            <div className="mb-3 text-xs text-slate-400">{ROLE_LABELS[profile.role]}</div>
            <a href="/logout" className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
              <LogOut size={16} /> تسجيل خروج
            </a>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
            <button className="btn-ghost p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة"><Menu size={20} /></button>
            <div className="flex-1" />
            <DistributionCountdown />
            <NotificationBell />
          </header>
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </AppContext.Provider>
  );
}
