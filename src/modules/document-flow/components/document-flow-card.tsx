import { Suspense } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import {
  buildDocumentFlow,
  type FlowAnchor,
  type FlowKind,
  type FlowNode,
} from '@/lib/data/document-flow';

// "Document flow" (roadmap P5): the chain this document sits in — what it
// came from and what settled it — each step a link to the document.

const KIND_LABEL: Record<FlowKind, string> = {
  estimate: 'Estimate',
  contract: 'Contract',
  change_order: 'Change order',
  purchase_order: 'Purchase order',
  goods_receipt: 'Goods receipt',
  bill: 'Bill',
  vendor_credit: 'Vendor credit',
  bill_payment: 'Payment',
  invoice: 'Invoice',
  credit_memo: 'Credit memo',
  customer_payment: 'Payment',
  refund: 'Refund',
  bank_line: 'Bank line',
};

const KIND_DOT: Record<FlowKind, string> = {
  estimate: 'bg-slate-400',
  contract: 'bg-slate-700',
  change_order: 'bg-violet-500',
  purchase_order: 'bg-sky-500',
  goods_receipt: 'bg-sky-300',
  bill: 'bg-amber-500',
  vendor_credit: 'bg-amber-300',
  bill_payment: 'bg-emerald-500',
  invoice: 'bg-blue-600',
  credit_memo: 'bg-rose-400',
  customer_payment: 'bg-emerald-500',
  refund: 'bg-rose-300',
  bank_line: 'bg-emerald-700',
};

function countNodes(nodes: FlowNode[]): number {
  return nodes.reduce((s, n) => s + 1 + countNodes(n.children), 0);
}

function Node({ node }: { node: FlowNode }) {
  const body = (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        {KIND_LABEL[node.kind]}
      </span>
      <span
        className={`truncate ${node.current ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
      >
        {node.label}
      </span>
      {node.status ? (
        <span className="text-[11px] capitalize text-slate-500">
          {node.status.replace(/_/g, ' ')}
        </span>
      ) : null}
    </span>
  );
  return (
    <li>
      <div
        className={`flex items-center justify-between gap-3 rounded px-2 py-1 ${
          node.current ? 'bg-blue-50 ring-1 ring-blue-200' : ''
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[node.kind]}`} />
          {node.href && !node.current ? (
            <Link href={node.href as never} className="min-w-0 hover:underline">
              {body}
            </Link>
          ) : (
            body
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-600">
          {node.date ? <span className="font-mono text-slate-400">{node.date}</span> : null}
          {node.amount != null ? <span>{formatMoney(node.amount)}</span> : null}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-3 border-l border-slate-200 pl-3">
          {node.children.map((c) => (
            <Node key={`${c.kind}-${c.id}`} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Streams in after the page renders — the chain can take a moment. */
export function DocumentFlowCard(props: { companyId: string; anchor: FlowAnchor }) {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm text-slate-400">
          Document flow · loading…
        </div>
      }
    >
      <DocumentFlowTree {...props} />
    </Suspense>
  );
}

async function DocumentFlowTree({
  companyId,
  anchor,
}: {
  companyId: string;
  anchor: FlowAnchor;
}) {
  let nodes: FlowNode[] = [];
  try {
    nodes = await buildDocumentFlow(companyId, anchor);
  } catch {
    nodes = [];
  }
  // Nothing linked yet — the document alone isn't a flow.
  if (countNodes(nodes) <= 1) return null;
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open>
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-slate-900">
        Document flow{' '}
        <span className="font-normal text-slate-400">
          · {countNodes(nodes)} linked document{countNodes(nodes) === 1 ? '' : 's'}
        </span>
      </summary>
      <ul className="space-y-0.5 px-4 pb-4 text-sm">
        {nodes.map((n) => (
          <Node key={`${n.kind}-${n.id}`} node={n} />
        ))}
      </ul>
    </details>
  );
}
