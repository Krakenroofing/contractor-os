// Server-only admin client. Uses the SUPABASE_SERVICE_ROLE_KEY which bypasses
// RLS and grants full read/write to auth.users.
//
// SCOPED USAGE ONLY: this client is used exclusively for one-off privileged
// operations that the regular auth-session-bound clients can't perform —
// today, just provisioning an auth.users row when an invitee accepts an
// invitation. Do NOT import this from regular data-layer code paths.

import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: {
      // No session storage — this is a one-shot admin handle.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
