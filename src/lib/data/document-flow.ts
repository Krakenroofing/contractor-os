// Document flow (roadmap P5): the chain of documents around one document,
// SAP-style —
//   supply side:   Estimate › Contract › PO › Goods receipt › Bill › Payment › Bank line
//   customer side: Estimate › Contract › (CO) › Invoice › Credit memo / Payment › Bank line
// Each builder walks from the anchor up to its contract and down to what
// settled it. Read-only; every query is scoped to the company.

import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';

export type FlowKind =
  | 'estimate'
  | 'contract'
  | 'change_order'
  | 'purchase_order'
  | 'goods_receipt'
  | 'bill'
  | 'vendor_credit'
  | 'bill_payment'
  | 'invoice'
  | 'credit_memo'
  | 'customer_payment'
  | 'refund'
  | 'bank_line';

export type FlowNode = {
  kind: FlowKind;
  id: string;
  label: string;
  status?: string | null;
  date?: string | null;
  amount?: number | null;
  href?: string | null;
  current?: boolean;
  children: FlowNode[];
};

export type FlowAnchor =
  | { type: 'invoice'; id: string }
  | { type: 'bill'; id: string }
  | { type: 'purchase_order'; id: string }
  | { type: 'credit_memo'; id: string }
  | { type: 'change_order'; id: string }
  | { type: 'estimate'; id: string };

type R = Record<string, unknown>;
const LIMIT = 60;

async function q(query: SQL): Promise<R[]> {
  return (await getDb()!.execute(query)) as unknown as R[];
}
const d = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const n = (v: unknown): number | null => (v == null ? null : Number(v));
const s = (v: unknown): string => String(v ?? '');

// ---------- leaf loaders ----------

function bankLineNode(r: R, kind: FlowKind = 'bank_line'): FlowNode {
  return {
    kind,
    id: s(r.txn_id),
    label: `${s(r.bank_name) || 'Bank'} · ${s(r.description).slice(0, 60)}`,
    date: d(r.transaction_date),
    amount: n(r.txn_amount),
    status: r.reconciled_at ? 'reconciled' : 'matched',
    href: `/banking/accounts/${s(r.bank_account_id)}?txn=${s(r.txn_id)}`,
    children: [],
  };
}

async function billPaymentNodes(
  companyId: string,
  billId: string,
  billTotal: number,
): Promise<FlowNode[]> {
  const rows = await q(sql`
    SELECT t.id AS txn_id, t.bank_account_id, t.transaction_date, t.description,
           m.matched_amount, t.amount AS txn_amount, t.reconciled_at,
           b.name AS bank_name
      FROM transaction_matches m
      JOIN imported_transactions t ON t.id = m.imported_transaction_id
      LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
     WHERE m.company_id = ${companyId} AND m.receipt_id = ${billId}
       AND m.reversed_at IS NULL
     ORDER BY t.transaction_date LIMIT ${LIMIT}`);
  return rows.map((r) => {
    const node = bankLineNode(r, 'bill_payment');
    // A batch withdrawal pays several bills: show this bill's share.
    const share = r.matched_amount != null ? Number(r.matched_amount) : billTotal;
    const whole = Math.abs(Number(r.txn_amount));
    if (Math.abs(whole - Math.abs(share)) > 0.005) {
      node.label += ` (part of ${whole.toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`;
    }
    node.amount = share;
    return node;
  });
}

async function vendorCreditNodes(companyId: string, billId: string): Promise<FlowNode[]> {
  const rows = await q(sql`
    SELECT a.id, a.amount, c.credit_date, c.reference, c.id AS credit_id
      FROM vendor_credit_applications a
      JOIN vendor_credits c ON c.id = a.credit_id
     WHERE a.company_id = ${companyId} AND a.receipt_id = ${billId}
       AND c.deleted_at IS NULL
     LIMIT ${LIMIT}`);
  return rows.map((r) => ({
    kind: 'vendor_credit' as const,
    id: s(r.id),
    label: `Vendor credit${r.reference ? ` ${s(r.reference)}` : ''}`,
    date: d(r.credit_date),
    amount: n(r.amount),
    href: null,
    children: [],
  }));
}

async function billNode(companyId: string, r: R, currentId?: string): Promise<FlowNode> {
  const id = s(r.id);
  return {
    kind: 'bill',
    id,
    label: `Bill${r.vendor_invoice_number ? ` #${s(r.vendor_invoice_number)}` : ''}${r.vendor_name ? ` · ${s(r.vendor_name)}` : ''}`,
    status: r.payment_blocked ? `${s(r.status)} · payment blocked` : s(r.status),
    date: d(r.receipt_date),
    amount: n(r.total),
    href: `/banking/receipts/${id}`,
    current: id === currentId,
    children: [
      ...(await vendorCreditNodes(companyId, id)),
      ...(await billPaymentNodes(companyId, id, Number(r.total))),
    ],
  };
}

