import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** اليوزر الحالي + كلاينت بصلاحياته (كل القراءات بتعدّي على قواعد الرؤية في الداتابيز) */
export async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export const fail = (status: number, ar: string, en: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, ar, en, ...extra }, { status });

export const FILE_KINDS = ['quote', 'image', 'contract', 'other'] as const;
export const KIND_LABEL: Record<string, string> = { quote: 'عرض سعر', image: 'صورة', contract: 'عقد', other: 'ملف' };

export type FileRow = {
  id: string; lead_id: string; user_id: string | null; kind: string; file_name: string; mime_type: string | null;
  size_bytes: number; parts: number; tg_chat_id: string | null; tg_file_ids: (string | null)[]; tg_message_ids: (number | null)[];
  status: string; created_at: string;
};
