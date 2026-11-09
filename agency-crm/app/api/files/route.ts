import { NextResponse, type NextRequest } from 'next/server';
import { CHUNK_SIZE, MAX_FILE_SIZE, tgConfigured } from '@/lib/telegram';
import { currentUser, fail, FILE_KINDS } from '@/lib/files-server';

export const dynamic = 'force-dynamic';

/** بداية رفع ملف: بيسجّل الملف ويرجّع عدد الأجزاء المطلوبة */
export async function POST(req: NextRequest) {
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');
  if (!tgConfigured()) return fail(503, 'تخزين الملفات لسه متظبطش — الأدمن يدخل صفحة «التخزين» ويكمّل الخطوات', 'File storage is not set up yet — an admin should open the Storage page');

  const b = (await req.json().catch(() => null)) as { lead_id?: string; file_name?: string; mime_type?: string; size_bytes?: number; kind?: string } | null;
  const name = String(b?.file_name ?? '').trim().slice(0, 200);
  const size = Number(b?.size_bytes ?? 0);
  const kind = FILE_KINDS.includes(b?.kind as (typeof FILE_KINDS)[number]) ? b!.kind! : 'other';
  if (!b?.lead_id || !name) return fail(400, 'بيانات ناقصة', 'Missing data');
  if (!(size > 0)) return fail(400, 'الملف فاضي', 'The file is empty');
  if (size > MAX_FILE_SIZE) return fail(413, `الملف أكبر من ${MAX_FILE_SIZE / 1024 / 1024}MB`, `File is larger than ${MAX_FILE_SIZE / 1024 / 1024}MB`);

  const parts = Math.max(1, Math.ceil(size / CHUNK_SIZE));
  const { data, error } = await supabase.from('lead_files').insert({
    lead_id: b.lead_id, user_id: user.id, kind, file_name: name,
    mime_type: String(b.mime_type ?? '').slice(0, 120) || null, size_bytes: size, parts,
  }).select('id').single();
  if (error) {
    if (/lead_files/.test(error.message) && /exist|schema cache/i.test(error.message))
      return fail(503, 'شغّل كود الداتابيز migration-v9.sql الأول', 'Run migration-v9.sql first');
    return fail(403, 'مش عندك صلاحية ترفع ملف على الليد ده', "You can't add files to this lead", { detail: error.message });
  }
  return NextResponse.json({ ok: true, id: data.id, parts, chunk: CHUNK_SIZE });
}
