// Direct-to-storage upload plumbing (server side).
//
// WHY: Vercel rejects serverless request bodies over ~4.5MB
// (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE a server action runs, so posting a
// File through a server action silently caps every upload at ~4.5MB —
// regardless of next.config's bodySizeLimit and regardless of the
// module's own MAX_*_BYTES. The fix: a server action mints a short-lived
// signed upload URL for a server-generated path; the browser PUTs the
// file straight to Supabase Storage (no Vercel function in the path);
// a finalize action then verifies the blob server-side and records it.
//
// SECURITY MODEL:
//   - Paths are generated server-side and always start with the caller's
//     companyId — the client never chooses where a blob lands.
//   - Finalize actions must call `statStorageObject` (never trust
//     client-reported size/mime) and re-check the companyId prefix.
//   - Tokens are single-path, short-TTL, upload-only.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/auth/supabase-admin';

export type SignedUpload = {
  /** Where the blob will live — server-generated, companyId-prefixed. */
  storagePath: string;
  /** PUT the file body here (token embedded in the URL). */
  signedUrl: string;
};

/**
 * Mint a signed upload URL for a fresh server-generated path:
 *   <companyId>/<...scope segments>/<uuid>.<ext>
 * Returns null when storage isn't configured (caller surfaces its own
 * NotConfigured error).
 */
export async function createSignedUploadForBucket(input: {
  bucket: string;
  companyId: string;
  /** Optional extra path segments between companyId and the uuid (e.g.
   *  projectId, or year/month). Sanitized — must be path-safe already. */
  scopeSegments?: string[];
  ext: string;
}): Promise<SignedUpload | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const id = randomUUID();
  const middle =
    input.scopeSegments && input.scopeSegments.length > 0
      ? `${input.scopeSegments.join('/')}/`
      : '';
  const storagePath = `${input.companyId}/${middle}${id}.${input.ext}`;
  const { data, error } = await client.storage
    .from(input.bucket)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new Error(
      `Could not create an upload URL: ${error?.message ?? 'unknown error'}`,
    );
  }
  return { storagePath, signedUrl: data.signedUrl };
}

/**
 * Server-side stat of an uploaded blob — the source of truth for size and
 * MIME when finalizing a direct upload. Returns null when the blob doesn't
 * exist (e.g. the client's PUT failed or the path is bogus).
 */
export async function statStorageObject(
  bucket: string,
  storagePath: string,
): Promise<{ byteSize: number; mimeType: string } | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const lastSlash = storagePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : '';
  const name = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;
  const { data, error } = await client.storage.from(bucket).list(dir, {
    limit: 100,
    search: name,
  });
  if (error || !data) return null;
  const hit = data.find((o) => o.name === name);
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as {
    size?: number;
    mimetype?: string;
  };
  return {
    byteSize: typeof meta.size === 'number' ? meta.size : 0,
    mimeType: meta.mimetype || 'application/octet-stream',
  };
}

/**
 * Mint a short-lived signed download URL for any private bucket object.
 * Returns null when storage isn't configured. `download` asks Supabase to set
 * Content-Disposition so the browser saves under the original filename.
 */
export async function createSignedDownloadUrl(
  bucket: string,
  storagePath: string,
  ttlSeconds = 3600,
  options?: { download?: string | boolean },
): Promise<string | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(storagePath, ttlSeconds, options);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Best-effort cleanup of a direct-uploaded blob (temp parking, failed
 *  finalize, oversized upload). Never throws. */
export async function removeStorageObject(
  bucket: string,
  storagePath: string,
): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) return;
  try {
    await client.storage.from(bucket).remove([storagePath]);
  } catch {
    /* best-effort */
  }
}
