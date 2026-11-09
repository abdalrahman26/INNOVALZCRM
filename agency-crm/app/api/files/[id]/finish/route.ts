import { NextResponse, type NextRequest } from 'next/server';
import { currentUser, fail, type FileRow } from '@/lib/files-server';

export const dynamic = 'force-dynamic';

/** نهاية الرفع: نتأكد إن كل الأجزاء وصلت ونعلّم الملف جاهز */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, 'سجّل دخول الأول', 'Please sign in');
  const { data } = await supabase.from('lead_files').select('*').eq('id', id).maybeSingle();
  const row = data as FileRow | null;
  if (!row || row.user_id !== user.id) return fail(404, 'الملف مش موجود', 'File not found');
  if (row.status === 'ready') return NextResponse.json({ ok: true, file: row });
  const ids = row.tg_file_ids ?? [];
  if (ids.length !== row.parts || ids.some((x) => !x)) return fail(409, 'فيه أجزاء من الملف موصلتش — ارفعه تاني', 'Some parts are missing — upload again');
  const { data: done, error } = await supabase.from('lead_files').update({ status: 'ready' }).eq('id', id).select('*').single();
  if (error) return fail(500, 'حصل خطأ', 'Something went wrong', { detail: error.message });
  return NextResponse.json({ ok: true, file: done });
}
