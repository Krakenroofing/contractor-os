'use client';

// Error boundary for the auth segment (login / accept-invite / forgot-
// password). Its main job: recover from deployment version skew. A browser
// that loaded the login page before a deploy holds stale server-action ids;
// submitting then fails with "Failed to find Server Action" and, without
// this boundary, the whole page is replaced by Next's dead "Application
// error" screen. A hard reload fetches the new deployment's page (fresh
// action ids), so we do that automatically — once per 30s, so a genuinely
// broken deployment degrades to a visible panel instead of a reload loop.

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

const RELOAD_FLAG = 'auth-stale-reload-at';
const RELOAD_COOLDOWN_MS = 30_000;

function isStaleDeployment(error: Error): boolean {
  return /Failed to find Server Action|ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(
    `${error.name} ${error.message}`,
  );
}

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleDeployment(error);

  useEffect(() => {
    console.error('[auth] error boundary', error);
    if (!stale) return;
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
      window.location.reload();
    }
  }, [error, stale]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="rounded-lg border border-slate-200 bg-white p-8 max-w-md w-full space-y-3 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {stale ? 'App updated — reloading…' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-slate-600">
          {stale
            ? 'The app was updated while this page was open. If it does not reload by itself, use the button below, then sign in again.'
            : 'Try again — if this keeps happening, contact your account owner.'}
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 font-mono">Ref: {error.digest}</p>
        )}
        <Button
          className="w-full"
          onClick={() => (stale ? window.location.reload() : reset())}
        >
          {stale ? 'Reload now' : 'Try again'}
        </Button>
      </div>
    </div>
  );
}
