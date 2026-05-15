import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate, canView } from '@/lib/permissions';
import { getDb, isDatabaseConfigured } from '@/db';
import { jobCostEntries } from '@/db/schema';
import { getReceipt, listReceiptAttachments } from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { ReceiptForm } from '@/modules/receipts/components/receipt-form';
import { ReceiptAttachmentUploader } from '@/modules/receipts/components/attachment-uploader';
import {
  AttachmentsList,
  type AttachmentRow,
} from '@/modules/receipts/components/attachments-list';
import { ReceiptPostPanel } from '@/modules/receipts/components/post-panel';
import { createSignedReceiptUrl } from '@/lib/storage/receipt-files';
import { toMoneyString } from '@/lib/money';

export const dynamic = 'force-dynamic';

// Best-effort duplicate-vs-PO-receipt check. Returns a warning string when
// the receipt's (project, vendor, amount, date) match an existing
// job_cost_entries row from source='po_receipt'. The match is informational
// only — the post action confirms with the operator before proceeding.
async function checkDuplicatePoReceipt(
  companyId: string,
  receipt: {
    projectId: string | null;
    vendorId: string | null;
    total: string;
    subtotal: string;
    receiptDate: string;
  },
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  if (!receipt.projectId || !receipt.vendorId) return null;
  const db = getDb()!;
  const amountKeys = [
    toMoneyString(Number(receipt.total)),
    toMoneyString(Number(receipt.subtotal)),
  ];
  for (const amt of amountKeys) {
    const rows = await db
      .select({ id: jobCostEntries.id })
      .from(jobCostEntries)
      .where(
        and(
          eq(jobCostEntries.companyId, companyId),
          eq(jobCostEntries.projectId, receipt.projectId),
          eq(jobCostEntries.vendorId, receipt.vendorId),
          eq(jobCostEntries.entryDate, receipt.receiptDate),
          eq(jobCostEntries.amount, amt),
          eq(jobCostEntries.source, 'po_receipt'),
          isNull(jobCostEntries.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      return `An existing job-cost entry from a PO receipt matches this project, vendor, amount, and date. Posting could double-count.`;
    }
  }
  return null;
}

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const role = await getActiveRole();
  if (!canView(role, 'receipts')) {
    redirect('/banking/receipts' as never);
  }
  const company = await getActiveCompany();
  const { id } = await params;
  const receipt = await getReceipt(company.id, id);
  if (!receipt) notFound();

  const [
    attachments,
    vendors,
    projects,
    costCodes,
    accountingAccounts,
    bankAccounts,
    dupWarning,
  ] = await Promise.all([
    listReceiptAttachments(company.id, receipt.id),
    listVendors(company.id),
    listProjects(company.id),
    listCostCodes(company.id),
    listAccountingAccounts(company.id),
    listBankAccounts(company.id),
    checkDuplicatePoReceipt(company.id, {
      projectId: receipt.projectId,
      vendorId: receipt.vendorId,
      total: receipt.total,
      subtotal: receipt.subtotal,
      receiptDate: receipt.receiptDate,
    }),
  ]);

  // Sign URLs for thumbnails.
  const attachmentRows: AttachmentRow[] = await Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      uploadedAt: a.uploadedAt.toISOString().slice(0, 10),
      signedUrl: await createSignedReceiptUrl(a.storagePath),
      kind: a.kind,
    })),
  );

  const canEdit = canCreate(role, 'receipts');
  // Field user can upload but not post/unpost/void/delete. The post panel
  // gates its own buttons on canPost.
  const canPost = canCreate(role, 'receipts') && role !== 'field_user';
  const canPostable = Boolean(receipt.projectId && receipt.costCodeId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking/receipts' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Receipts
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">
          Receipt — {receipt.receiptDate}
        </h1>
        <p className="text-sm text-slate-500">
          {receipt.status === 'posted'
            ? 'Posted to job costs. Unpost to edit any field.'
            : receipt.status === 'void'
              ? 'Void receipt.'
              : 'Draft. Attach a photo and Post when ready.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {receipt.status === 'posted' ? 'Details (locked)' : 'Edit'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptForm
                initial={{
                  id: receipt.id,
                  receiptDate: receipt.receiptDate,
                  vendorId: receipt.vendorId,
                  projectId: receipt.projectId,
                  costCodeId: receipt.costCodeId,
                  accountingAccountId: receipt.accountingAccountId,
                  bankAccountId: receipt.bankAccountId,
                  paymentSourceType: receipt.paymentSourceType,
                  currency: receipt.currency,
                  subtotal: Number(receipt.subtotal),
                  vatAmount: Number(receipt.vatAmount),
                  total: Number(receipt.total),
                  vatRatePercent:
                    receipt.vatRatePercent === null
                      ? null
                      : Number(receipt.vatRatePercent),
                  vatIncluded: receipt.vatIncluded,
                  vatRecoverable: receipt.vatRecoverable,
                  vendorTin: receipt.vendorTin,
                  costType: receipt.costType,
                  isBillable: receipt.isBillable,
                  isReimbursable: receipt.isReimbursable,
                  notes: receipt.notes,
                }}
                vatActive={company.isVatActive}
                defaultCurrency={company.defaultCurrency}
                defaultVatRate={Number(company.vatRatePercent) || 0}
                vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
                projects={projects.map((p) => ({
                  id: p.id,
                  label: `${p.number} — ${p.name}`,
                }))}
                costCodes={costCodes.map((c) => ({
                  id: c.id,
                  label: `${c.code} — ${c.description}`,
                }))}
                accountingAccounts={accountingAccounts
                  .filter((a) => !a.isArchived)
                  .map((a) => ({
                    id: a.id,
                    label: a.code ? `${a.code} — ${a.name}` : a.name,
                  }))}
                bankAccounts={bankAccounts.map((b) => ({
                  id: b.id,
                  label: `${b.name} (${b.type === 'credit_card' ? 'CC' : 'Bank'})`,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && receipt.status !== 'posted' && (
                <ReceiptAttachmentUploader receiptId={receipt.id} />
              )}
              <AttachmentsList
                receiptId={receipt.id}
                attachments={attachmentRows}
                canEdit={canEdit && receipt.status !== 'posted'}
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptPostPanel
                receiptId={receipt.id}
                status={receipt.status}
                canPostable={canPostable}
                hasPotentialDuplicate={Boolean(dupWarning)}
                potentialDuplicateMessage={dupWarning ?? undefined}
                canPost={canPost}
              />
              {receipt.status === 'posted' && receipt.postedJobCostEntryId && (
                <p className="mt-3 text-[11px] text-slate-500">
                  Job cost entry id:{' '}
                  <span className="font-mono">
                    {receipt.postedJobCostEntryId.slice(0, 8)}…
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
