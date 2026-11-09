'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, HardDrive, PlayCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/components/AppContext';
import { NoAccess, Spinner } from '@/components/ui';
import { fmtSize } from '@/components/LeadFiles';
import { useSupabase } from '@/lib/hooks';
import { can } from '@/lib/perms';
import { fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type Step = { key: string; ok: boolean; ar: string; en: string; detail?: string };
type Result = { ok: boolean; steps: Step[]; bot?: string; chats?: { id: string; title: string; type: string }[]; ar?: string; en?: string };

/** تخزين الملفات على تليجرام — خطوات التجهيز + اختبار كامل (للأدمن) */
export default function StoragePage() {
  const { profile } = useApp();
  const supabase = useSupabase();
  const { tr, lang } = useI18n();
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [stats, setStats] = useState<{ files: number; bytes: number; leads: number } | null>(null);

  useEffect(() => {
    supabase.rpc('storage_stats').then(({ data }) => {
      const r = (data as { files: number; bytes: number; leads: number }[] | null)?.[0];
      if (r) setStats({ files: Number(r.files), bytes: Number(r.bytes), leads: Number(r.leads) });
    });
  }, [supabase, res]);

  if (!can(profile, 'manage_team')) return <NoAccess />;

  async function run(chats = false) {
    setRunning(true);
    setRes(null);
    try {
      const r = await fetch(`/api/files/selftest${chats ? '?chats=1' : ''}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as Result | null;
      setRes(j ?? { ok: false, steps: [{ key: 'net', ok: false, ar: 'السيرفر مردّش', en: 'No response from server' }] });
    } catch {
      setRes({ ok: false, steps: [{ key: 'net', ok: false, ar: 'مفيش اتصال', en: 'No connection' }] });
    }
    setRunning(false);
  }

  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.success(tr('اتنسخ', 'Copied'))).catch(() => {}); };
  const T = (s: { ar?: string; en?: string }) => (lang === 'en' ? s.en : s.ar) ?? '';

  const setup = [
    { ar: <>افتح <b>@BotFather</b> في تليجرام ← <code>/newbot</code> ← اختار اسم للبوت ← هيديك <b>التوكين</b>.</>,
      en: <>Open <b>@BotFather</b> in Telegram → <code>/newbot</code> → pick a name → it gives you the <b>token</b>.</> },
    { ar: <>اعمل <b>قناة خاصة (Private Channel)</b> جديدة للملفات، وضيف البوت فيها <b>أدمن</b> بصلاحية «نشر الرسائل».</>,
      en: <>Create a new <b>private channel</b> for files and add the bot as an <b>admin</b> with “Post messages”.</> },
    { ar: <>في Vercel ← Settings ← Environment Variables: ضيف <code>TELEGRAM_BOT_TOKEN</code> = التوكين ← Save ← Redeploy.</>,
      en: <>In Vercel → Settings → Environment Variables: add <code>TELEGRAM_BOT_TOKEN</code> = the token → Save → Redeploy.</> },
    { ar: <>ابعت أي رسالة في القناة، وارجع هنا دوس <b>«اختبار التخزين»</b> — هيطلعلك رقم القناة. ضيفه في Vercel باسم <code>TELEGRAM_CHAT_ID</code> ← Redeploy.</>,
      en: <>Post any message in the channel, come back and press <b>“Test storage”</b> — it shows the channel id. Add it in Vercel as <code>TELEGRAM_CHAT_ID</code> → Redeploy.</> },
    { ar: <>دوس <b>«اختبار التخزين»</b> تاني — لو كله ✅ يبقى جاهز، وزرار «إرفاق» هيشتغل على كل الليدز.</>,
      en: <>Press <b>“Test storage”</b> again — all ✅ means it&apos;s ready and “Attach” works on every lead.</> },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-sky-700"><HardDrive size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{tr('تخزين الملفات', 'File storage')}</h1>
          <p className="text-sm text-slate-500">{tr('عروض الأسعار والصور والعقود بتتخزن في قناة تليجرام خاصة — مساحة مفتوحة', 'Quotes, images and contracts are stored in a private Telegram channel — open-ended space')}</p>
        </div>
        <button className="btn-primary" disabled={running} onClick={() => run(false)}>
          {running ? <Spinner className="h-4 w-4" /> : <PlayCircle size={16} />} {tr('اختبار التخزين', 'Test storage')}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { l: tr('ملفات', 'Files'), v: fmtNum(stats.files) },
            { l: tr('المساحة المستخدمة', 'Space used'), v: stats.bytes ? fmtSize(stats.bytes) : '0' },
            { l: tr('عملاء عندهم ملفات', 'Clients with files'), v: fmtNum(stats.leads) },
          ].map((k) => (
            <div key={k.l} className="card p-4"><div className="text-xs text-slate-500">{k.l}</div><div className="mt-1 text-xl font-extrabold tabular-nums">{k.v}</div></div>
          ))}
        </div>
      )}

      {res && (
        <div className={`card overflow-hidden ${res.ok ? 'border-emerald-200' : 'border-amber-200'}`}>
          <div className={`px-4 py-3 font-bold ${res.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {res.ok ? tr('✅ التخزين جاهز 100% — الموظفين يقدروا يرفعوا ملفات دلوقتي', '✅ Storage is 100% ready — the team can upload files now')
              : res.steps?.length ? tr('⚠️ فيه خطوة محتاجة تتظبط', '⚠️ One step needs fixing') : T(res)}
          </div>
          <ul className="divide-y divide-slate-100">
            {(res.steps ?? []).map((s) => (
              <li key={s.key} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                {s.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-rose-500" />}
                <div className="min-w-0">
                  <div className={s.ok ? '' : 'font-semibold text-rose-700'}>{T(s)}</div>
                  {s.detail && !s.ok && <div className="mt-0.5 break-all text-[11px] text-slate-400" dir="ltr">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
          {res.chats && (
            <div className="border-t border-slate-100 p-4">
              <div className="mb-2 text-sm font-bold">{tr('القنوات اللي البوت شافها', 'Channels the bot has seen')}</div>
              {res.chats.length === 0 ? (
                <p className="text-xs text-slate-500">{tr('لسه مفيش — اتأكد إن البوت أدمن في القناة، ابعت رسالة فيها، ودوس «اختبار التخزين» تاني.', 'None yet — make sure the bot is a channel admin, post a message there and test again.')}</p>
              ) : (
                <div className="space-y-1.5">
                  {res.chats.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate"><b>{c.title || '—'}</b> <span className="text-xs text-slate-400">({c.type})</span></span>
                      <code className="text-xs" dir="ltr">{c.id}</code>
                      <button className="btn-secondary btn-sm" onClick={() => copy(c.id)}><Copy size={13} /> {tr('نسخ', 'Copy')}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-3 font-bold">{tr('التجهيز (مرة واحدة — 5 دقايق)', 'Setup (once — 5 minutes)')}</h2>
        <ol className="space-y-2.5 text-sm">
          {setup.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
              <span className="pt-0.5 leading-6 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-xs">{lang === 'en' ? s.en : s.ar}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
          {tr('🔒 التوكين بيتحط في Vercel بس — عمره ما بيظهر في المتصفح. الموظفين بيشوفوا ملفات العملاء اللي متحولالهم بس. الملف الكبير بيتقسم أجزاء تلقائي (حد أقصى 500MB للملف). متمسحش القناة ولا تشيل البوت منها — دي مكان الملفات.',
            '🔒 The token lives only in Vercel — never in the browser. Staff only see files of clients assigned to them. Large files are split automatically (max 500MB per file). Don’t delete the channel or remove the bot — that’s where the files live.')}
        </p>
      </div>
    </div>
  );
}
