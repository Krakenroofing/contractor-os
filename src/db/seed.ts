// Demo-data seed script for the database.
//
// Reads the canonical demo seed from the in-memory mock store and inserts the
// rows into Postgres via Drizzle. Idempotent: each `.onConflictDoNothing()`
// makes re-running the script safe.
//
// Coverage by phase:
//   foundation phase  — companies, users, customers, projects, vendors
//   financial phase   — cost code libraries + cost codes, estimates (+ lines),
//                       proposals, change orders (+ lines), purchase orders
//                       (+ lines), landed costs
//   money phase       — invoice templates, invoices (+ lines), payments,
//                       retainage releases (AR + retainage tracking are
//                       derived live from these tables, no separate seed)
//
// Run:
//   npm run db:seed
//
// Requires DATABASE_URL to be set. Schema must already be applied — run
// `npm run db:push` first to sync the Drizzle schema to your Supabase database.

import 'dotenv/config';
import { requireDb } from '@/db';
import {
  changeOrderLineItems,
  changeOrders,
  companies,
  costCodeLibraries,
  costCodes,
  customers,
  estimateLineItems,
  estimates,
  invoiceLineItems,
  invoicePayments,
  invoices,
  invoiceTemplates,
  landedCosts,
  memberships,
  projects,
  proposals,
  purchaseOrderLines,
  purchaseOrders,
  retainageReleases,
  users,
  vendors,
} from '@/db/schema';
import {
  KRAKEN_ID,
  TRB_ID,
  KRAKEN_LIBRARY_ID,
  TRB_LIBRARY_ID,
  GLOBAL_COST_CODE_LIBRARY_ID,
  // Foundation
  listMockCompanies,
  listMockCustomers,
  listMockProjects,
  listMockVendors,
  // Financial — direct in-memory readers (do NOT use the data layer here, as
  // it would dispatch to the empty DB during the seed)
  listMockCostCodes,
  listMockGlobalCostCodes,
  listMockEstimates,
  getMockEstimateLineItems,
  listMockProposals,
  listMockChangeOrders,
  getMockChangeOrderLineItems,
  listMockPurchaseOrders,
  getMockPurchaseOrderLines,
  listMockLandedCosts,
  // Money lifecycle — also direct in-memory readers
  listMockInvoiceTemplates,
  listMockInvoices,
  getMockInvoiceLineItems,
  getMockInvoicePayments,
  listMockRetainageReleases,
} from '@/lib/mock-store';

