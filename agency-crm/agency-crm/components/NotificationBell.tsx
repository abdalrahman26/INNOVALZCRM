'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from './AppContext';
import { useSupabase } from '@/lib/hooks';
import { fromNow } from '@/lib/format';
import { APP_NAME } from '@/lib/constants';
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

export default function NotificationBell() {
  const { profile } = useApp();
  const supabase = useSupabase();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<string>('granted');
  const seen = useRef<Set<string> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const openLead = useCallback(
    async (n: AppNotification) => {
      if (!n.read) {
        await supabase.from('notifications').update({ read: true }).eq('id', n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      }
      setOpen(false);
      router.push(n.lead_id ? `/leads/${n.lead_id}` : n.type === 'assign' ? '/leads?status=new' : '/followups');
    },
    [supabase, router],
  );

  const alertUser = useCallback(
    (n: AppNotification) => {
      toast(n.title, {
        description: n.body ?? undefined,
        duration: 12_000,
        action: { label: 'فتح', onClick: () => openLead(n) },
      });
      beep();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const bn = new Notification(n.title, { body: n.body ?? '', tag: n.id });
        bn.onclick = () => { window.focus(); openLead(n); };
      }
    },
    [openLead],
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

  async function markAll() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false);
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
  }

  async function enableBrowser() {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') toast.success('تم تفعيل إشعارات المتصفح');
  }

  return (
    <div className="relative" ref={boxRef}>
      <button className="btn-ghost relative p-2" onClick={() => setOpen((o) => !o)} aria-label="الإشعارات">
        {unread ? <BellRing size={20} className="text-indigo-600" /> : <Bell size={20} />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute left-0 top-12 z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-bold">الإشعارات</span>
            {unread > 0 && (
              <button className="flex items-center gap-1 text-xs font-semibold text-indigo-600" onClick={markAll}>
                <CheckCheck size={14} /> تعليم الكل كمقروء
              </button>
            )}
          </div>
          {perm === 'default' && (
            <button onClick={enableBrowser} className="w-full bg-amber-50 px-4 py-2 text-right text-xs font-semibold text-amber-800">
              🔔 فعّل إشعارات المتصفح عشان يوصلك التنبيه حتى لو التاب مقفول
            </button>
          )}
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-6 text-center text-sm text-slate-400">مفيش إشعارات</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openLead(n)}
                className={`block w-full border-b border-slate-50 px-4 py-3 text-right hover:bg-slate-50 ${n.read ? '' : 'bg-indigo-50/60'}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                  <div className="min-w-0">
                    <div className="text-sm font-bold">{n.title}</div>
                    {n.body && <div className="text-xs text-slate-500">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-slate-400">{fromNow(n.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
