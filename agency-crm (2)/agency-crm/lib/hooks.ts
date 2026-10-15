'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DistributionSettings } from './types';

export function useSupabase() {
  return useMemo(() => createClient(), []);
}

/** إعدادات التوزيع + عدد الليدز المنتظرة (تحديث كل 30 ثانية) */
export function useDistribution(pollMs = 30_000) {
  const supabase = useSupabase();
  const [settings, setSettings] = useState<DistributionSettings | null>(null);
  const [pool, setPool] = useState(0);

  const reload = useCallback(async () => {
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase.from('distribution_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('pool_count'),
    ]);
    setSettings((s as DistributionSettings) ?? null);
    setPool(typeof c === 'number' ? c : 0);
  }, [supabase]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { settings, pool, reload };
}