const BILL_COLS = sql`r.id, r.vendor_invoice_number, r.status, r.receipt_date, r.total,
  r.payment_blocked, v.name AS vendor_name`;

async function customerPaymentNodes(companyId: string, invoiceId: string): Promise<FlowNode[]> {
  const rows = await q(sql`
    SELECT p.id, p.payment_number, p.paid_date, p.amount, p.status,
           t.id AS txn_id, t.bank_account_id, t.transaction_date, t.description,
           t.amount AS txn_amount, t.reconciled_at, b.name AS bank_name
      FROM invoice_payments p
      LEFT JOIN transaction_matches m
        ON m.invoice_payment_id = p.id AND m.reversed_at IS NULL
      LEFT JOIN imported_transactions t
        ON t.id = COALESCE(m.imported_transaction_id, p.imported_transaction_id)
      LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
     WHERE p.invoice_id = ${invoiceId}
       AND (m.id IS NULL OR m.company_id = ${companyId})
     ORDER BY p.paid_date LIMIT ${LIMIT}`);
  return rows.map((r) => ({
    kind: 'customer_payment' as const,
    id: s(r.id),
    label: `Payment${r.payment_number ? ` ${s(r.payment_number)}` : ''}`,
    status: s(r.status),
    date: d(r.paid_date),
    amount: n(r.amount),
    href: `/invoices/${invoiceId}`,
    children: r.txn_id ? [bankLineNode(r)] : [],
  }));
}

async function creditMemoNode(companyId: string, r: R, currentId?: string): Promise<FlowNode> {
  const id = s(r.id);
  const apps = await q(sql`
    SELECT a.id, a.kind, a.amount, a.applied_at, a.invoice_id, i.number AS invoice_number
      FROM credit_memo_applications a
      LEFT JOIN invoices i ON i.id = a.invoice_id
     WHERE a.company_id = ${companyId} AND a.credit_memo_id = ${id}
     ORDER BY a.applied_at LIMIT ${LIMIT}`);
  const refunds = await q(sql`
    SELECT t.id AS txn_id, t.bank_account_id, t.transaction_date, t.description,
           t.amount AS txn_amount, t.reconciled_at, b.name AS bank_name
      FROM transaction_matches m
      JOIN imported_transactions t ON t.id = m.imported_transaction_id
      LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
     WHERE m.company_id = ${companyId} AND m.credit_memo_id = ${id}
       AND m.reversed_at IS NULL LIMIT ${LIMIT}`);
  return {
    kind: 'credit_memo',
    id,
    label: `Credit memo ${s(r.number)}`,
    status: s(r.status),
    date: d(r.issue_date),
    amount: n(r.amount),
    href: `/credit-memos/${id}`,
    current: id === currentId,
    children: [
      ...apps.map((a) => ({
        kind: (a.kind === 'cash_refund' ? 'refund' : 'invoice') as FlowKind,
        id: s(a.id),
        label:
          a.kind === 'cash_refund'
            ? 'Cash refund'
            : `Applied to invoice ${s(a.invoice_number)}`,
        date: d(a.applied_at),
        amount: n(a.amount),
        href: a.invoice_id ? `/invoices/${s(a.invoice_id)}` : null,
        children: [],
      })),
      ...refunds.map((t) => bankLineNode(t)),
    ],
  };
}

async function invoiceNode(companyId: string, r: R, currentId?: string): Promise<FlowNode> {
  const id = s(r.id);
  const cms = await q(sql`
    SELECT DISTINCT cm.id, cm.number, cm.status, cm.issue_date, cm.amount
      FROM credit_memos cm
      LEFT JOIN credit_memo_applications a ON a.credit_memo_id = cm.id
     WHERE cm.company_id = ${companyId}
       AND (cm.invoice_id = ${id} OR a.invoice_id = ${id})
     LIMIT ${LIMIT}`);
  const cmNodes: FlowNode[] = [];
  for (const cm of cms) cmNodes.push(await creditMemoNode(companyId, cm, currentId));
  return {
    kind: 'invoice',
    id,
    label: `Invoice ${s(r.number)}`,
    status: s(r.status),
    date: d(r.invoice_date),
    amount: n(r.total),
    href: `/invoices/${id}`,
    current: id === currentId,
    children: [...(await customerPaymentNodes(companyId, id)), ...cmNodes],
  };
}

// ---------- upstream ----------

