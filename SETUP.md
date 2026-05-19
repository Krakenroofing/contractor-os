# Setup — Demo Mode → Supabase Postgres

KrakenOps Pro runs in two modes. The choice happens at startup via the
`DATABASE_URL` environment variable.

| Mode | When | Foundation entities (companies / customers / projects / vendors) | Everything else |
|---|---|---|---|
| **Demo** | `DATABASE_URL` is unset | In-memory mock store (resets every dev restart) | In-memory mock store |
| **DB** | `DATABASE_URL` is set | Postgres / Supabase | In-memory mock store (will be migrated next) |

Switching between modes is just an env-var change + a dev-server restart. No code changes.

---

## Stay in demo mode

Default. No setup required.

```bash
npm install
npm run dev
# → http://localhost:3000
```

You can stop reading here.

---

## Move foundation entities to Supabase

This connects the four foundation entities to a real Postgres database while
the rest of the app keeps running off the mock store. The phased approach
means you can test the DB integration on a small surface first, before we wire
up estimates, proposals, invoices, payments, and job costing in the next pass.

### 1. Create a Supabase project

1. Go to https://supabase.com → **New project**.
2. Pick a region close to you. Save the database password — you'll need it in step 3.
3. Wait ~2 minutes for the project to provision.

### 2. Get the connection strings

In the Supabase dashboard:

- **Database connection string** — _Project Settings → Database → Connection string → Transaction pooler (URI)_. Should look like:
  ```
  postgresql://postgres.<project-ref>:<your-password>@<region>.pooler.supabase.com:6543/postgres
  ```
  Use the transaction pooler (not the direct connection). Drizzle's `postgres-js` driver is configured with `prepare: false`, which is what the pooler needs.

- **API keys** (optional, for later — Auth/Storage features we haven't built yet) — _Project Settings → API_:
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose to the browser)

