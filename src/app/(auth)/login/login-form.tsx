'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAction, type LoginState } from './actions';

export function LoginForm({
  nextUrl,
  initialError,
}: {
  nextUrl: string;
  initialError: string | null;
}) {
  // Server-side login. The browser used to call supabase.auth.signInWithPassword
  // directly (browser client → document.cookie writes), but the cookie was
  // being silently rejected by the browser in production HTTPS — so the
  // dashboard appeared to load via in-memory session, then every subsequent
  // navigation came back unauthenticated. Posting credentials to the server
  // action lets @supabase/ssr write cookies via real Set-Cookie response
  // headers, which the browser accepts reliably.
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signInAction,
    { error: initialError ?? undefined },
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <input type="hidden" name="next" value={nextUrl} />

      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
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
