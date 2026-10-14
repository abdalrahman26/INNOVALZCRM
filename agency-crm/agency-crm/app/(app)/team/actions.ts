'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

type Result = { ok: true } | { ok: false; error: string };

export type UserInput = {
  full_name: string;
  email: string;
  password?: string;
  phone?: string | null;
  role: 'admin' | 'manager' | 'sales';
  is_active?: boolean;
  receives_auto_leads: boolean;
  daily_cap: number | null;
  can_import: boolean;
  can_export: boolean;
  can_assign: boolean;
  can_delete: boolean;
  can_view_all: boolean;
};

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('سجّل دخول الأول');
  const { data: p } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single();
  if (!p || p.role !== 'admin' || !p.is_active) throw new Error('الصلاحية دي للأدمن بس');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY مش متضاف في الـ Environment Variables');
  return user.id;
}

function profileFields(i: UserInput) {
  return {
    full_name: i.full_name.trim(),
    phone: i.phone?.trim() || null,
    role: i.role,
    receives_auto_leads: i.receives_auto_leads,
    daily_cap: i.daily_cap,
    can_import: i.can_import,
    can_export: i.can_export,
    can_assign: i.can_assign,
    can_delete: i.can_delete,
    can_view_all: i.can_view_all,
  };
}

export async function createUserAction(input: UserInput): Promise<Result> {
  try {
    await requireAdmin();
    if (!input.password || input.password.length < 6) return { ok: false, error: 'الباسورد لازم 6 حروف على الأقل' };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name.trim() },
      app_metadata: { created_by_admin: true },
    });
    if (error || !data.user) return { ok: false, error: error?.message ?? 'فشل إنشاء اليوزر' };
    const { error: e2 } = await admin.from('profiles')
      .upsert({ id: data.user.id, email: data.user.email, is_active: true, ...profileFields(input) });
    if (e2) return { ok: false, error: e2.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateUserAction(id: string, input: UserInput): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (id === me && (input.role !== 'admin' || input.is_active === false)) {
      return { ok: false, error: 'مينفعش تشيل صلاحية الأدمن أو توقف حسابك إنت' };
    }
    const admin = createAdminClient();
    const { error } = await admin.from('profiles')
      .update({ ...profileFields(input), is_active: input.is_active ?? true })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };

    const authPatch: { ban_duration?: string; password?: string } = {
      ban_duration: input.is_active === false ? '876000h' : 'none',
    };
    if (input.password) {
      if (input.password.length < 6) return { ok: false, error: 'الباسورد لازم 6 حروف على الأقل' };
      authPatch.password = input.password;
    }
    const { error: e2 } = await admin.auth.admin.updateUserById(id, authPatch);
    if (e2) return { ok: false, error: e2.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
