'use client';

// Route-level error boundary for /job-costing and /job-costing/[projectId].
// Any render-time exception in this segment shows a contained panel with a
// retry instead of blanking the whole app shell with Next's global
// "Application error" screen.

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function JobCostingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[job-costing] render error', error);
  }, [error]);

  // Chunk-load failures mean this browser tab is on an older deployment and
  // the route's JS no longer exists on the server — retrying the render
  // can't fix that, only a hard reload can.
  const stale =
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(
      `${error.name} ${error.message}`,
    );

  return (
    <div className="p-8">
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 max-w-xl space-y-3">
        <h2 className="text-lg font-semibold text-red-800">
          Something went wrong loading job costing
        </h2>
        <p className="text-sm text-red-700">
          {stale
            ? 'The app was updated since this page was opened. Reload to get the latest version.'
            : 'The rest of the app is unaffected. Try again — if this keeps happening, note which project you opened and report it.'}
        </p>
        {error.digest && (
          <p className="text-xs text-red-400 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={() => (stale ? window.location.reload() : reset())}
          >
            {stale ? 'Reload' : 'Retry'}
          </Button>
        </div>
      </div>
    </div>
  );
}