### 3. Create `.env.local`

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
DATABASE_URL=postgresql://postgres.xxxxx:your-password@aws-0-us-west-1.pooler.supabase.com:6543/postgres
```

Leave the Supabase JS-client keys commented for now; they're not used by this phase.

### 4. Install the new dev dependencies

`db:seed` uses `tsx` to execute the TypeScript seed script directly, plus `dotenv` to load `.env.local`:

```bash
npm install
```

(Both `tsx` and `dotenv` are now declared in `package.json`.)

### 5. Push the schema to Supabase

This creates every table from `src/db/schema/*.ts` in your Supabase database, including the foundation entities (companies, users, customers, projects, vendors, cost_codes) and all the other tables (estimates, proposals, invoices, etc.) that aren't connected to the runtime yet but are ready when we phase them in.

```bash
npm run db:push
```

You should see Drizzle output listing the SQL it executed. If it asks "Do you want to push?" — answer yes.

### 6. Seed demo data into Supabase

```bash
npm run db:seed
```

This copies the same demo seed (Kraken Roofing + TRB Ltd., 4 customers, 4 projects, 4 vendors, ~19 cost codes, 2 placeholder users) into your Supabase database. Re-running is safe — every insert uses `ON CONFLICT DO NOTHING`.

### 7. Restart the dev server

```bash
npm run dev
```

The four foundation modules will now read & write Supabase:

- `/customers` — list/create routes through Postgres
- `/customers/[id]` — fetched from Postgres
- `/projects` — same
- `/projects/[id]` — same
- `/vendors` — same
- `/vendors/[id]` — same
- The Settings page (`/settings`) updates the active company in Postgres
- The sidebar company switcher reads from Postgres

Everything else (estimates, proposals, change orders, POs, invoices, payments, retainage, job costing, dashboard alerts) still serves from the in-memory mock store. Cross-references work — e.g. an in-memory invoice for `projectId: "xxx"` still resolves the project name correctly because the project lookup goes through the data layer.

### 8. Verify

```bash
npm run db:studio
```

Opens Drizzle Studio at https://local.drizzle.studio. You should see the 6 foundation tables populated.

In the running app, create a new customer at `/customers/new`. After save, the new row should appear in Drizzle Studio's `customers` table.

---

## Switching back to demo mode

Comment out `DATABASE_URL` in `.env.local` and restart the dev server. The app falls back to the in-memory store; nothing breaks.

---

## Architecture notes

### `src/lib/data/*` — the data layer

Each foundation entity has an async accessor module:

- `src/lib/data/companies.ts` — `listCompanies()`, `getCompany(id)`, `updateCompany(id, patch)`
- `src/lib/data/customers.ts` — `listCustomers(companyId)`, `getCustomer(companyId, id)`, `createCustomer(companyId, input)`
- `src/lib/data/projects.ts` — `listProjects(companyId)`, `getProject(companyId, id)`, `createProject(companyId, input)`
- `src/lib/data/vendors.ts` — `listVendors(companyId)`, `getVendor(companyId, id)`, `createVendor(companyId, input)`

Each function:
1. Calls `isDatabaseConfigured()`.
2. If true → runs a Drizzle query against Postgres.
3. If false → calls the in-memory helper from `src/lib/mock-store.ts`.

This is the seam future migrations follow. When estimates / proposals / invoices etc. get phased in, each gets its own `src/lib/data/<entity>.ts` and call sites get migrated the same way.

### `src/db/index.ts` — lazy client

- `isDatabaseConfigured()` — boolean check on `DATABASE_URL`.
- `getDb()` — returns a Drizzle client when configured, else `null`. Constructed lazily on first call.
- `requireDb()` — for scripts. Throws with a helpful message if `DATABASE_URL` is missing.

The client is **never** built at module load, so importing `@/db` in demo mode is a no-op.

### `src/lib/mock-store.ts` — unchanged contract

The existing sync `listMockCompanies`, `getMockCompany`, etc. are still exported and still serve the in-memory store. They're now used internally by the data layer for the demo fallback path; pages and actions consume the new async API instead.

---

## Files changed

This is the exact list for the foundation-DB phase:

### New (7)

1. `src/lib/db.ts` _(was rewritten — the previous version threw at module load when `DATABASE_URL` was unset, breaking demo mode)_
2. `src/lib/data/companies.ts`
3. `src/lib/data/customers.ts`
4. `src/lib/data/projects.ts`
5. `src/lib/data/vendors.ts`
6. `src/db/seed.ts`
7. `SETUP.md` (this file)

### Modified

1. `src/db/index.ts` — lazy/tolerant client + `isDatabaseConfigured()` + `requireDb()`
2. `.env.example` — Supabase placeholders + clear demo/DB-mode explanation
3. `package.json` — `db:seed` script + `tsx` / `dotenv` devDependencies
4. `src/lib/active-company.ts` — uses async `getCompany` / `listCompanies`
5. `src/lib/active-company-actions.ts` — uses async `getCompany`
6. `src/app/(app)/layout.tsx` — sidebar company list now async
7. `src/modules/customers/queries.ts` — async fetch
8. `src/modules/customers/actions.ts` — calls `createCustomer` from data layer
9. `src/modules/projects/queries.ts` — async fetch + Promise.all customer hydration
10. `src/modules/projects/actions.ts` — calls `createProject` from data layer
11. `src/modules/vendors/actions.ts` — calls `createVendor` from data layer
12. `src/modules/settings/actions.ts` — calls `updateCompany` from data layer
13. `src/modules/accounts-receivable/lib/ar.ts` — `buildAgingRowsForCompany` now async
14. `src/modules/retainage/lib/retainage.ts` — `buildRetainageRowsForCompany` and `listRecentRetainageReleases` now async
15. `src/modules/job-costing/lib/financials.ts` — `computeProjectFinancials` and `listAllProjectFinancials` now async
16. `src/modules/dashboard/lib/dashboard.ts` — `buildDashboardData` now async
17. ~28 page files under `src/app/(app)/**/page.tsx` — call sites updated (`await get<Entity>`, `await list<Entity>`, `Promise.all` where needed)

The verification grep returns zero stale `Mock` calls outside `src/lib/mock-store.ts` and `src/lib/data/`. Type-check stays at the same pre-existing baseline.

---

## What's still in mock mode

These will get the same treatment in the next phase. Until then, they remain in-memory only — they reset on every dev restart, and `db:seed` does **not** populate them:

- estimates (and line items)
- proposals
- change orders (and line items)
- purchase orders (and line items)
- invoices (and line items, payments)
- invoice templates
- retainage releases
- landed costs
- labor entries
- job cost entries
- activity log

Cross-references between mock and DB work fine because every `projectId` / `customerId` / `vendorId` / `companyId` reference resolves through the data layer regardless of which side stores the record.
