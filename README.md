# Contractor OS

Modular operations platform for roofing and general contracting companies. See [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) for the full product spec.

## Demo mode (no database required)

The app currently runs entirely on in-memory mock data. Two commands:

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — you'll be redirected to `/projects` with three seeded projects.

No `DATABASE_URL`, no `DEV_COMPANY_ID`, no `db:push` needed.

## What works in demo mode

- **Projects → list** (`/projects`)
- **Projects → create** (`/projects/new`)
- **Projects → view** (`/projects/[id]`)
- **Customers** read-only list (used by the project create form)
- 3 seeded customers, 3 seeded projects to play with

The mock store lives in [`src/lib/mock-store.ts`](src/lib/mock-store.ts). State persists for the life of the dev process — restart `npm run dev` to reset.

## What's NOT wired yet

- Database. Drizzle schemas in [`src/db/schema/`](src/db/schema/) are kept for the next phase but not used by any page.
- Auth / multi-tenant scoping
- Estimates, proposals, change orders, purchase orders, job costs, documents — schemas only.

## File layout

```
src/
├── app/                              # Next.js App Router
│   ├── layout.tsx · page.tsx · globals.css
│   └── (app)/
│       ├── layout.tsx                # sidebar nav
│       └── projects/
│           ├── page.tsx              # list
│           ├── new/page.tsx          # create
│           └── [id]/page.tsx         # view
├── components/ui/                    # button, input, label, select, card, table, badge
├── db/schema/                        # Drizzle schemas (not used in demo mode)
├── lib/
│   ├── mock-store.ts                 # in-memory demo store
│   ├── auth.ts                       # stubbed for demo mode
│   ├── money.ts · utils.ts
└── modules/
    ├── customers/queries.ts
    └── projects/
        ├── schema.ts                 # zod form schema
        ├── queries.ts                # reads from mock-store
        ├── actions.ts                # writes to mock-store
        └── components/
```

## Switching to a real database (later)

1. Provision Postgres, set `DATABASE_URL` in `.env.local`.
2. `npm run db:push` to apply the schema.
3. Replace the `@/lib/mock-store` imports in:
   - `src/modules/projects/queries.ts`
   - `src/modules/projects/actions.ts`
   - `src/modules/customers/queries.ts`
   with Drizzle queries against `@/db`.
4. Wire real auth in `src/lib/auth.ts`.
