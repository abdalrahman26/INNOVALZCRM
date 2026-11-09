import { NextResponse, type NextRequest } from 'next/server';
import { CHUNK_SIZE, chatId, explainTgError, sendDocument } from '@/lib/telegram';
import { currentUser, fail, KIND_LABEL, type FileRow } from '@/lib/files-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** رفع جزء من الملف (4MB بالكتير) لقناة تليجرام */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const i = Number(req.nextUrl.searchParams.get('i'));
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');

  const { data: f } = await supabase.from('lead_files').select('*, lead:leads(full_name)').eq('id', id).maybeSingle();
  const row = f as (FileRow & { lead: { full_name: string } | null }) | null;
  if (!row || row.user_id !== user.id) return fail(404, 'الملف مش موجود', 'File not found');
  if (row.status !== 'uploading') return fail(409, 'الملف خلص رفع خلاص', 'Upload already finished');
  if (!Number.isInteger(i) || i < 0 || i >= row.parts) return fail(400, 'رقم الجزء غلط', 'Bad part number');

  const bytes = new Uint8Array(await req.arrayBuffer());
  const expected = i < row.parts - 1 ? CHUNK_SIZE : row.size_bytes - CHUNK_SIZE * (row.parts - 1);
  if (bytes.byteLength !== expected) return fail(400, 'الجزء وصل ناقص — جرّب تاني', 'Part arrived incomplete — try again');

  const name = row.parts === 1 ? row.file_name : `${row.file_name}.part${String(i + 1).padStart(3, '0')}of${row.parts}`;
  let caption: string | undefined;
  if (i === 0) {
    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    caption = [`📎 ${row.file_name}`, `🗂 ${KIND_LABEL[row.kind] ?? row.kind}`, `👤 ${row.lead?.full_name ?? ''}`, `🙋 ${me?.full_name ?? ''}`,
      row.parts > 1 ? `🧩 ${row.parts} parts` : ''].filter(Boolean).join('\n');
  }

  let sent: { file_id: string; message_id: number };
  try {
    sent = await sendDocument(bytes, name, caption);
  } catch (e) {
    const x = explainTgError(e);
    return fail(502, x.ar, x.en, { detail: x.raw, retry_after: (e as { retryAfter?: number }).retryAfter ?? 0 });
  }

  const ids = [...(row.tg_file_ids ?? [])];
  const msgs = [...(row.tg_message_ids ?? [])];
  while (ids.length < row.parts) ids.push(null);
  while (msgs.length < row.parts) msgs.push(null);
  ids[i] = sent.file_id;
  msgs[i] = sent.message_id;
  const { error } = await supabase.from('lead_files').update({ tg_file_ids: ids, tg_message_ids: msgs, tg_chat_id: chatId() }).eq('id', id);
  if (error) return fail(500, 'حصل خطأ وإحنا بنحفظ الجزء', 'Could not save the part', { detail: error.message });
  return NextResponse.json({ ok: true, i });
}