async function contractChain(
  companyId: string,
  projectId: string | null,
  inner: FlowNode[],
  currentEstimateId?: string,
): Promise<FlowNode[]> {
  if (!projectId) return inner;
  const [p] = await q(sql`
    SELECT id, name, contract_value, status FROM projects
     WHERE id = ${projectId} AND company_id = ${companyId}`);
  if (!p) return inner;
  const contract: FlowNode = {
    kind: 'contract',
    id: s(p.id),
    label: `Contract · ${s(p.name)}`,
    status: s(p.status),
    amount: n(p.contract_value),
    href: `/projects/${s(p.id)}`,
    children: inner,
  };
  const ests = await q(sql`
    SELECT id, number, status, total FROM estimates
     WHERE project_id = ${projectId} AND company_id = ${companyId}
     ORDER BY created_at LIMIT 10`);
  if (ests.length === 0) return [contract];
  // The estimate(s) precede the contract; the contract hangs off the last.
  return ests.map((e, i) => ({
    kind: 'estimate' as const,
    id: s(e.id),
    label: `Estimate ${s(e.number)}`,
    status: s(e.status),
    amount: n(e.total),
    href: `/estimates/${s(e.id)}`,
    current: s(e.id) === currentEstimateId,
    children: i === ests.length - 1 ? [contract] : [],
  }));
}

// ---------- anchors ----------

async function poSubtree(companyId: string, poId: string, currentId?: string): Promise<{ node: FlowNode; projectId: string } | null> {
  const [po] = await q(sql`
    SELECT po.id, po.number, po.status, po.issue_date, po.total, po.project_id, po.grir,
           v.name AS vendor_name
      FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
     WHERE po.id = ${poId} AND po.company_id = ${companyId}`);
  if (!po) return null;
  const grs = await q(sql`
    SELECT r.id, r.received_at,
           SUM(ROUND(rl.quantity_received * COALESCE(rl.unit_cost, pl.unit_cost), 2)) AS value,
           SUM(rl.quantity_received) AS qty
      FROM po_receipts r
      JOIN po_receipt_lines rl ON rl.receipt_id = r.id
      JOIN purchase_order_lines pl ON pl.id = rl.po_line_id
     WHERE r.purchase_order_id = ${poId}
     GROUP BY r.id, r.received_at ORDER BY r.received_at LIMIT ${LIMIT}`);
  const bills = await q(sql`
    SELECT ${BILL_COLS} FROM receipts r LEFT JOIN vendors v ON v.id = r.vendor_id
     WHERE r.company_id = ${companyId} AND r.purchase_order_id = ${poId}
       AND r.deleted_at IS NULL
     ORDER BY r.receipt_date LIMIT ${LIMIT}`);
  const billNodes: FlowNode[] = [];
  for (const b of bills) billNodes.push(await billNode(companyId, b, currentId));
  return {
    projectId: s(po.project_id),
    node: {
      kind: 'purchase_order',
      id: s(po.id),
      label: `PO ${s(po.number)}${po.vendor_name ? ` · ${s(po.vendor_name)}` : ''}${po.grir ? ' · GR/IR' : ''}`,
      status: s(po.status),
      date: d(po.issue_date),
      amount: n(po.total),
      href: `/purchase-orders/${s(po.id)}`,
      current: s(po.id) === currentId,
      children: [
        ...grs.map((g) => ({
          kind: 'goods_receipt' as const,
          id: s(g.id),
          label: `Goods receipt · ${Number(g.qty).toLocaleString('en-US', { maximumFractionDigits: 2 })} units`,
          date: d(g.received_at),
          amount: n(g.value),
          href: `/purchase-orders/${s(po.id)}`,
          children: [],
        })),
        ...billNodes,
      ],
    },
  };
}

