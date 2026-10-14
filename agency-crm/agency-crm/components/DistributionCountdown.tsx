'use client';

import { useEffect, useRef, useState } from 'react';
import { Timer, Zap } from 'lucide-react';
import { useApp } from './AppContext';
import { useDistribution } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtCountdown, fmtDateTime } from '@/lib/format';

/** عدّاد الدفعة الجاية من التوزيع التلقائي */
export default function DistributionCountdown({ big = false }: { big?: boolean }) {
  const { profile } = useApp();
  const { settings: s, pool, reload } = useDistribution();
  const [now, setNow] = useState(() => Date.now());
  const lastReload = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nextMs = s?.next_run_at ? new Date(s.next_run_at).getTime() - now : null;

  // لما العداد يخلص، نحدّث البيانات بعد التوزيع
  useEffect(() => {
    if (nextMs !== null && nextMs < -3000 && Date.now() - lastReload.current > 15_000) {
      lastReload.current = Date.now();
      reload();
    }
  }, [nextMs, reload]);

  const isManager = can(profile, 'manage_distribution');
  if (!s) return null;

  if (!s.enabled || !s.next_run_at || nextMs === null) {
    if (big && isManager) {
      return (
        <div className="card flex items-center gap-3 p-4 text-sm text-slate-500">
          <Zap size={20} className="text-slate-400" /> التوزيع التلقائي متوقف حالياً
        </div>
      );
    }
    return null;
  }
  if (!isManager && (!s.show_countdown || !profile.receives_auto_leads)) return null;

  const count = Math.min(s.batch_size, pool);
  const long = nextMs > 6 * 3600_000;
  const timeText = nextMs <= 0 ? 'جاري التوزيع…' : long ? fmtDateTime(s.next_run_at) : fmtCountdown(nextMs);

  if (big) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 bg-gradient-to-l from-indigo-600 to-violet-600 p-5 text-white">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15"><Timer size={28} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm opacity-90">الدفعة الجاية من الليدز</div>
            {isManager ? (
              <div className="text-lg font-bold">{s.batch_size} ليد لكل سيلز · في الانتظار {pool}</div>
            ) : count > 0 ? (
              <div className="text-lg font-bold">هينزلك {count} ليد جديد</div>
            ) : (
              <div className="text-lg font-bold">مفيش ليدز في الانتظار دلوقتي</div>
            )}
          </div>
          <div className="text-left">
            <div className="text-3xl font-extrabold tabular-nums" dir="ltr">{timeText}</div>
            <div className="text-xs opacity-80">كل {s.interval_minutes} دقيقة</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700">
      <Timer size={16} />
      <span className="hidden sm:inline">
        {isManager ? `الدفعة الجاية (${pool} منتظر)` : count > 0 ? `هينزلك ${count} ليد بعد` : 'الدفعة الجاية'}
      </span>
      <b className="tabular-nums" dir="ltr">{timeText}</b>
    </div>
  );
}
