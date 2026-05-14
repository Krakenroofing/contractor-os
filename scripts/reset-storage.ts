// One-shot storage cleanup utility for the operational-data reset.
//
// Lists every object in the two operational buckets and (optionally) deletes
// them. Hard-coded to ONLY touch `project-documents` and `daily-report-photos`.
// The `company-logos` bucket is never named in this script and cannot be
// reached from it.
//
// Usage (from project root, PowerShell):
//
//   # 1) Dry run — lists every file that WOULD be deleted, deletes nothing
//   npx tsx scripts/reset-storage.ts
//
//   # 2) For real — actually deletes (only after you've reviewed the dry run)
//   npx tsx scripts/reset-storage.ts --confirm
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local. The script bails out cleanly if either is missing.

import 'dotenv/config';
import { config as loadDotenv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// .env loads first from .env, then .env.local (the latter wins). Next.js
// convention is to keep secrets in .env.local — load it explicitly.
loadDotenv({ path: '.env.local', override: true });

// Hard-coded allow-list. Any other bucket name passed here would be a bug.
const TARGET_BUCKETS = ['project-documents', 'daily-report-photos'] as const;

const DRY_RUN = !process.argv.includes('--confirm');

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

async function listAllPaths(
  client: SupabaseClient,
  bucket: string,
): Promise<string[]> {
  const out: string[] = [];
  async function recurse(prefix: string): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`list(${bucket}/${prefix}): ${error.message}`);
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Folder entries have a null `id`. Files have a UUID.
        if (entry.id === null || entry.id === undefined) {
          await recurse(path);
        } else {
          out.push(path);
        }
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  await recurse('');
  return out;
}

async function deleteInBatches(
  client: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<number> {
  if (paths.length === 0) return 0;
  const BATCH = 500;
  let removed = 0;
  for (let i = 0; i < paths.length; i += BATCH) {
    const slice = paths.slice(i, i + BATCH);
    const { data, error } = await client.storage.from(bucket).remove(slice);
    if (error) throw new Error(`remove(${bucket}): ${error.message}`);
    removed += data?.length ?? 0;
    process.stdout.write(
      `    removed ${removed}/${paths.length}\r`,
    );
  }
  process.stdout.write('\n');
  return removed;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
    process.exit(1);
  }
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no deletes)' : 'CONFIRMED — will delete'}`);
  console.log(`Target buckets: ${TARGET_BUCKETS.join(', ')}`);
  console.log(`(company-logos is NOT in this list and will not be touched)`);
  console.log('');

  let grandTotal = 0;
  for (const bucket of TARGET_BUCKETS) {
    console.log(`Bucket: ${bucket}`);
    const paths = await listAllPaths(client, bucket);
    console.log(`  found ${fmt(paths.length)} object${paths.length === 1 ? '' : 's'}`);

    // Print up to 10 sample paths so the operator can sanity-check.
    if (paths.length > 0) {
      const sample = paths.slice(0, 10);
      for (const p of sample) console.log(`    - ${p}`);
      if (paths.length > sample.length) {
        console.log(`    … and ${fmt(paths.length - sample.length)} more`);
      }
    }

    if (!DRY_RUN && paths.length > 0) {
      console.log('  deleting…');
      const removed = await deleteInBatches(client, bucket, paths);
      console.log(`  removed ${fmt(removed)} object${removed === 1 ? '' : 's'}`);
    }

    grandTotal += paths.length;
    console.log('');
  }

  console.log(
    DRY_RUN
      ? `Dry run complete. ${fmt(grandTotal)} object(s) would be deleted across ${TARGET_BUCKETS.length} bucket(s).`
      : `Done. ${fmt(grandTotal)} object(s) processed across ${TARGET_BUCKETS.length} bucket(s).`,
  );
  if (DRY_RUN && grandTotal > 0) {
    console.log('Re-run with --confirm to actually delete.');
  }
}

main().catch((err) => {
  console.error('Storage reset failed:', err);
  process.exit(1);
});