export async function buildDocumentFlow(
  companyId: string,
  anchor: FlowAnchor,
): Promise<FlowNode[]> {
  if (!isDatabaseConfigured()) return [];

  switch (anchor.type) {
    case 'purchase_order': {
      const sub = await poSubtree(companyId, anchor.id, anchor.id);
      return sub ? contractChain(companyId, sub.projectId, [sub.node]) : [];
    }
    case 'bill': {
      const [b] = await q(sql`
        SELECT ${BILL_COLS}, r.purchase_order_id FROM receipts r
          LEFT JOIN vendors v ON v.id = r.vendor_id
         WHERE r.id = ${anchor.id} AND r.company_id = ${companyId}`);
      if (!b) return [];
      if (b.purchase_order_id) {
        const sub = await poSubtree(companyId, s(b.purchase_order_id), anchor.id);
        if (sub) return contractChain(companyId, sub.projectId, [sub.node]);
      }
      const node = await billNode(companyId, b, anchor.id);
      // A standalone bill: hang it off the job its lines charge (if one).
      const [p] = await q(sql`
        SELECT project_id FROM receipt_lines
         WHERE receipt_id = ${anchor.id} AND project_id IS NOT NULL AND deleted_at IS NULL
         GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1`);
      return contractChain(companyId, p ? s(p.project_id) : null, [node]);
    }
    case 'invoice':
    case 'credit_memo': {
      let invoiceId: string | null = anchor.type === 'invoice' ? anchor.id : null;
      let projectId: string | null = null;
      if (anchor.type === 'credit_memo') {
        const [cm] = await q(sql`
          SELECT id, number, status, issue_date, amount, invoice_id, project_id
            FROM credit_memos WHERE id = ${anchor.id} AND company_id = ${companyId}`);
        if (!cm) return [];
        invoiceId = cm.invoice_id ? s(cm.invoice_id) : null;
        projectId = cm.project_id ? s(cm.project_id) : null;
        if (!invoiceId) {
          return contractChain(companyId, projectId, [
            await creditMemoNode(companyId, cm, anchor.id),
          ]);
        }
      }
      const [inv] = await q(sql`
        SELECT i.id, i.number, i.status, i.invoice_date, i.total, i.project_id,
               i.change_order_id, co.number AS co_number, co.status AS co_status, co.total AS co_total
          FROM invoices i LEFT JOIN change_orders co ON co.id = i.change_order_id
         WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`);
      if (!inv) return [];
      const invNode = await invoiceNode(companyId, inv, anchor.id);
      const inner: FlowNode[] = inv.change_order_id
        ? [
            {
              kind: 'change_order',
              id: s(inv.change_order_id),
              label: `Change order ${s(inv.co_number)}`,
              status: s(inv.co_status),
              amount: n(inv.co_total),
              href: `/change-orders/${s(inv.change_order_id)}`,
              children: [invNode],
            },
          ]
        : [invNode];
      return contractChain(companyId, s(inv.project_id), inner);
    }
    case 'change_order': {
      const [co] = await q(sql`
        SELECT id, number, status, total, project_id FROM change_orders
         WHERE id = ${anchor.id} AND company_id = ${companyId}`);
      if (!co) return [];
      const invs = await q(sql`
        SELECT id, number, status, invoice_date, total FROM invoices
         WHERE company_id = ${companyId} AND change_order_id = ${anchor.id}
         ORDER BY invoice_date LIMIT ${LIMIT}`);
      const invNodes: FlowNode[] = [];
      for (const i of invs) invNodes.push(await invoiceNode(companyId, i));
      return contractChain(companyId, s(co.project_id), [
        {
          kind: 'change_order',
          id: s(co.id),
          label: `Change order ${s(co.number)}`,
          status: s(co.status),
          amount: n(co.total),
          href: `/change-orders/${s(co.id)}`,
          current: true,
          children: invNodes,
        },
      ]);
    }
    case 'estimate': {
      const [e] = await q(sql`
        SELECT id, number, status, total, project_id FROM estimates
         WHERE id = ${anchor.id} AND company_id = ${companyId}`);
      if (!e) return [];
      if (!e.project_id) {
        return [
          {
            kind: 'estimate',
            id: s(e.id),
            label: `Estimate ${s(e.number)}`,
            status: s(e.status),
            amount: n(e.total),
            href: `/estimates/${s(e.id)}`,
            current: true,
            children: [],
          },
        ];
      }
      // The whole job at a glance: change orders, invoices, purchase orders.
      const projectId = s(e.project_id);
      const [cos, invs, pos] = await Promise.all([
        q(sql`SELECT id, number, status, total FROM change_orders
               WHERE company_id = ${companyId} AND project_id = ${projectId}
               ORDER BY created_at LIMIT ${LIMIT}`),
        q(sql`SELECT id, number, status, invoice_date, total, change_order_id FROM invoices
               WHERE company_id = ${companyId} AND project_id = ${projectId}
               ORDER BY invoice_date LIMIT ${LIMIT}`),
        q(sql`SELECT id FROM purchase_orders
               WHERE company_id = ${companyId} AND project_id = ${projectId}
               ORDER BY issue_date NULLS LAST LIMIT ${LIMIT}`),
      ]);
      const invByCo = new Map<string, FlowNode[]>();
      const baseInvs: FlowNode[] = [];
      for (const i of invs) {
        const node = await invoiceNode(companyId, i);
        if (i.change_order_id) {
          const k = s(i.change_order_id);
          invByCo.set(k, [...(invByCo.get(k) ?? []), node]);
        } else baseInvs.push(node);
      }
      const poNodes: FlowNode[] = [];
      for (const p of pos) {
        const sub = await poSubtree(companyId, s(p.id));
        if (sub) poNodes.push(sub.node);
      }
      const inner: FlowNode[] = [
        ...cos.map((c) => ({
          kind: 'change_order' as const,
          id: s(c.id),
          label: `Change order ${s(c.number)}`,
          status: s(c.status),
          amount: n(c.total),
          href: `/change-orders/${s(c.id)}`,
          children: invByCo.get(s(c.id)) ?? [],
        })),
        ...baseInvs,
        ...poNodes,
      ];
      return contractChain(companyId, projectId, inner, anchor.id);
    }
  }
  return [];
}
