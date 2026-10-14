'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(sp.get('reason') === 'inactive' ? 'الحساب ده موقوف — كلّم الأدمن.' : '');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setError('الإيميل أو الباسورد غلط');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm p-6 space-y-4">
      <div className="text-center space-y-1">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-indigo-600 text-white grid place-items-center text-xl font-extrabold">
          {APP_NAME.slice(0, 1)}
        </div>
        <h1 className="text-xl font-bold">{APP_NAME}</h1>
        <p className="text-sm text-slate-500">سجّل دخولك لحسابك</p>
      </div>
      <div>
        <label className="label">الإيميل</label>
        <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label">الباسورد</label>
        <input className="input" type="password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary w-full" disabled={loading}>
        <LogIn size={16} /> {loading ? 'جاري الدخول…' : 'دخول'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4 bg-gradient-to-br from-indigo-50 to-slate-100">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
