// Server-only helpers for the invitation token flow.
//
// The token is 32 random bytes encoded as base64url (43 chars). Stored in
// the invitations.token column and looked up by exact match. Plenty of
// entropy (256 bits) to be unguessable; the unique index makes lookup
// constant-time.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';

/** Generates a single-use invitation token. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Default invitation lifetime — 7 days from creation. */
export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Construct the absolute URL the recipient should open. Pulls the host from
 * the inbound request's headers (so it works on localhost, preview deploys,
 * and prod without configuration). Falls back to NEXT_PUBLIC_APP_URL or a
 * relative path when neither is available.
 */
export async function inviteAcceptUrl(token: string): Promise<string> {
  const path = `/accept-invite?token=${encodeURIComponent(token)}`;
  try {
    const h = await headers();
    const proto = h.get('x-forwarded-proto') ?? 'http';
    const host = h.get('host');
    if (host) return `${proto}://${host}${path}`;
  } catch {
    // headers() can throw outside a request scope (build time, scripts).
    // Fall through.
  }
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

/** True if `expiresAt` is in the past relative to now. */
export function isExpired(expiresAt: Date | string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return t.getTime() < Date.now();
}
