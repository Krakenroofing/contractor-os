# KrakenOps Pro — V1 Product Plan

A modular operations platform for roofing and general contracting companies. The thesis is simple: contractors lose margin between the estimate and the closeout because the numbers live in three different systems. KrakenOps Pro owns the job-profitability loop — estimate → proposal → change orders → POs → actual costs → P&L — and hands clean data off to QuickBooks, payroll, and tax tools instead of trying to replace them.

---

## 1. Product Requirements Document

### 1.1 Vision
A single source of truth for **job-level profitability**, from first estimate to final closeout, purpose-built for small and mid-sized roofing / GC firms (1–50 employees, $1M–$30M annual revenue).

### 1.2 Problem
- Estimates are built in spreadsheets and never reconciled against actuals.
- Change orders are negotiated verbally and forgotten until disputes arise.
- POs aren't tied to jobs, so material costs surface only when bills hit QuickBooks.
- Owners discover a job lost money weeks after it closed.
- Customer-facing proposals are inconsistent and slow to produce.

### 1.3 Goals (V1)
1. Produce a professional estimate in under 30 minutes using reusable assemblies.
2. Generate a branded proposal PDF directly from the estimate.
3. Track every change order against the original contract value with audit history.
4. Issue and track POs against a job and cost code before the bill arrives.
5. Show real-time **estimated vs. committed vs. actual** cost on every project.
6. Surface a portfolio dashboard: revenue, gross margin, backlog, jobs at risk.

### 1.4 Non-Goals (explicitly deferred)
- General ledger, AP/AR ledgers, bank reconciliation, financial statements.
- Payroll calculation, tax withholding, 1099/W-2 generation.
- Sales tax filing or any tax preparation.
- Field crew scheduling, dispatch, GPS, or time clocks (V2).
- Lead capture / marketing CRM (basic customer records only).
- Inventory / warehouse management.

### 1.5 Personas
| Persona | Primary needs |
|---|---|
| **Owner / GM** | Portfolio health, margin, cash. Decision: which jobs to bid, which to fire. |
| **Estimator** | Fast, accurate estimates with reusable assemblies and historical cost data. |
| **Project Manager** | Budget vs. actual, CO discipline, vendor commitments, document trail. |
| **Office Admin** | Customer records, PO entry, document filing, vendor setup. |
| **External Accountant** | Read-only export to push into QuickBooks (V1.1). |

### 1.6 Success Metrics
- Time to produce a proposal: **< 30 min** (from a baseline of 2–4 hours).
- % of jobs with reconciled actuals at closeout: **> 90%**.
- % of change orders documented before work performed: **> 80%**.
- Owner can answer "what's my gross margin this quarter?" in **< 30 seconds**.

### 1.7 Key Functional Requirements
- Multi-tenant: each company's data isolated; users can belong to multiple companies.
- Role-based permissions (see §3).
- Cost-code library: industry-standard CSI divisions plus roofing-specific codes; per-company overrides.
- Estimate templates / assemblies (e.g. "20 sq asphalt tear-off & replace").
- Versioned estimates and proposals (every send creates an immutable snapshot).
- Change orders adjust contract value and budget in one motion, with customer signature capture.
- POs reduce remaining budget on a cost code; receiving partial deliveries is supported.
- Job cost entry: labor (manual hours × rate), materials (from POs/bills), subs (commitments), other.
- Document storage scoped per project, with type tagging (contract, permit, photo, invoice, etc.).
- Audit log on every financial-affecting action.

### 1.8 Non-Functional Requirements
- **Performance**: project dashboard P95 < 1s with 500 jobs / 50k line items per tenant.
- **Reliability**: 99.5% uptime; automated daily backups; 30-day point-in-time recovery.
- **Security**: SOC 2 readiness from day one — encryption at rest + in transit, RLS, MFA, audit logs.
- **Compliance**: handles PII (customer info) and financial data; no PCI scope in V1 (no card storage).
- **Mobile**: responsive web for field PMs; native app deferred to V2.

---

## 2. Database Schema

PostgreSQL, multi-tenant via `company_id` on every tenant-scoped table, enforced with row-level security. Money stored as `numeric(14,2)`. All tables include `created_at`, `updated_at`, `created_by`, `updated_by` (omitted below for brevity).

