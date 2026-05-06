'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';

export function LoginForm({
  nextUrl,
  initialError,
}: {
  nextUrl: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError('Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        return;
      }
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      // FORENSIC LOGGING — temporary. Verifies that signInWithPassword actually
      // produced a session AND that document.cookie now contains the
      // sb-*-auth-token. If the session is set but the cookie isn't, the
      // browser is rejecting the cookie (most likely missing Secure flag on
      // HTTPS; see supabase-browser.ts hardening).
      const sbCookies = document.cookie
        .split(';')
        .map((c) => c.trim().split('=')[0])
        .filter((n) => n.startsWith('sb-'));
      // eslint-disable-next-line no-console
      console.log('[contractor-os] login signIn result', {
        hasSession: Boolean(data?.session),
        userId: data?.user?.id ?? null,
        sbCookiesAfterSignIn: sbCookies,
        href: window.location.href,
      });
      if (data?.session && sbCookies.length === 0) {
        // The login API call worked, but document.cookie didn't accept the
        // cookie. Surface this to the user so they don't sit in a confusing
        // loop where dashboard appears to load but the next nav redirects.
        setError(
          'Signed in, but the browser rejected the auth cookie. ' +
            'Try disabling "Block third-party cookies" for this site, or ' +
            'open in a non-incognito window.',
        );
        return;
      }

      // Hard navigation rather than router.replace — guarantees the
      // middleware sees the freshly-set cookie on the next request without
      // any RSC payload caching weirdness.
      const target =
        nextUrl && nextUrl.startsWith('/') ? nextUrl : '/dashboard';
      window.location.assign(target);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-xs text-slate-500 text-center">
        Trouble signing in? Ask your account owner to issue an invite from
        Supabase.
      </p>
    </form>
  );
}
