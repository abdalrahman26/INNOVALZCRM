'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Languages, LogIn } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import { setLangCookie, useI18n } from '@/lib/i18n';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const { tr, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    sp.get('reason') === 'inactive' ? tr('الحساب ده موقوف — كلّم الأدمن.', 'This account is disabled — contact your admin.') : '',
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      const msg = error.message || '';
      if (/invalid login credentials/i.test(msg)) setError(tr('الإيميل أو الباسورد غلط', 'Wrong email or password'));
      else if (/email not confirmed/i.test(msg)) setError(tr('الإيميل لسه مش متأكد (Confirmed) في Supabase', 'Email is not confirmed in Supabase'));
      else setError(tr(`مشكلة في الاتصال بـ Supabase: ${msg}`, `Supabase connection problem: ${msg}`));
      return;
    }
    router.replace('/');
    router.refresh();
  }

  function switchLang() {
    setLangCookie(lang === 'en' ? 'ar' : 'en');
    window.location.reload();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
      <div className="flex justify-end">
        <button type="button" onClick={switchLang} className="btn-ghost btn-sm"><Languages size={14} /> {lang === 'en' ? 'عربي' : 'English'}</button>
      </div>
      <div className="space-y-1 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-xl font-extrabold text-white">
          {APP_NAME.slice(0, 1)}
        </div>
        <h1 className="text-xl font-bold">{APP_NAME}</h1>
        <p className="text-sm text-slate-500">{tr('سجّل دخولك لحسابك', 'Sign in to your account')}</p>
      </div>
      <div>
        <label className="label">{tr('الإيميل', 'Email')}</label>
        <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label">{tr('الباسورد', 'Password')}</label>
        <input className="input" type="password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={loading}>
        <LogIn size={16} /> {loading ? tr('جاري الدخول…', 'Signing in…') : tr('دخول', 'Sign in')}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