### 2.1 Identity & tenancy
```
companies            (id, name, slug, logo_url, address, ein_last4, default_currency, fiscal_year_start)
users                (id, email, name, phone, hashed_password, mfa_enabled, last_login_at)
memberships          (id, company_id, user_id, role, status)         -- one per user×company
invites              (id, company_id, email, role, token, expires_at, accepted_at)
audit_log            (id, company_id, actor_user_id, entity_type, entity_id, action, diff jsonb, created_at)
```

### 2.2 Customers, vendors, projects
```
customers            (id, company_id, name, primary_contact, email, phone, billing_address,
                      jobsite_address, customer_type [residential|commercial], notes)
vendors              (id, company_id, name, email, phone, address, default_terms,
                      tax_id_last4, is_subcontractor bool, w9_on_file bool)
projects             (id, company_id, customer_id, number, name, status
                      [lead|estimating|won|in_progress|closed|lost],
                      jobsite_address, project_manager_id, estimator_id,
                      start_date, target_completion_date, actual_completion_date,
                      contract_value numeric, original_contract_value numeric,
                      total_change_orders numeric, current_budget numeric)
project_team         (id, project_id, user_id, role)
```

### 2.3 Cost codes
```
cost_code_libraries  (id, company_id null, name, is_global bool)     -- null company_id = system default
cost_codes           (id, library_id, code, description, category
                      [labor|material|subcontract|equipment|other])
project_cost_codes   (id, project_id, cost_code_id, budgeted_amount, sort_order)
```

### 2.4 Estimates
```
estimates            (id, company_id, project_id, version int, status [draft|sent|approved|rejected],
                      subtotal, tax_amount, total, markup_percent, overhead_percent,
                      valid_until, sent_at, approved_at, parent_estimate_id)
estimate_sections    (id, estimate_id, name, sort_order)
estimate_line_items  (id, estimate_id, section_id, cost_code_id, description, unit,
                      quantity numeric, unit_cost numeric, markup_percent numeric,
                      line_total numeric, assembly_id null, sort_order)
assemblies           (id, company_id, name, description, default_unit, default_markup_percent)
assembly_components  (id, assembly_id, cost_code_id, description, unit, quantity, unit_cost)
```

### 2.5 Proposals
```
proposals            (id, company_id, project_id, estimate_id, version int,
                      status [draft|sent|viewed|accepted|declined|expired],
                      pdf_url, sent_at, viewed_at, accepted_at, signature_image_url,
                      signed_by_name, signed_by_email, signed_ip, expiry_date)
proposal_templates   (id, company_id, name, header_html, body_html, footer_html,
                      terms_and_conditions text, is_default bool)
```

### 2.6 Change orders
```
change_orders        (id, company_id, project_id, number, status
                      [draft|pending_internal|pending_customer|approved|rejected|void],
                      description, reason
                      [scope_change|customer_request|design_change|conditions|other],
                      subtotal, tax_amount, total,
                      customer_signed_at, customer_signed_name,
                      schedule_impact_days int)
change_order_line_items (id, change_order_id, cost_code_id, description, unit,
                          quantity, unit_cost, markup_percent, line_total)
```

### 2.7 Purchase orders
```
purchase_orders      (id, company_id, project_id, vendor_id, number, status
                      [draft|issued|partially_received|received|closed|void],
                      issue_date, expected_delivery_date, ship_to_address,
                      subtotal, tax_amount, shipping, total, notes)
purchase_order_lines (id, purchase_order_id, cost_code_id, description, unit,
                      quantity_ordered, quantity_received, unit_cost, line_total)
po_receipts          (id, purchase_order_id, received_at, received_by_user_id, notes)
po_receipt_lines     (id, receipt_id, po_line_id, quantity_received)
```

### 2.8 Job costs (actuals)
```
job_cost_entries     (id, company_id, project_id, cost_code_id, source
                      [manual|po_receipt|labor_entry|bill_import|qbo_sync],
                      source_ref_id, entry_date, vendor_id null, description,
                      quantity, unit_cost, amount numeric, attachment_url, notes)
labor_entries        (id, company_id, project_id, cost_code_id, user_id null,
                      worker_name, work_date, hours numeric, rate numeric, amount,
                      burden_percent, notes)
```

### 2.9 Documents
```
documents            (id, company_id, project_id null, customer_id null, vendor_id null,
                      type [contract|permit|insurance|photo|invoice|receipt|drawing|other],
                      filename, storage_key, mime_type, size_bytes,
                      uploaded_by_user_id, tags text[])
```

