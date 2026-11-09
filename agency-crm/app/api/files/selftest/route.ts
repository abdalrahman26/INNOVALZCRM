import { NextResponse, type NextRequest } from 'next/server';
import {
  chatId, deleteMessage, explainTgError, fileDownloadUrl, getChat, getMe, seenChats, sendDocument,
} from '@/lib/telegram';
import { currentUser, fail } from '@/lib/files-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Step = { key: string; ok: boolean; ar: string; en: string; detail?: string };

/**
 * اختبار كامل لتخزين تليجرام (للأدمن): التوكين ← القناة ← رفع ← تحميل ومطابقة ← مسح ← الداتابيز
 * ?chats=1 → يرجّع القنوات اللي البوت شافها (عشان تعرف TELEGRAM_CHAT_ID)
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') return fail(403, 'الصفحة دي للأدمن بس', 'Admins only');

  const steps: Step[] = [];
  const add = (s: Step) => { steps.push(s); return s.ok; };
  const done = (extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: steps.every((s) => s.ok), steps, ...extra });

  // 1) التوكين
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    add({ key: 'token', ok: false, ar: 'التوكين مش متحط — ضيف TELEGRAM_BOT_TOKEN في Vercel وبعدين Redeploy', en: 'Add TELEGRAM_BOT_TOKEN in Vercel, then redeploy' });
    return done();
  }
  let bot = '';
  try {
    const b = await getMe();
    bot = b.username;
    add({ key: 'token', ok: true, ar: `التوكين شغال — البوت: @${b.username}`, en: `Token works — bot: @${b.username}` });
  } catch (e) {
    const x = explainTgError(e);
    add({ key: 'token', ok: false, ar: x.ar, en: x.en, detail: x.raw });
    return done();
  }

  // القنوات اللي البوت شافها (لو لسه مش عارف رقم القناة)
  if (req.nextUrl.searchParams.get('chats') === '1' || !chatId()) {
    let chats: { id: string; title: string; type: string }[] = [];
    try { chats = await seenChats(); } catch (e) {
      const x = explainTgError(e);
      add({ key: 'chats', ok: false, ar: x.ar, en: x.en, detail: x.raw });
      return done({ bot, chats });
    }
    if (!chatId()) {
      add({
        key: 'chat', ok: false,
        ar: chats.length ? 'اختار القناة من تحت وانسخ رقمها في TELEGRAM_CHAT_ID في Vercel' : 'ابعت أي رسالة في القناة (بعد ما تضيف البوت أدمن) ودوس «اختبار» تاني',
        en: chats.length ? 'Pick your channel below and put its id in TELEGRAM_CHAT_ID in Vercel' : 'Post any message in the channel (after adding the bot as admin) and run the test again',
      });
      return done({ bot, chats });
    }
    if (req.nextUrl.searchParams.get('chats') === '1') return done({ bot, chats });
  }

  // 2) القناة
  try {
    const c = await getChat();
    add({ key: 'chat', ok: true, ar: `القناة: ${c.title ?? c.id} (${c.type})`, en: `Channel: ${c.title ?? c.id} (${c.type})` });
  } catch (e) {
    const x = explainTgError(e);
    add({ key: 'chat', ok: false, ar: x.ar, en: x.en, detail: x.raw });
    return done({ bot });
  }

  // 3) رفع ملف تجريبي (بيانات عشوائية 256KB) ثم 4) تحميله ومطابقته بايت بايت
  const size = 256 * 1024;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, size)));
  let sent: { file_id: string; message_id: number } | null = null;
  const t0 = Date.now();
  try {
    sent = await sendDocument(bytes, `crm-storage-test-${Date.now()}.bin`, '🧪 CRM storage test — بيتمسح لوحده');
    add({ key: 'upload', ok: true, ar: `الرفع شغال (${Date.now() - t0}ms)`, en: `Upload works (${Date.now() - t0}ms)` });
  } catch (e) {
    const x = explainTgError(e);
    add({ key: 'upload', ok: false, ar: x.ar, en: x.en, detail: x.raw });
    return done({ bot });
  }
  try {
    const t1 = Date.now();
    const res = await fetch(await fileDownloadUrl(sent.file_id), { cache: 'no-store' });
    const back = new Uint8Array(await res.arrayBuffer());
    const same = back.length === bytes.length && back.every((v, i) => v === bytes[i]);
    add(same
      ? { key: 'download', ok: true, ar: `التحميل شغال والملف رجع زي ما هو بالظبط (${Date.now() - t1}ms)`, en: `Download works and the file came back identical (${Date.now() - t1}ms)` }
      : { key: 'download', ok: false, ar: 'الملف رجع مختلف عن اللي اترفع', en: 'Downloaded file differs from the upload', detail: `${back.length} vs ${bytes.length}` });
  } catch (e) {
    const x = explainTgError(e);
    add({ key: 'download', ok: false, ar: x.ar, en: x.en, detail: x.raw });
  }
  // 5) مسح رسالة الاختبار
  await deleteMessage(sent.message_id);

  // 6) الداتابيز
  const { error } = await supabase.from('lead_files').select('id', { head: true, count: 'exact' });
  add(error
    ? { key: 'db', ok: false, ar: 'جدول الملفات مش موجود — شغّل migration-v9.sql في Supabase', en: 'Files table missing — run migration-v9.sql in Supabase', detail: error.message }
    : { key: 'db', ok: true, ar: 'جدول الملفات في الداتابيز جاهز', en: 'Files table is ready' });

  return done({ bot });
}
