'use client';

import { createContext, useContext } from 'react';
import type { Profile } from '@/lib/types';

export type AppCtx = {
  profile: Profile;
  team: Profile[];
  refreshTeam: () => Promise<void>;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <Shell>');
  return ctx;
}
