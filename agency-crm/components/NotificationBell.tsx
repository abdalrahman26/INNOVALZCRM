'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { fromNow } from '@/lib/format';
import { APP_NAME } from '@/lib/constants';
import { useI18n } from '@/lib/i18n';
import type { Lang } from '@/lib/lang';
import type { AppNotification } from '@/lib/types';

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18].forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      const t = ctx.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.16);
    });
  } catch {
    /* ignore */
  }
}

/** الإشعارات بتتسجل في الداتابيز بالعربي — هنا بنترجمها لليوزر الإنجليزي */
function localize(n: AppNotification, lang: Lang): { title: string; body: string | null } {
  if (lang !== 'en') return { title: n.title, body: n.body };
  const num = n.title.match(/\d+/)?.[0] ?? '';
  if (n.type === 'assign') {
    if (n.title.startsWith('نزلك')) return { title: `${num} new leads for you 🎯`, body: 'From auto distribution — start reaching out now' };
    if (n.title.startsWith('اتحولك ليد:')) return { title: `Lead assigned to you: ${n.data?.lead ?? n.title.slice(11).replace(' 📥', '')} 📥`, body: 'Open it and start reaching out' };
    if (n.title.startsWith('اتحولك')) return { title: `${num} leads assigned to you 📥`, body: 'Open your leads and start reaching out' };
  }
  if (n.type === 'quote') {
    const name = n.data?.lead ?? n.title.split(': ').slice(1).join(': ');
    return { title: `📄 Client requested a quote: ${name}`, body: n.data?.by ? `Sales: ${n.data.by}` : 'Needs a quote' };
  }
  if (n.type === 'followup') {
    const name = n.title.split(': ').slice(1).join(': ');
    const body = n.body === 'حان موعد المتابعة مع العميل' ? 'Time to follow up with this client' : n.body;
    return { title: `⏰ Follow-up due: ${name}`, body };
  }
  if (n.type === 'reply' && n.data?.author !== undefined) {
    return { title: `💬 ${n.data.author} replied to a comment: ${n.data.lead ?? ''}`, body: n.body };
  }
  return { title: n.title, body: n.body };
}

export default function NotificationBell() {
  const { profile, openLead } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const { tr, lang } = useI18n();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<string>('granted');
  const seen = useRef<Set<string> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const openItem = useCallback(
    (n: AppNotification) => {
      setOpen(false);
      if (!n.read) {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        supabase.from('notifications').update({ read: true }).eq('id', n.id).then(() => {});
      }
      // كل إشعار بيوديك على العميل بتاعه
      const ids = Array.isArray(n.data?.lead_ids) ? n.data!.lead_ids!.filter(Boolean) : [];
      if (n.lead_id) openLead(n.lead_id);
      else if (ids.length === 1) openLead(ids[0]);
      else if (ids.length > 1 && ids.length <= 200) router.push(`/leads?ids=${ids.join(',')}&sort=assigned_at`);
      else if (n.type === 'assign') router.push('/leads?assigned=me&sort=assigned_at');
      else router.push('/followups');
    },
    [supabase, router, openLead],
  );

  const alertUser = useCallback(
    (n: AppNotification) => {
      const { title, body } = localize(n, lang);
      toast(title, {
        description: body ?? undefined,
        duration: 12_000,
        action: { label: tr('فتح', 'Open'), onClick: () => openItem(n) },
      });
      beep();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const bn = new Notification(title, { body: body ?? '', tag: n.id });
        bn.onclick = () => { window.focus(); openItem(n); };
      }
    },
    [openItem, lang, tr],
  );

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30);
    const list = (data as AppNotification[]) ?? [];
    if (seen.current === null) {
      seen.current = new Set(list.map((n) => n.id));
    } else {
      for (const n of [...list].reverse()) {
        if (!seen.current.has(n.id)) {
          seen.current.add(n.id);
          if (!n.read) alertUser(n);
        }
      }
    }
    setItems(list);
  }, [supabase, profile.id, alertUser]);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPerm(Notification.permission);
    load();
    const channel = supabase
      .channel(`notif-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => load(),
      )
      .subscribe();
    const t = setInterval(load, 45_000); // احتياطي لو الـ realtime فصل
    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [load, supabase, profile.id]);

  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    document.title = unread ? `(${unread}) ${APP_NAME}` : APP_NAME;
  }, [unread]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function markAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false).then(() => {});
  }

  async function enableBrowser() {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') toast.success(tr('تم تفعيل إشعارات المتصفح', 'Browser notifications enabled'));
  }

  return (
    <div className="relative" ref={boxRef}>
      <button className="btn-ghost relative p-2" onClick={() => setOpen((o) => !o)} aria-label={tr('الإشعارات', 'Notifications')}>
        {unread ? <BellRing size={20} className="text-indigo-600" /> : <Bell size={20} />}
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute end-0 top-12 z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-bold">{tr('الإشعارات', 'Notifications')}</span>
            {unread > 0 && (
              <button className="flex items-center gap-1 text-xs font-semibold text-indigo-600" onClick={markAll}>
                <CheckCheck size={14} /> {tr('تعليم الكل كمقروء', 'Mark all as read')}
              </button>
            )}
          </div>
          {perm === 'default' && (
            <button onClick={enableBrowser} className="w-full bg-amber-50 px-4 py-2 text-start text-xs font-semibold text-amber-800">
              🔔 {tr('فعّل إشعارات المتصفح عشان يوصلك التنبيه حتى لو التاب مقفول', 'Enable browser notifications to get alerts even when this tab is in the background')}
            </button>
          )}
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-6 text-center text-sm text-slate-400">{tr('مفيش إشعارات', 'No notifications')}</p>}
            {items.map((n) => {
              const { title, body } = localize(n, lang);
              return (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`block w-full border-b border-slate-50 px-4 py-3 text-start hover:bg-slate-50 ${n.read ? '' : 'bg-indigo-50/60'}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                    <div className="min-w-0">
                      <div className="text-sm font-bold">{title}</div>
                      {body && <div className="text-xs text-slate-500">{body}</div>}
                      <div className="mt-0.5 text-[11px] text-slate-400">{fromNow(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