### 2.10 Derived views (for the dashboard)
- `project_financials_v` — joins original contract, COs, current budget, committed (open POs + subs), actual costs (job_cost_entries), to surface estimated vs. committed vs. actual vs. remaining and gross margin.
- `company_portfolio_v` — sums revenue, costs, margin by status across all projects in a company.

---

## 3. User Roles

Permissions enforced server-side. Memberships scope a user to a company; role scopes their actions inside it.

| Role | Customers | Projects | Estimates | Proposals | COs | POs | Job Costs | Docs | Settings |
|---|---|---|---|---|---|---|---|---|---|
| **Owner** | Full | Full | Full | Full | Full | Full | Full | Full | Full + billing |
| **Admin** | Full | Full | Full | Full | Full | Full | Full | Full | Full (no billing) |
| **Project Manager** | View | Full (assigned) | Full (assigned) | Full (assigned) | Full (assigned) | Full (assigned) | Full (assigned) | Full | None |
| **Estimator** | View + create | View + create | Full | Full (own) | View | View | View | Upload | None |
| **Office Admin** | Full | View | View | View | View | Create + edit | Create entries | Full | None |
| **Field Lead** *(V1.5)* | None | View (assigned) | None | None | None | View (assigned) | Create labor / receipts | Upload | None |
| **External Accountant** *(V2)* | View | View | View | View | View | View | View + export | View | None |

A user can hold different roles in different companies.

---

## 4. Page / Screen List

### 4.1 Auth & onboarding
- Sign up (creates company + owner)
- Log in / MFA challenge
- Forgot / reset password
- Invite acceptance
- Company switcher (for multi-company users)
- First-run setup wizard: company info → cost codes → first user invites → first project

### 4.2 Company dashboard (home)
- KPIs: revenue YTD, gross margin %, backlog $, jobs at risk count
- Charts: monthly revenue trend, margin by project type, jobs by status
- Tables: recent activity, projects needing attention (negative margin trend, expired proposals, overdue COs)

### 4.3 Customers
- Customer list (search, filter by type, sort)
- Customer detail: contact info, project history, lifetime revenue, documents
- New / edit customer form

### 4.4 Projects
- Project list (filters: status, PM, customer, date range)
- New project wizard
- **Project detail** (tabbed):
  - Overview — header KPIs, schedule, team
  - Estimate(s)
  - Proposals
  - Change Orders
  - Purchase Orders
  - Job Costs
  - Documents
  - Activity / audit log

### 4.5 Estimating
- Estimate builder (sections → line items, with assembly insertion)
- Cost code picker, unit/qty/cost grid, live totals with markup/overhead
- Assembly library (create, edit, duplicate)
- Estimate version history & compare

### 4.6 Proposals
- Template editor (header/body/footer/T&Cs)
- Proposal builder (pulls from estimate, edit narrative, attach exhibits)
- Preview & generate PDF
- Send via email; public view link with view tracking
- Customer-facing accept/decline page with typed signature

### 4.7 Change orders
- CO list (per company, filterable by project & status)
- CO builder (line items, schedule impact, attachments)
- Approval flow: internal review → customer send → customer signature
- Customer-facing CO acceptance page

### 4.8 Purchase orders
- PO list (per company)
- PO builder (vendor, project, cost-code lines)
- Issue / email PO to vendor (PDF)
- Receive shipment (full / partial)
- PO close-out

### 4.9 Vendors
- Vendor list, vendor detail (POs, spend, W-9 status)

### 4.10 Job costing & financial dashboards
- Project P&L: budget | committed | actual | remaining | margin (by cost code)
- Variance flags (actual > budget on a code)
- Portfolio view: all projects sorted by margin %
- WIP report (V1.1): earned revenue vs. billed
- Closeout checklist

### 4.11 Documents
- Project document library with tag filters
- Drag-and-drop upload, preview pane

