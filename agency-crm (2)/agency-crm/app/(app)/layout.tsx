import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Shell from '@/components/Shell';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile || !profile.is_active) redirect('/logout?reason=inactive');

  return <Shell profile={profile as Profile}>{children}</Shell>;
}