async function main() {
  const db = requireDb();

  // ===== Foundation =====

  console.log('→ Seeding companies…');
  const allCompanies = listMockCompanies();
  if (allCompanies.length > 0) {
    await db.insert(companies).values(allCompanies).onConflictDoNothing();
  }
  console.log(`  ${allCompanies.length} company row(s)`);

  console.log('→ Seeding users (placeholder demo accounts)…');
  // Stable UUIDs so memberships can reference these rows on re-run. When you
  // wire up real Supabase Auth, replace these with the auth.users.id values
  // for your real owners (or leave them and add fresh user rows alongside).
  const KRAKEN_OWNER_ID = '00000000-0000-0000-0000-0000000000aa';
  const TRB_OWNER_ID = '00000000-0000-0000-0000-0000000000ab';
  await db
    .insert(users)
    .values([
      {
        id: KRAKEN_OWNER_ID,
        email: 'owner@krakenroofing.example',
        name: 'Kraken Owner',
        phone: '(242) 555-0100',
      },
      {
        id: TRB_OWNER_ID,
        email: 'owner@trbltd.example',
        name: 'TRB Owner',
        phone: '(242) 555-0200',
      },
    ])
    .onConflictDoNothing();

  console.log('→ Seeding memberships…');
  await db
    .insert(memberships)
    .values([
      {
        companyId: KRAKEN_ID,
        userId: KRAKEN_OWNER_ID,
        role: 'owner',
        status: 'active',
      },
      {
        companyId: TRB_ID,
        userId: TRB_OWNER_ID,
        role: 'owner',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  console.log('→ Seeding customers…');
  const allCustomers = [
    ...listMockCustomers(KRAKEN_ID),
    ...listMockCustomers(TRB_ID),
  ];
  if (allCustomers.length > 0) {
    await db.insert(customers).values(allCustomers).onConflictDoNothing();
  }
  console.log(`  ${allCustomers.length} customer row(s)`);

  console.log('→ Seeding projects…');
  const allProjects = [
    ...listMockProjects(KRAKEN_ID),
    ...listMockProjects(TRB_ID),
  ];
  if (allProjects.length > 0) {
    await db.insert(projects).values(allProjects).onConflictDoNothing();
  }
  console.log(`  ${allProjects.length} project row(s)`);

  console.log('→ Seeding vendors…');
  const allVendors = [
    ...listMockVendors(KRAKEN_ID),
    ...listMockVendors(TRB_ID),
  ];
  if (allVendors.length > 0) {
    await db.insert(vendors).values(allVendors).onConflictDoNothing();
  }
  console.log(`  ${allVendors.length} vendor row(s)`);

  // ===== Financial =====

  console.log('→ Seeding cost code libraries…');
  await db
    .insert(costCodeLibraries)
    .values([
      {
        id: KRAKEN_LIBRARY_ID,
        companyId: KRAKEN_ID,
        name: 'Kraken Roofing — Standard',
        isGlobal: false,
      },
      {
        id: TRB_LIBRARY_ID,
        companyId: TRB_ID,
        name: 'TRB Ltd. — Standard',
        isGlobal: false,
      },
      {
        id: GLOBAL_COST_CODE_LIBRARY_ID,
        companyId: null,
        name: 'Standard Contractor Library',
        isGlobal: true,
      },
    ])
    .onConflictDoNothing();

  console.log('→ Seeding cost codes…');
  // Each company's own codes go into its library; global codes go into the
  // shared library exactly once. The unique index (library_id, code) makes
  // re-runs safe regardless.
  const allCostCodes = [
    ...listMockCostCodes(KRAKEN_ID),
    ...listMockCostCodes(TRB_ID),
    ...listMockGlobalCostCodes(),
  ];
  if (allCostCodes.length > 0) {
    await db.insert(costCodes).values(allCostCodes).onConflictDoNothing();
  }
  console.log(`  ${allCostCodes.length} cost code row(s)`);

  console.log('→ Seeding estimates + line items…');
  const allEstimates = [
    ...listMockEstimates(KRAKEN_ID),
    ...listMockEstimates(TRB_ID),
  ];
  if (allEstimates.length > 0) {
    await db.insert(estimates).values(allEstimates).onConflictDoNothing();
    const allEstimateLines = allEstimates.flatMap((e) =>
      getMockEstimateLineItems(e.id),
    );
    if (allEstimateLines.length > 0) {
      await db
        .insert(estimateLineItems)
        .values(allEstimateLines)
        .onConflictDoNothing();
    }
    console.log(
      `  ${allEstimates.length} estimate row(s) + ${allEstimateLines.length} line item(s)`,
    );
  }

  console.log('→ Seeding proposals…');
  const allProposals = [
    ...listMockProposals(KRAKEN_ID),
    ...listMockProposals(TRB_ID),
  ];
  if (allProposals.length > 0) {
    await db.insert(proposals).values(allProposals).onConflictDoNothing();
  }
  console.log(`  ${allProposals.length} proposal row(s)`);

  console.log('→ Seeding change orders + line items…');
  const allChangeOrders = [
    ...listMockChangeOrders(KRAKEN_ID),
    ...listMockChangeOrders(TRB_ID),
  ];
  if (allChangeOrders.length > 0) {
    await db.insert(changeOrders).values(allChangeOrders).onConflictDoNothing();
    const allCOLines = allChangeOrders.flatMap((co) =>
      getMockChangeOrderLineItems(co.id),
    );
    if (allCOLines.length > 0) {
      await db
        .insert(changeOrderLineItems)
        .values(allCOLines)
        .onConflictDoNothing();
    }
    console.log(
      `  ${allChangeOrders.length} change order row(s) + ${allCOLines.length} line item(s)`,
    );
  }

  console.log('→ Seeding landed costs…');
  // Insert landed costs BEFORE purchase orders, because the demo seed has POs
  // referencing landed cost rows via landedCostEntryId.
  const allLandedCosts = [
    ...listMockLandedCosts(KRAKEN_ID),
    ...listMockLandedCosts(TRB_ID),
  ];
  if (allLandedCosts.length > 0) {
    await db.insert(landedCosts).values(allLandedCosts).onConflictDoNothing();
  }
  console.log(`  ${allLandedCosts.length} landed cost row(s)`);

  console.log('→ Seeding purchase orders + line items…');
  const allPOs = [
    ...listMockPurchaseOrders(KRAKEN_ID),
    ...listMockPurchaseOrders(TRB_ID),
  ];
  if (allPOs.length > 0) {
    await db.insert(purchaseOrders).values(allPOs).onConflictDoNothing();
    const allPOLines = allPOs.flatMap((po) => getMockPurchaseOrderLines(po.id));
    if (allPOLines.length > 0) {
      await db
        .insert(purchaseOrderLines)
        .values(allPOLines)
        .onConflictDoNothing();
    }
    console.log(
      `  ${allPOs.length} purchase order row(s) + ${allPOLines.length} line item(s)`,
    );
  }

  // ===== Money lifecycle =====

  console.log('→ Seeding invoice templates…');
  const allInvoiceTemplates = [
    ...listMockInvoiceTemplates(KRAKEN_ID),
    ...listMockInvoiceTemplates(TRB_ID),
  ];
  if (allInvoiceTemplates.length > 0) {
    await db
      .insert(invoiceTemplates)
      .values(allInvoiceTemplates)
      .onConflictDoNothing();
  }
  console.log(`  ${allInvoiceTemplates.length} invoice template row(s)`);

  console.log('→ Seeding invoices + line items + payments…');
  const allInvoices = [
    ...listMockInvoices(KRAKEN_ID),
    ...listMockInvoices(TRB_ID),
  ];
  if (allInvoices.length > 0) {
    await db.insert(invoices).values(allInvoices).onConflictDoNothing();
    const allInvoiceLines = allInvoices.flatMap((i) =>
      getMockInvoiceLineItems(i.id),
    );
    if (allInvoiceLines.length > 0) {
      await db
        .insert(invoiceLineItems)
        .values(allInvoiceLines)
        .onConflictDoNothing();
    }
    const allPayments = allInvoices.flatMap((i) => getMockInvoicePayments(i.id));
    if (allPayments.length > 0) {
      await db
        .insert(invoicePayments)
        .values(allPayments)
        .onConflictDoNothing();
    }
    console.log(
      `  ${allInvoices.length} invoice row(s) + ${allInvoiceLines.length} line item(s) + ${allPayments.length} payment row(s)`,
    );
  }

  console.log('→ Seeding retainage releases…');
  const allRetainageReleases = [
    ...listMockRetainageReleases(KRAKEN_ID),
    ...listMockRetainageReleases(TRB_ID),
  ];
  if (allRetainageReleases.length > 0) {
    await db
      .insert(retainageReleases)
      .values(allRetainageReleases)
      .onConflictDoNothing();
  }
  console.log(`  ${allRetainageReleases.length} retainage release row(s)`);

  console.log('\n✓ Seed complete.');
  console.log(
    '  Tip: re-running this script is safe — every insert uses .onConflictDoNothing().',
  );
  console.log(
    '  AR aging and retainage tracking views are derived live — no separate seed.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