### 4.12 Settings
- Company profile, branding (logo, colors, default proposal template)
- Users & invites
- Cost code library editor
- Assembly library
- Tax rates
- Numbering schemes (project #, estimate #, PO #, CO #)
- Integrations (V1.1+)
- Billing & subscription

---

## 5. Development Roadmap

Working backward from a usable beta with 2–3 design-partner contractors. Assumes a small team (1–2 engineers + designer).

| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **0. Foundations** | 1–2 | Repo, CI/CD, auth, multi-tenant scaffolding, RLS, audit log, base UI kit | A user can sign up, create a company, invite teammates, log in with MFA |
| **1. Customers + Projects** | 3–4 | Customer CRUD, project CRUD, project detail shell, cost codes, settings | A PM can create a project with a budget by cost code |
| **2. Estimating** | 5–7 | Estimate builder, assemblies, versioning | Estimator builds a 50-line estimate from assemblies in <30 min |
| **3. Proposals + Documents** | 8–9 | Proposal templates, PDF generation, send + accept flow, document storage | Customer can accept a proposal online and the project flips to "won" |
| **4. Change Orders + POs** | 10–12 | CO builder, customer signature, PO builder, receiving | A CO and a PO both correctly adjust the project budget/committed values |
| **5. Job Costing + Dashboards** | 13–15 | Manual cost entry, labor entries, project P&L, company dashboard | Owner sees portfolio gross margin updated in real time |
| **6. Beta polish** | 16–18 | Onboarding wizard, email notifications, performance pass, bug bash with design partners | 3 contractors actively using the product on real jobs |
| **7. V1.1** | 19–24 | QuickBooks Online sync, CSV export, e-signature integration, basic reports | Bills sync from QBO into job costs without manual entry |
| **V2 themes** | 24+ | Mobile field app, time tracking, scheduling, AI takeoff, payroll export, customer portal | — |

Today is **2026-04-29**. A start in early May puts beta exit around mid-September 2026, V1.1 by end of October.

---

## 6. MVP Scope

The leanest cut that still proves the thesis (job profitability tracked end-to-end). Anything outside this list waits.

### In MVP
- Email/password auth + MFA, single company per user (multi-company UI later)
- Owner / Admin / PM / Estimator roles only
- Customers (basic record only)
- Projects with status, team, budget by cost code
- One global cost-code library (CSI divisions + a roofing pack), per-company overrides
- Estimate builder with sections, line items, markup, overhead, tax — but only a simple assembly library (no nested assemblies)
- Proposal generator: one template, branded PDF, email send, public accept page with typed signature
- Change orders: internal create + customer email accept (no in-app signing UI for CO in MVP — typed name on a public page is enough)
- Purchase orders: create, email PDF to vendor, mark received (full or partial)
- Manual job cost entry (labor, materials, subs, other) + auto-entries from PO receipts
- Project P&L view: budget vs. committed vs. actual vs. remaining, gross margin
- Company dashboard: revenue, margin %, backlog, jobs at risk
- Document upload per project (S3-style storage, type tagging)
- Audit log (read-only)

### Deferred from MVP
- E-signature integration (DocuSign/Dropbox Sign) — typed signature is fine for V1
- QuickBooks sync — ship CSV export first, sync in V1.1
- Field/mobile app, time clock, photo capture
- AI takeoff / measurement integrations
- Customer portal (status, payments)
- WIP / earned-revenue reporting
- Multi-currency, multi-location
- Two-way email threading
- Custom fields / custom reports
- Scheduling / Gantt

### Hard pruning rules
- If it touches GL, payroll, or tax — out.
- If it doesn't move the needle on **time-to-proposal** or **job-margin visibility** — out.
- If it requires a phone app — out.

---

## 7. Recommended Tech Stack

Optimized for a small team shipping a multi-tenant SaaS in months, not years.

### Core
- **Frontend & API**: Next.js 15 (App Router) + React Server Components + TypeScript
- **Styling / UI**: Tailwind CSS + shadcn/ui + Radix primitives
- **Forms / validation**: React Hook Form + Zod (shared types client/server)
- **Data layer**: Drizzle ORM on PostgreSQL (lighter and more SQL-native than Prisma; first-class RLS)
- **Database**: PostgreSQL on Neon or Supabase (managed, branchable, point-in-time restore)
- **Auth**: Clerk *or* Supabase Auth — both give MFA, invites, and SSO without building it. Pick Supabase if you also want it to host the DB and storage; Clerk if you want best-in-class auth UX and don't mind a separate vendor.
- **File storage**: Cloudflare R2 (no egress fees) or Supabase Storage if already on Supabase
- **PDF generation**: `@react-pdf/renderer` for templated docs (proposals, POs, COs); fall back to a headless Chromium worker for anything HTML-heavy
- **Background jobs**: Inngest (durable, easy retries, good for emails, PDF render, webhooks)
- **Email**: Resend or Postmark (transactional + customer-facing proposal/CO sends)
- **Search**: Postgres full-text for V1; revisit Typesense if needed
- **Hosting**: Vercel for the app; Neon/Supabase for DB; R2 for files
- **Observability**: Sentry (errors), PostHog (product analytics + session replay), Axiom or Better Stack (logs)
- **Payments / billing**: Stripe Billing for the SaaS subscription itself
- **CI**: GitHub Actions; preview deploys per PR

### Architecture choices worth calling out
- **Multi-tenancy** via `company_id` on every row + Postgres RLS. Application code asserts the active `company_id` from the session into a Postgres GUC; RLS policies do the rest.
- **Money** as `numeric(14,2)` everywhere. Never floats. A `Money` type wrapper on the TS side.
- **Soft deletes** on customer/project/vendor (deleted_at), hard delete on draft estimates/proposals.
- **Immutable snapshots** for sent estimates, proposals, POs, COs — once sent, edits create a new version.
- **Event sourcing for finance-affecting changes**: write through an `audit_log` and let derived views recompute project financials. Avoids a brittle "running totals" column getting out of sync.
- **Cost-code library is the spine** — every line item, PO line, CO line, and cost entry rolls up by cost code. Get this model right before anything else.

### Why not…
- **Rails / Django**: fine choices, but TS end-to-end with Drizzle gives shared schemas and faster iteration.
- **GraphQL**: not worth the overhead for V1; tRPC or Server Actions cover it.
- **Microservices**: a hard no at this scale.
- **NoSQL**: this is relational, money-precise, and reporting-heavy. Postgres.

---

## 8. Future Integrations

Sequence after V1 ships, ordered by customer-pull and difficulty.

### Tier 1 — V1.1 / V1.2 (drives retention)
- **QuickBooks Online**: customers, vendors, items, bills, invoices, COA. Two-way sync where safe; one-way (push from us) for invoices and bills. OAuth + Intuit's REST API.
- **Xero**: same model as QBO, second priority.
- **CSV export everywhere**: estimates, POs, COs, job costs — for users on accounting tools we don't yet support.
- **DocuSign / Dropbox Sign**: replace typed-signature flow on proposals and COs.
- **Stripe**: collect deposits and milestone payments tied to a project.

### Tier 2 — V2 (workflow expansion)
- **Gusto / ADP / Rippling**: pull labor cost from payroll runs and post to job-cost entries by employee.
- **CompanyCam**: photo sync per project (huge for roofing).
- **EagleView / Hover / Roofr**: import roof measurements directly into an estimate.
- **Google Calendar / Outlook**: project milestones and crew schedules.
- **Twilio**: SMS notifications for proposal/CO sends, vendor PO acknowledgments.

### Tier 3 — V2.5+ (specialty)
- **Avalara / TaxJar**: sales tax rates by jurisdiction (relevant in some states).
- **Procore / Buildertrend**: data import for customers migrating in.
- **Modern Treasury / Mercury**: ACH disbursement to vendors and subs.
- **Plaid**: bank feed for matching transactions to job costs (only if not using QBO).
- **Salesforce / HubSpot**: lead-to-project sync for larger contractors with separate CRM.

### Integration design principles
- Every integration is **opt-in per company** and configurable per object (e.g. sync customers but not invoices).
- All sync is **idempotent and audited** — every external write goes through a queue with retries and a per-record sync log.
- We never become the **system of record for the GL** — accounting tools own that. KrakenOps Pro owns the job-level financial truth and pushes summaries.
- Webhooks from us → customer endpoints from day one (V1.1) so power users can build their own automations.

---

## Open questions worth answering before kickoff
1. **Pricing model** — per company, per user, per active project? Affects the data model only slightly but pricing experiments are easier if seats are tracked from day one.
2. **Single company per user in MVP, or multi-company from the start?** Multi-company is one extra screen but doubles the auth surface.
3. **Roofing-first vs. GC-first onboarding wizard** — if roofing is the wedge, the cost-code defaults and assemblies should ship roofing-flavored.
4. **Design partners** — who are the 2–3 contractors who'll use the beta? Their workflows should drive Phase 1–4 details.
5. **Hosting region & data residency** — US-only for V1 is the obvious answer, but worth confirming before signing infra contracts.
