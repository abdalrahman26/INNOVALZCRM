import { NextResponse, type NextRequest } from 'next/server';
import { contentDisposition, deleteMessage, explainTgError, fileDownloadUrl, INLINE_TYPES } from '@/lib/telegram';
import { currentUser, fail, type FileRow } from '@/lib/files-server';

// Edge: بيبعت الملف للمتصفح أول بأول (streaming) — فمفيش حد لحجم الملف
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/** فتح/تحميل الملف — بيجمع أجزاءه من تليجرام ورا بعض */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');
  const { data } = await supabase.from('lead_files').select('*').eq('id', id).maybeSingle();
  const row = data as FileRow | null;
  if (!row) return fail(404, 'الملف مش موجود أو مش متاح ليك', 'File not found or not accessible');
  if (row.status !== 'ready') return fail(409, 'الملف لسه بيترفع', 'The file is still uploading');

  const ids = row.tg_file_ids as string[];
  // أول جزء قبل ما نبدأ نرد — عشان لو فيه مشكلة نرجّع رسالة واضحة
  let first: Response;
  try {
    first = await fetch(await fileDownloadUrl(ids[0]), { cache: 'no-store' });
    if (!first.ok || !first.body) throw new Error(`HTTP ${first.status}`);
  } catch (e) {
    const x = explainTgError(e);
    return fail(502, `مش قادرين نجيب الملف من تليجرام: ${x.ar}`, `Could not fetch the file from Telegram: ${x.en}`, { detail: x.raw });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < ids.length; i++) {
          let res = first;
          if (i > 0) {
            res = await fetch(await fileDownloadUrl(ids[i]), { cache: 'no-store' });
            if (!res.ok || !res.body) throw new Error(`part ${i + 1}: HTTP ${res.status}`);
          }
          const reader = res.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const mime = row.mime_type || 'application/octet-stream';
  const inline = req.nextUrl.searchParams.get('download') !== '1' && INLINE_TYPES.includes(mime);
  return new Response(stream, {
    headers: {
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Length': String(row.size_bytes),
      'Content-Disposition': contentDisposition(row.file_name, inline),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/** مسح الملف (صاحبه أو اللي يقدر يعدّل كل الليدز) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');
  const { data, error } = await supabase.from('lead_files').delete().eq('id', id).select('tg_message_ids');
  if (error) return fail(500, 'حصل خطأ', 'Something went wrong', { detail: error.message });
  if (!data?.length) return fail(403, 'مش عندك صلاحية تمسح الملف ده', "You can't delete this file");
  // نمسحه من القناة كمان (لو تليجرام رفض — مش مشكلة، الملف اتشال من السيستم)
  await Promise.all(((data[0].tg_message_ids ?? []) as (number | null)[]).filter(Boolean).map((m) => deleteMessage(m as number)));
  return NextResponse.json({ ok: true });
}
