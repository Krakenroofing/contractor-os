import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canApproveReceipt, canCreate, canView } from '@/lib/permissions';
import { getDb, isDatabaseConfigured } from '@/db';
import { jobCostEntries } from '@/db/schema';
import {
  getReceipt,
  listReceiptAttachments,
  listReceiptLines,
} from '@/lib/data/receipts';
import { listVendors } from '@/lib/data/vendors';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { getUserNamesByIds } from '@/lib/data/users';
import { listMembersForCompany } from '@/lib/data/memberships';
import { requireAuth } from '@/lib/auth';
import {
  ReceiptForm,
  type LineInitial,
} from '@/modules/receipts/components/receipt-form';
import { ReceiptAttachmentUploader } from '@/modules/receipts/components/attachment-uploader';
import {
  AttachmentsList,
  type AttachmentRow,
} from '@/modules/receipts/components/attachments-list';
import { ReceiptPostPanel } from '@/modules/receipts/components/post-panel';
import { createSignedReceiptUrl } from '@/lib/storage/receipt-files';
import { toMoneyString } from '@/lib/money';

export const dynamic = 'force-dynamic';

// Best-effort duplicate-vs-PO-receipt check. Returns a warning when the
// receipt's (vendor, amount, date) match an existing job_cost_entries row
// from source='po_receipt'. With multi-line receipts we no longer match on
// projectId — vendor + date + total is enough for an informational warn.
async function checkDuplicatePoReceipt(
  companyId: string,
  receipt: {
    vendorId: string | null;
    total: string;
    subtotal: string;
    receiptDate: string;
  },
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  if (!receipt.vendorId) return null;
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
          eq(jobCostEntries.vendorId, receipt.vendorId),
          eq(jobCostEntries.entryDate, receipt.receiptDate),
          eq(jobCostEntries.amount, amt),
          eq(jobCostEntries.source, 'po_receipt'),
          isNull(jobCostEntries.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      return `An existing job-cost entry from a PO receipt matches this vendor, amount, and date. Posting could double-count.`;
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

  const currentUser = await requireAuth();
  const [
    lines,
    attachments,
    vendors,
    projects,
    costCodes,
    accountingAccounts,
    bankAccounts,
    members,
    dupWarning,
  ] = await Promise.all([
    listReceiptLines(company.id, receipt.id),
    listReceiptAttachments(company.id, receipt.id),
    listVendors(company.id),
    listProjects(company.id),
    listCostCodes(company.id),
    listAccountingAccounts(company.id),
    listBankAccounts(company.id),
    listMembersForCompany(company.id),
    checkDuplicatePoReceipt(company.id, {
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
  const canSubmit = canCreate(role, 'receipts');
  const canApprove = canApproveReceipt(role);
  // Postable = at least one line, every line has project + cost code.
  const canPostable =
    lines.length > 0 && lines.every((l) => l.projectId && l.costCodeId);

  // Look up names for the audit fields shown in the post panel.
  const userIds = [
    receipt.submittedByUserId,
    receipt.approvedByUserId,
  ].filter((id): id is string => Boolean(id));
  const userNames = await getUserNamesByIds(userIds);

  const initialLines: LineInitial[] = lines.map((l) => ({
    id: l.id,
    projectId: l.projectId,
    costCodeId: l.costCodeId,
    accountingAccountId: l.accountingAccountId,
    costType: l.costType,
    description: l.description,
    subtotal: Number(l.subtotal),
    vatAmount: Number(l.vatAmount),
    total: Number(l.total),
    vatRatePercent:
      l.vatRatePercent === null ? null : Number(l.vatRatePercent),
    isBillable: l.isBillable,
    isReimbursable: l.isReimbursable,
    paidByUserId: l.paidByUserId,
    reimbursementPayoutId: l.reimbursementPayoutId,
  }));

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
              : receipt.status === 'submitted'
                ? 'Submitted for review. Waiting for an approver.'
                : 'Draft. Attach a photo and Submit / Post when ready.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {receipt.status === 'posted' || receipt.status === 'submitted'
                  ? 'Details (locked)'
                  : 'Edit'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptForm
                initial={{
                  id: receipt.id,
                  receiptDate: receipt.receiptDate,
                  vendorId: receipt.vendorId,
                  bankAccountId: receipt.bankAccountId,
                  paymentSourceType: receipt.paymentSourceType,
                  currency: receipt.currency,
                  vatRatePercent:
                    receipt.vatRatePercent === null
                      ? null
                      : Number(receipt.vatRatePercent),
                  vatIncluded: receipt.vatIncluded,
                  vatRecoverable: receipt.vatRecoverable,
                  vendorTin: receipt.vendorTin,
                  notes: receipt.notes,
                }}
                initialLines={initialLines}
                vatActive={company.isVatActive}
                defaultCurrency={company.defaultCurrency}
                defaultVatRate={Number(company.vatRatePercent) || 0}
                vendors={vendors.map((v) => ({
                  id: v.id,
                  label: v.name,
                  defaultCostCodeId: v.defaultCostCodeId ?? '',
                  defaultCostType: v.defaultCostType ?? '',
                  defaultAccountingAccountId: v.defaultAccountingAccountId ?? '',
                }))}
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
                members={members.map((m) => ({ id: m.userId, label: m.name }))}
                currentUserId={currentUser.id}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && receipt.status === 'draft' && (
                <ReceiptAttachmentUploader receiptId={receipt.id} />
              )}
              <AttachmentsList
                receiptId={receipt.id}
                attachments={attachmentRows}
                canEdit={canEdit && receipt.status === 'draft'}
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
                canApprove={canApprove}
                canSubmit={canSubmit}
                submittedAt={
                  receipt.submittedAt
                    ? receipt.submittedAt.toISOString().slice(0, 10)
                    : undefined
                }
                submittedByName={
                  receipt.submittedByUserId
                    ? userNames.get(receipt.submittedByUserId)
                    : undefined
                }
                approvedAt={
                  receipt.approvedAt
                    ? receipt.approvedAt.toISOString().slice(0, 10)
                    : undefined
                }
                approvedByName={
                  receipt.approvedByUserId
                    ? userNames.get(receipt.approvedByUserId)
                    : undefined
                }
                rejectionReason={receipt.rejectionReason ?? undefined}
              />
              {receipt.status === 'posted' && lines.length > 0 && (
                <p className="mt-3 text-[11px] text-slate-500">
                  {lines.length === 1
                    ? 'Posted to 1 job cost entry.'
                    : `Posted to ${lines.length} job cost entries.`}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
