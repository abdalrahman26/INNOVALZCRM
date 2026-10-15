'use client';

import { useEffect, useRef, useState } from 'react';
import { Timer, Zap } from 'lucide-react';
import { useApp } from './AppContext';
import { useDistribution } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtCountdown, fmtDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** عدّاد الدفعة الجاية من التوزيع التلقائي */
export default function DistributionCountdown({ big = false }: { big?: boolean }) {
  const { profile } = useApp();
  const { tr } = useI18n();
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
          <Zap size={20} className="text-slate-400" /> {tr('التوزيع التلقائي متوقف حالياً', 'Auto distribution is currently off')}
        </div>
      );
    }
    return null;
  }
  if (!isManager && (!s.show_countdown || !profile.receives_auto_leads)) return null;

  const count = Math.min(s.batch_size, pool);
  const long = nextMs > 6 * 3600_000;
  const timeText = nextMs <= 0 ? tr('جاري التوزيع…', 'Distributing…') : long ? fmtDateTime(s.next_run_at) : fmtCountdown(nextMs);

  if (big) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 bg-gradient-to-l from-indigo-600 to-violet-600 p-5 text-white">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15"><Timer size={28} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm opacity-90">{tr('الدفعة الجاية من الليدز', 'Next batch of leads')}</div>
            {isManager ? (
              <div className="text-lg font-bold">
                {tr(`${s.batch_size} ليد لكل سيلز · في الانتظار ${pool}`, `${s.batch_size} leads per rep · ${pool} waiting`)}
              </div>
            ) : count > 0 ? (
              <div className="text-lg font-bold">{tr(`هينزلك ${count} ليد جديد`, `${count} new leads coming to you`)}</div>
            ) : (
              <div className="text-lg font-bold">{tr('مفيش ليدز في الانتظار دلوقتي', 'No leads waiting right now')}</div>
            )}
          </div>
          <div className="text-end">
            <div className="text-3xl font-extrabold tabular-nums" dir="ltr">{timeText}</div>
            <div className="text-xs opacity-80">{tr(`كل ${s.interval_minutes} دقيقة`, `Every ${s.interval_minutes} min`)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700">
      <Timer size={16} />
      <span className="hidden sm:inline">
        {isManager
          ? tr(`الدفعة الجاية (${pool} منتظر)`, `Next batch (${pool} waiting)`)
          : count > 0
            ? tr(`هينزلك ${count} ليد بعد`, `${count} leads for you in`)
            : tr('الدفعة الجاية', 'Next batch')}
      </span>
      <b className="tabular-nums" dir="ltr">{timeText}</b>
    </div>
  );
}
