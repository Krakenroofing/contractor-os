import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Lazy, tolerant Drizzle client.
//
// In demo mode (no DATABASE_URL) the app must keep working off the in-memory
// mock store, so we MUST NOT throw at module load time. The client is only
// constructed on first call to getDb() when DATABASE_URL is set.
//
// ===== Trust boundary =====
//
// The DATABASE_URL points at Supabase's transaction pooler, which binds the
// connection as `postgres.<project-ref>` — the project owner. Postgres'
// default rule is that table owners BYPASS Row Level Security. So queries
// issued through the client returned here run unconstrained by the policies
// in supabase/migrations/0001_rls.sql.
//
// This is intentional. The trust boundary is the application layer: every
// data-layer function in src/lib/data/* filters by `companyId` derived from
// getActiveCompanyId(), which itself derives from the authenticated user's
// memberships. Doubling-up RLS here would be redundant and would force every
// query to set per-request JWT claims (we don't).
//
// RLS exists as defense-in-depth against any path that ISN'T this trusted
// server: PostgREST queries from the browser via the public anon key, future
// supabase-js client components, analytics tools logged in as a non-owner
// role, and so on. Those queries DO go through RLS.
//
// SUPABASE_SERVICE_ROLE_KEY is used in EXACTLY ONE place — the invite
// acceptance server action — to call supabase-js admin.createUser(). It
// never touches the data layer. See src/lib/auth/supabase-admin.ts for
// the scoping rules.

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && url.trim() !== '';
}

/**
 * Returns a Drizzle client when DATABASE_URL is configured, otherwise null.
 * Callers in the data layer should use isDatabaseConfigured() first to pick
 * between the DB path and the in-memory fallback.
 */
export function getDb() {
  if (!isDatabaseConfigured()) return null;
  if (!_db) {
    _client = postgres(process.env.DATABASE_URL!, {
      prepare: false,
      max: 10,
    });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/**
 * Throws if the database isn't configured. Use from scripts (e.g. db:seed)
 * where running without a DB makes no sense.
 */
export function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(
      'DATABASE_URL is not set. Configure it in .env.local before running this command.',
    );
  }
  return db;
}

export type DB = NonNullable<ReturnType<typeof getDb>>;
