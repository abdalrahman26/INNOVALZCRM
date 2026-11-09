/**
 * تخزين الملفات على تليجرام — سيرفر بس (التوكين عمره ما بيوصل للمتصفح)
 *
 * المتغيرات في Vercel:
 *   TELEGRAM_BOT_TOKEN  توكين البوت من @BotFather
 *   TELEGRAM_CHAT_ID    رقم القناة الخاصة اللي البوت أدمن فيها (بيبدأ بـ -100)
 *
 * الملف الكبير بيتقسم أجزاء 4MB (حدود Vercel)، وكل جزء رسالة في القناة.
 * التحميل بيجمع الأجزاء ورا بعض — فمفيش حد لحجم الملف.
 */

export const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — أقل من حد Vercel (4.5MB) لكل طلب
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB للملف الواحد

const base = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const token = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();
export const chatId = () => (process.env.TELEGRAM_CHAT_ID || '').trim();
export const tgConfigured = () => !!token() && !!chatId();

export class TgError extends Error {
  constructor(message: string, public code = 0, public retryAfter = 0) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

async function call<T>(method: string, body?: FormData | Record<string, unknown>, tries = 3): Promise<T> {
  if (!token()) throw new TgError('TELEGRAM_BOT_TOKEN missing', -1);
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${base()}/bot${token()}/${method}`, {
        method: 'POST',
        body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
        headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
    } catch (e) {
      if (attempt < tries) { await sleep(800 * attempt); continue; }
      throw new TgError(`network: ${(e as Error).message}`, -2);
    }
    const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
    if (j.ok) return j.result as T;
    const retry = j.parameters?.retry_after ?? 0;
    // تليجرام بيطلب نستنى شوية (كتير رسايل ورا بعض) — نستنى ونعيد لو المدة قصيرة
    if (j.error_code === 429 && retry > 0 && retry <= 20 && attempt < tries) { await sleep(retry * 1000 + 300); continue; }
    if ((j.error_code ?? 0) >= 500 && attempt < tries) { await sleep(800 * attempt); continue; }
    throw new TgError(j.description || 'Telegram error', j.error_code ?? res.status, retry);
  }
}

type TgDoc = { file_id: string; file_unique_id: string; file_size?: number };
type TgMessage = { message_id: number; document?: TgDoc; video?: TgDoc; audio?: TgDoc; animation?: TgDoc; photo?: TgDoc[] };

/** يرفع جزء/ملف للقناة ويرجّع مكانه */
export async function sendDocument(bytes: Uint8Array | ArrayBuffer, filename: string, caption?: string) {
  const fd = new FormData();
  fd.append('chat_id', chatId());
  fd.append('document', new Blob([bytes as BlobPart]), filename);
  fd.append('disable_content_type_detection', 'true');
  fd.append('disable_notification', 'true');
  if (caption) fd.append('caption', caption.slice(0, 1000));
  const m = await call<TgMessage>('sendDocument', fd);
  const doc = m.document ?? m.video ?? m.audio ?? m.animation ?? m.photo?.[m.photo.length - 1];
  if (!doc) throw new TgError('Telegram did not return a file', -3);
  return { file_id: doc.file_id, message_id: m.message_id };
}

/** لينك تحميل مؤقت (فيه التوكين — يستخدم جوه السيرفر بس، عمره ما يتبعت للمتصفح) */
export async function fileDownloadUrl(fileId: string) {
  const f = await call<{ file_path?: string }>('getFile', { file_id: fileId });
  if (!f.file_path) throw new TgError('file_path missing', -4);
  return `${base()}/file/bot${token()}/${f.file_path}`;
}

export async function deleteMessage(messageId: number) {
  try { await call('deleteMessage', { chat_id: chatId(), message_id: messageId }, 1); } catch { /* مش مشكلة لو فشل */ }
}

export const getMe = () => call<{ id: number; username: string; first_name: string }>('getMe');
export const getChat = () => call<{ id: number; title?: string; type: string }>('getChat', { chat_id: chatId() });

/** القنوات/الجروبات اللي البوت شافها — عشان نعرف رقم القناة */
export async function seenChats() {
  type U = { message?: { chat: C }; channel_post?: { chat: C }; my_chat_member?: { chat: C } };
  type C = { id: number; title?: string; username?: string; first_name?: string; type: string };
  const ups = await call<U[]>('getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
  const map = new Map<number, C>();
  for (const u of ups) { const c = u.channel_post?.chat ?? u.my_chat_member?.chat ?? u.message?.chat; if (c) map.set(c.id, c); }
  return [...map.values()].map((c) => ({ id: String(c.id), title: c.title ?? c.username ?? c.first_name ?? '', type: c.type }));
}

/** شرح الخطأ بالعربي والإنجليزي عشان الأدمن يعرف يصلحه */
export function explainTgError(e: unknown): { ar: string; en: string; raw: string } {
  const err = e as TgError;
  const raw = `${err.code ? err.code + ' ' : ''}${err.message ?? String(e)}`;
  const m = (err.message ?? '').toLowerCase();
  if (err.code === -1) return { raw, ar: 'التوكين مش متحط في Vercel (TELEGRAM_BOT_TOKEN).', en: 'TELEGRAM_BOT_TOKEN is not set in Vercel.' };
  if (err.code === -2) return { raw, ar: 'السيرفر مش قادر يوصل لتليجرام — جرّب تاني بعد شوية.', en: "The server can't reach Telegram — try again shortly." };
  if (err.code === 401 || m.includes('unauthorized')) return { raw, ar: 'التوكين غلط — انسخه تاني من @BotFather.', en: 'Wrong token — copy it again from @BotFather.' };
  if (m.includes('chat not found')) return { raw, ar: 'رقم القناة (TELEGRAM_CHAT_ID) غلط، أو البوت مش متضاف في القناة.', en: 'Wrong TELEGRAM_CHAT_ID, or the bot is not in the channel.' };
  if (m.includes('not enough rights') || m.includes('not a member') || m.includes('kicked') || err.code === 403)
    return { raw, ar: 'البوت لازم يكون أدمن في القناة ومعاه صلاحية «نشر الرسائل».', en: 'The bot must be an admin of the channel with “Post messages” permission.' };
  if (err.code === 429) return { raw, ar: `تليجرام طالب نستنى ${err.retryAfter || 'شوية'} ثانية — جرّب تاني.`, en: `Telegram asked to wait ${err.retryAfter || 'a few'} seconds — try again.` };
  if (m.includes('too big') || err.code === 413) return { raw, ar: 'الجزء أكبر من المسموح.', en: 'Part is too large.' };
  if (m.includes('conflict') && m.includes('webhook')) return { raw, ar: 'البوت عليه Webhook — امسحه (deleteWebhook) أو استخدم بوت جديد مخصوص للتخزين.', en: 'The bot has a webhook set — delete it or use a dedicated storage bot.' };
  return { raw, ar: 'خطأ من تليجرام', en: 'Telegram error' };
}

/** اسم الملف بشكل آمن للهيدر */
export function contentDisposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** الأنواع اللي ينفع تتفتح جوه المتصفح بأمان (الباقي بيتحمّل) */
export const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'text/plain'];
