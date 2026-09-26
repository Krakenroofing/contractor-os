// Dashboard work queues (roadmap P8): how much is waiting on the office in
// each queue, in one round trip. Each count links to the page that works it.

import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';

export type WorkQueueCounts = {
  openRequests: number;
  urgentRequests: number;
  billsToApprove: number;
  parkedBills: number;
  parkedOver30: number;
  paymentBlocked: number;
  posToApprove: number;
  posToReceive: number;
  bankToReview: number;
  controlExceptions: number;
  receivedNotBilled: number;
};

export async function getWorkQueueCounts(
  companyId: string,
  poApprovalLimit: string | null,
): Promise<WorkQueueCounts | null> {
  if (!isDatabaseConfigured()) return null;
  const limit = poApprovalLimit === null ? null : Number(poApprovalLimit);
  const rows = await getDb()!.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM team_tasks
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'open')::int AS open_requests,
      (SELECT COUNT(*) FROM team_tasks
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'open'
          AND priority IN ('urgent', 'high'))::int AS urgent_requests,
      (SELECT COUNT(*) FROM receipts
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'submitted')::int AS bills_to_approve,
      (SELECT COUNT(*) FROM receipts
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status IN ('draft', 'submitted'))::int AS parked,
      (SELECT COUNT(*) FROM receipts
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status IN ('draft', 'submitted')
          AND created_at < now() - interval '30 days')::int AS parked_over_30,
      (SELECT COUNT(*) FROM receipts
        WHERE company_id = ${companyId} AND deleted_at IS NULL AND status = 'posted'
          AND payment_blocked)::int AS payment_blocked,
      (SELECT COUNT(*) FROM purchase_orders
        WHERE company_id = ${companyId} AND status = 'draft'
          AND ${limit}::numeric IS NOT NULL AND total > ${limit}::numeric
          AND (approved_at IS NULL OR COALESCE(approved_total, 0) < total))::int AS pos_to_approve,
      (SELECT COUNT(*) FROM purchase_orders
        WHERE company_id = ${companyId} AND status IN ('issued', 'partially_received'))::int AS pos_to_receive,
      (SELECT COUNT(*) FROM imported_transactions t
        WHERE t.company_id = ${companyId} AND NOT t.is_ignored AND NOT t.is_reviewed
          AND t.reconciled_at IS NULL)::int AS bank_to_review,
      (SELECT COUNT(*) FROM control_exceptions
        WHERE company_id = ${companyId} AND reviewed_at IS NULL)::int AS control_exceptions,
      (SELECT COUNT(*) FROM (
         SELECT pl.id
           FROM purchase_orders po
           JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id
           JOIN po_receipt_lines rl ON rl.po_line_id = pl.id
          WHERE po.company_id = ${companyId} AND po.grir
          GROUP BY pl.id
         HAVING SUM(rl.quantity_received) > COALESCE((
           SELECT SUM(l.quantity) FROM receipt_lines l JOIN receipts b ON b.id = l.receipt_id
            WHERE l.purchase_order_line_id = pl.id AND b.status = 'posted'
              AND b.deleted_at IS NULL AND l.deleted_at IS NULL), 0)
       ) x)::int AS received_not_billed
  `);
  const r = (rows as unknown as Array<Record<string, number>>)[0];
  return {
    openRequests: r.open_requests,
    urgentRequests: r.urgent_requests,
    billsToApprove: r.bills_to_approve,
    parkedBills: r.parked,
    parkedOver30: r.parked_over_30,
    paymentBlocked: r.payment_blocked,
    posToApprove: r.pos_to_approve,
    posToReceive: r.pos_to_receive,
    bankToReview: r.bank_to_review,
    controlExceptions: r.control_exceptions,
    receivedNotBilled: r.received_not_billed,
  };
}
