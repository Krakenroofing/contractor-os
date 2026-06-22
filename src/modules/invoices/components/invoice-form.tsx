'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes-guard';
import {
  loadDraft,
  saveDraft,
  clearDraft,
  formatDraftTime,
} from '@/lib/form-draft';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { add, formatMoney, multiply, subtract } from '@/lib/money';
import { ProjectPicker } from '@/modules/projects/components/project-picker';
import type { CustomerPickerOption } from '@/modules/customers/components/customer-picker';
import {
  computeProgressNumbers,
  resolveProgressSource,
} from '../lib/progress';
import { createInvoiceAction, type CreateInvoiceState } from '../actions';
import {
  BILLING_TYPE_LABEL,
  STATUS_LABEL,
  billingTypeValues,
  invoiceStatusValues,
} from '../schema';
import {
  ProductPicker,
  type ProductPickerOption,
} from '@/modules/inventory/components/product-picker';

const initialState: CreateInvoiceState = {};

type LineDraft = {
  rowId: string;
  inventoryItemId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
};

function newEmptyLine(): LineDraft {
  return {
    rowId: crypto.randomUUID(),
    inventoryItemId: '',
    description: '',
    unit: '',
    quantity: '1',
    unitCost: '0',
  };
}

export type InvoiceFormProjectOption = {
  id: string;
  label: string;
  /** Customer that owns this project. Used to look up open-credit balance
   *  so the form can prompt to auto-apply when issuing a new invoice. */
  customerId?: string;
  /** Sum of open credit-memo balances for this project's customer at form
   *  render time. When > 0 and a project is selected, the form shows an
   *  auto-apply prompt below the project picker. */
  customerOpenCredit?: number;
  /** Display name for the customer — used in the prompt copy. */
  customerName?: string;
  /** Revised contract value (base + approved COs) at form render time. */
  contractValue?: number;
  /** ORIGINAL contract value (before COs). This is the denominator for
   *  base-contract progress billing — the rendered invoice's progress
   *  summary uses the same figure so % numbers never reshape after a CO
   *  lands. Falls back to contractValue when absent (older callers). */
  baseContractValue?: number;
  /** Sum of subtotals on prior non-void BASE-TRACK invoices (not linked to
   *  any CO) for this project. Used to compute "this round's gross" =
   *  cumulative_billed - priorBilledGross. CO-linked invoices track their
   *  own priors on InvoiceFormChangeOrderOption. */
  priorBilledGross?: number;
  /** Sum of (subtotal − retainage) on prior non-void base-track invoices.
   *  Shown on the rendered invoice as "Less previously paid (net)". */
  priorBilledNet?: number;
  /** Number of prior non-void base-track invoices on this project. Used to
   *  label this invoice as "Billing #N" in the progress breakdown. */
  priorInvoiceCount?: number;
  /** Retention % from the most-recent prior invoice on this project. The
   *  form pre-fills the Retainage % field with this so progress draws stay
   *  consistent across billings without re-typing. */
  lastRetainagePercent?: number;
  /** 'production' (default) or 'service'. Service / T&M projects default the
   *  billing type to Time & Materials and surface the T&M billing defaults
   *  below the line-item editor. */
  projectType?: 'production' | 'service';
  /** Default hourly bill rate for T&M labor on a service project — used by the
   *  "Add labor line" helper. */
  tmLaborBillRate?: number | null;
  /** Default markup % on billable materials for a service project — used by
   *  the "Add material line" helper. */
  tmMaterialMarkupPct?: number | null;
};
export type InvoiceFormProposalOption = { id: string; label: string; projectId: string };
export type InvoiceFormChangeOrderOption = {
  id: string;
  label: string;
  projectId: string;
  /** The CO's total value. When this CO is linked on the invoice, progress
   *  billing (% of contract) bills against THIS value — never the project
   *  total — so a 50% draw on a $10k CO is $5k regardless of the base
   *  contract size. */
  total?: number;
  /** Sum of subtotals on prior non-void invoices linked to this CO. */
  priorBilledGross?: number;
  /** Sum of (subtotal − retainage) on prior non-void invoices linked to
   *  this CO. */
  priorBilledNet?: number;
  /** Number of prior non-void invoices linked to this CO — labels the
   *  invoice "Billing #N" on the CO's own track. */
  priorInvoiceCount?: number;
};
export type InvoiceFormTemplateOption = {
  id: string;
  name: string;
  // Every section the template can toggle. The form hides/shows fields and
  // surfaces a summary card so the operator can see exactly which sections
  // will render on the resulting invoice PDF. Missing flag = treat as
  // enabled (back-compat for older callers).
  showCompanyBranding?: boolean;
  showHeader?: boolean;
  showLineItems?: boolean;
  showPaymentTerms?: boolean;
  showRetainage?: boolean;
  showTaxVat?: boolean;
  showNotes?: boolean;
  showSignature?: boolean;
  showFooter?: boolean;
  showBillToTin?: boolean;
  showProjectMetadata?: boolean;
  showWireInstructions?: boolean;
  showQualifications?: boolean;
  showAccountHistory?: boolean;
  showProgressBilling?: boolean;
  /** 'detailed' | 'summary' | 'lumpsum' — `lumpsum` auto-switches the
   *  invoice's billing type to lump_sum when this template is picked. */
  lineItemLayout?: string;
  /** Free-text bodies rendered on the PDF when their show* flag is on.
   *  The form previews them so the operator knows what will appear. */
  qualificationsText?: string;
  wireInstructionsNote?: string;
  /** Label overrides for the project-metadata input fields. */
  poNumberLabel?: string;
  billingNumberLabel?: string;
};

/** Order of sections shown in the template summary card. Matches the
 *  rendering order on the resulting PDF so the operator gets a logical
 *  top-to-bottom preview of what's enabled. */
const TEMPLATE_SUMMARY_ROWS: Array<{
  key: keyof InvoiceFormTemplateOption;
  label: string;
  /** When `wired === false`, the section is gated in the template but the
   *  invoice render doesn't yet emit it. Surfaced as "Coming soon" so the
   *  operator doesn't think the toggle is broken. */
  wired: boolean;
}> = [
  { key: 'showCompanyBranding', label: 'Company branding', wired: false },
  { key: 'showHeader', label: 'Header layout', wired: false },
  { key: 'showBillToTin', label: 'Bill-to TIN', wired: true },
  { key: 'showProjectMetadata', label: 'Project metadata (PO #, Billing #)', wired: true },
  { key: 'showLineItems', label: 'Line items', wired: true },
  { key: 'showTaxVat', label: 'Tax / VAT', wired: true },
  { key: 'showRetainage', label: 'Retainage', wired: true },
  { key: 'showProgressBilling', label: 'Progress billing summary', wired: false },
  { key: 'showQualifications', label: 'Qualifications & exclusions', wired: true },
  { key: 'showPaymentTerms', label: 'Payment terms', wired: true },
  { key: 'showWireInstructions', label: 'Wire instructions', wired: true },
  { key: 'showNotes', label: 'Notes', wired: true },
  { key: 'showAccountHistory', label: 'Account history', wired: false },
  { key: 'showSignature', label: 'Signature block', wired: false },
  { key: 'showFooter', label: 'Footer text', wired: true },
];

// Local "Save draft" (Path 1) — per-browser localStorage draft of the
// in-progress invoice. Note: notes/terms are uncontrolled and not restored.
const DRAFT_KEY = 'kops:invoice-draft';

type InvoiceDraft = {
  number: string;
  status: string;
  billingType: string;
  projectId: string;
  proposalId: string;
  changeOrderId: string;
  templateId: string;
  invoiceDate: string;
  dueDate: string;
  purchaseOrderNumber: string;
  billingLabel: string;
  lumpDescription: string;
  lumpAmount: string;
  percentOfContract: string;
  taxAmount: string;
  taxAmountManual: boolean;
  retainagePercent: string;
  retainageAmount: string;
  retainageAmountManual: boolean;
  expectedRetainageReleaseDate: string;
  amountPaid: string;
  applyCreditEnabled: boolean;
  applyCreditAmount: string;
  lines: LineDraft[];
};

export function InvoiceForm({
  projects,
  proposals,
  changeOrders,
  templates,
  products = [],
  customers,
  defaultNumber,
  defaultInvoiceDate,
  defaultDueDate,
  companyVatRatePercent = 0,
}: {
  projects: InvoiceFormProjectOption[];
  proposals: InvoiceFormProposalOption[];
  changeOrders: InvoiceFormChangeOrderOption[];
  templates: InvoiceFormTemplateOption[];
  products?: ProductPickerOption[];
  customers: CustomerPickerOption[];
  defaultNumber: string;
  defaultInvoiceDate: string;
  defaultDueDate: string;
  /**
   * The active company's VAT rate (numeric percent). When > 0, the Tax/VAT
   * field auto-fills to subtotal × rate / 100 as the user edits line items.
   * Manual override still works — once the user types in the field, we stop
   * auto-syncing for the rest of the session.
   */
  companyVatRatePercent?: number;
}) {
  const [state, formAction, pending] = useActionState(createInvoiceAction, initialState);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
  const [lines, setLines] = useState<LineDraft[]>([newEmptyLine()]);
  const [projectId, setProjectId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [billingType, setBillingType] = useState<string>('progress');
  // Phase 1.5: when the selected project's customer has open credit, the
  // operator can opt in to apply some/all of it to this new invoice.
  // FIFO consumption (oldest credits first) happens server-side after
  // the invoice is created.
  const [applyCreditAmount, setApplyCreditAmount] = useState<string>('0');
  const [applyCreditEnabled, setApplyCreditEnabled] = useState(false);

  // Look up the currently selected template so we can hide/show sections
  // based on its show* flags. When `templateId === ''` (i.e. user left the
  // dropdown on "— Default —"), behave as if every section is enabled —
  // the server will look up the company's default template and apply its
  // flags at render time.
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );
  // `undefined` flag (when no template selected or template doesn't expose
  // the flag) → treat as `true` so the form stays permissive.
  const showSection = (flag: boolean | undefined): boolean => flag !== false;
  // Opt-in sections (default OFF when no template): qualifications, wire
  // instructions, bill-to TIN. These would be noisy if always visible, so
  // they only appear when the template explicitly enables them.
  const showOptIn = (flag: boolean | undefined): boolean => flag === true;
  const showLineItems = showSection(activeTemplate?.showLineItems);
  // VAT only shows when the company actually charges it (rate > 0). A non-VAT
  // company (e.g. Kraken Roofing LLC, US) never sees the Tax/VAT field, the
  // totals VAT line, or the progress-breakdown VAT row — regardless of the
  // template's showTaxVat flag.
  const showTaxVat =
    showSection(activeTemplate?.showTaxVat) && companyVatRatePercent > 0;
  const showRetainage = showSection(activeTemplate?.showRetainage);
  const showPaymentTerms = showSection(activeTemplate?.showPaymentTerms);
  const showNotes = showSection(activeTemplate?.showNotes);
  const showProjectMetadata = showSection(activeTemplate?.showProjectMetadata);
  const showQualifications = showOptIn(activeTemplate?.showQualifications);
  const showWireInstructions = showOptIn(activeTemplate?.showWireInstructions);
  // `lineItemLayout === 'lumpsum'` is the template-driven equivalent of
  // manually setting billingType to 'lump_sum'. Auto-flip whenever the
  // active template lands on lumpsum so the operator doesn't have to
  // remember to flip both controls. Same for `showLineItems === false`:
  // there's nowhere to enter detailed lines, so lump-sum is the only
  // viable mode.
  const templateForcesLumpSum =
    activeTemplate?.lineItemLayout === 'lumpsum' ||
    activeTemplate?.showLineItems === false;
  // Lump-sum mode bypasses the qty × unit-cost editor and ships a single
  // line with the entered amount as unitCost (qty=1). Detailed line items
  // would be overkill for contract draws.
  const [lumpDescription, setLumpDescription] = useState('');
  const [lumpAmount, setLumpAmount] = useState('0');
  const [percentOfContract, setPercentOfContract] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  // Stops auto-VAT-sync once the user has typed in the Tax field — they
  // get full manual control on edit but the field pre-fills for fresh
  // invoices when the company has a VAT rate set.
  const [taxAmountManual, setTaxAmountManual] = useState(false);
  const [retainagePercent, setRetainagePercent] = useState('0');
  const [retainageAmount, setRetainageAmount] = useState('0');
  const [retainageAmountManual, setRetainageAmountManual] = useState(false);
  const [expectedRetainageReleaseDate, setExpectedRetainageReleaseDate] = useState('');
  const [amountPaid, setAmountPaid] = useState('0');
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
  const [billingLabel, setBillingLabel] = useState('');
  // Header fields controlled so a saved draft restores them.
  const [invoiceNumber, setInvoiceNumber] = useState(defaultNumber);
  const [status, setStatus] = useState<string>('draft');
  const [proposalId, setProposalId] = useState<string>('');
  const [changeOrderId, setChangeOrderId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(defaultInvoiceDate);
  const [dueDate, setDueDate] = useState<string>(defaultDueDate);
  const isLumpSum = billingType === 'lump_sum';

  // Local Save-draft / Resume (Path 1). Notes/terms are uncontrolled and not
  // captured here.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [resumeAvailableAt, setResumeAvailableAt] = useState<number | null>(
    null,
  );
  useEffect(() => {
    const d = loadDraft<InvoiceDraft>(DRAFT_KEY);
    if (d) setResumeAvailableAt(d.savedAt);
  }, []);

  function saveDraftNow() {
    const at = saveDraft<InvoiceDraft>(DRAFT_KEY, {
      number: invoiceNumber,
      status,
      billingType,
      projectId,
      proposalId,
      changeOrderId,
      templateId,
      invoiceDate,
      dueDate,
      purchaseOrderNumber,
      billingLabel,
      lumpDescription,
      lumpAmount,
      percentOfContract,
      taxAmount,
      taxAmountManual,
      retainagePercent,
      retainageAmount,
      retainageAmountManual,
      expectedRetainageReleaseDate,
      amountPaid,
      applyCreditEnabled,
      applyCreditAmount,
      lines,
    });
    if (at !== null) {
      setDraftSavedAt(at);
      setDirty(false);
    }
  }

  function resumeDraft() {
    const d = loadDraft<InvoiceDraft>(DRAFT_KEY);
    if (!d) return;
    const v = d.data;
    setInvoiceNumber(v.number);
    setStatus(v.status);
    setBillingType(v.billingType);
    setProjectId(v.projectId);
    setProposalId(v.proposalId);
    setChangeOrderId(v.changeOrderId);
    setTemplateId(v.templateId);
    setInvoiceDate(v.invoiceDate);
    setDueDate(v.dueDate);
    setPurchaseOrderNumber(v.purchaseOrderNumber);
    setBillingLabel(v.billingLabel);
    setLumpDescription(v.lumpDescription);
    setLumpAmount(v.lumpAmount);
    setPercentOfContract(v.percentOfContract);
    setTaxAmount(v.taxAmount);
    setTaxAmountManual(v.taxAmountManual);
    setRetainagePercent(v.retainagePercent);
    setRetainageAmount(v.retainageAmount);
    setRetainageAmountManual(v.retainageAmountManual);
    setExpectedRetainageReleaseDate(v.expectedRetainageReleaseDate);
    setAmountPaid(v.amountPaid);
    setApplyCreditEnabled(v.applyCreditEnabled);
    setApplyCreditAmount(v.applyCreditAmount);
    setLines(
      v.lines.length > 0
        ? v.lines.map((l) => ({ ...l, rowId: crypto.randomUUID() }))
        : [newEmptyLine()],
    );
    setResumeAvailableAt(null);
    setDraftSavedAt(null);
    setDirty(false);
  }

  // Honour the template's `lineItemLayout === 'lumpsum'` / `showLineItems
  // === false` by auto-flipping billingType. Only fires when the user picks
  // a template — manual changes via the Billing type dropdown still win
  // once the user has committed to a template.
  useEffect(() => {
    if (templateForcesLumpSum && billingType !== 'lump_sum') {
      setBillingType('lump_sum');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const filteredProposals = useMemo(
    () => (projectId ? proposals.filter((p) => p.projectId === projectId) : proposals),
    [proposals, projectId],
  );
  const filteredCOs = useMemo(
    () => (projectId ? changeOrders.filter((c) => c.projectId === projectId) : changeOrders),
    [changeOrders, projectId],
  );

  // Selected project's billing context — drives the progress-billing
  // breakdown when the operator enters a % of contract.
  const activeProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  // The CO this invoice is linked to (if any). A linked CO carves out its
  // own billing track: % progress applies to the CO's value and only
  // invoices linked to the SAME CO count as "previously billed".
  const activeCO = useMemo(
    () =>
      changeOrderId
        ? changeOrders.find((c) => c.id === changeOrderId)
        : undefined,
    [changeOrders, changeOrderId],
  );

  // The contract base this invoice bills against. CO linked → the CO's own
  // value/priors (NEVER falls back to the project total — billing 50% of a
  // CO must mean 50% of the CO). No CO → the ORIGINAL contract value with
  // base-track priors, matching the rendered invoice's progress summary.
  const progressSource = useMemo(
    () => resolveProgressSource(activeCO, activeProject),
    [activeCO, activeProject],
  );

  // Progress mode kicks in when (a) we're in lump-sum, (b) the billing
  // source (linked CO, else base contract) has a non-zero value, and (c)
  // the operator entered a %. In that mode the Amount field is auto-derived
  // as `cumulative_billed - priorBilledGross` and a breakdown card replaces
  // the manual entry.
  const progressMode =
    isLumpSum &&
    percentOfContract.trim() !== '' &&
    !!progressSource &&
    progressSource.value > 0;

  const progressNumbers = useMemo(
    () =>
      progressMode
        ? computeProgressNumbers(progressSource, percentOfContract, retainagePercent)
        : null,
    [progressMode, progressSource, percentOfContract, retainagePercent],
  );

  // Sync the lump-sum amount field whenever the progress math changes so
  // the totals strip + persistence stay consistent. Manual edits to the
  // Amount field are blocked while progressMode is on (Input becomes
  // read-only below).
  useEffect(() => {
    if (progressNumbers) {
      setLumpAmount(progressNumbers.thisRoundGross.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressNumbers?.thisRoundGross]);

  // When the operator selects a project that has prior invoices on it,
  // pre-fill Retainage % from the most recent one. Keeps progress draws
  // consistent across billings without making the operator re-type 10
  // every time. Only fires when retainage% is still at its default ("0"),
  // so manual edits won't get clobbered.
  useEffect(() => {
    if (
      activeProject?.lastRetainagePercent !== undefined &&
      activeProject.lastRetainagePercent > 0 &&
      (retainagePercent === '0' || retainagePercent === '')
    ) {
      setRetainagePercent(activeProject.lastRetainagePercent.toString());
      setRetainageAmountManual(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Service / T&M project → bill from labor + materials. Default the billing
  // type to Time & Materials when the operator selects a service project and
  // hasn't already moved the billing-type control off its 'progress' default.
  // Mirrors the retainage prefill: only fires on project change, never
  // clobbers a manual choice.
  const isServiceProject = activeProject?.projectType === 'service';
  useEffect(() => {
    if (isServiceProject && billingType === 'progress') {
      setBillingType('t_m');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function addLineFromDefaults(patch: Partial<LineDraft>) {
    setLines((prev) => [...prev, { ...newEmptyLine(), ...patch }]);
    setDirty(true);
  }

  const totals = useMemo(() => {
    let subtotal = 0;
    if (isLumpSum) {
      // One line; amount → subtotal.
      subtotal = Number(lumpAmount) || 0;
    } else {
      for (const l of lines) {
        subtotal = add(
          subtotal,
          multiply(Number(l.quantity) || 0, Number(l.unitCost) || 0),
        );
      }
    }
    const pct = Number(retainagePercent) || 0;
    // Auto-derive retainage held from subtotal × pct unless the user has
    // manually overridden the held amount.
    const derivedHeld = pct > 0 ? (subtotal * pct) / 100 : 0;
    const retainage = retainageAmountManual
      ? Number(retainageAmount) || 0
      : Math.round(derivedHeld * 100) / 100;
    // The amount we're actually billing on this invoice — subtotal less
    // whatever's being held back. VAT applies to this, not the gross
    // subtotal: retainage is deferred billing, so the VAT on it is
    // deferred too (recognized when the retainage gets released).
    const netOfRetainage = subtract(subtotal, retainage);
    // Auto-VAT from company.vatRatePercent unless user typed in the Tax
    // field. Computed on the post-retainage base so the recipient doesn't
    // pay VAT on money you haven't actually invoiced yet.
    const autoTax =
      companyVatRatePercent > 0
        ? Math.round(((netOfRetainage * companyVatRatePercent) / 100) * 100) / 100
        : 0;
    const tax = taxAmountManual ? Number(taxAmount) || 0 : autoTax;
    const total = add(netOfRetainage, tax);
    const paid = Number(amountPaid) || 0;
    const balance = subtract(total, paid);
    return { subtotal, tax, retainage, netOfRetainage, total, paid, balance, pct };
  }, [
    lines,
    isLumpSum,
    lumpAmount,
    taxAmount,
    taxAmountManual,
    companyVatRatePercent,
    retainagePercent,
    retainageAmount,
    retainageAmountManual,
    amountPaid,
  ]);

  // Display value for the Tax field: when in auto mode, show the derived
  // amount so the user sees the math without having to compute it.
  const taxDisplay = taxAmountManual ? taxAmount : totals.tax.toFixed(2);

  // Keep the visible retainageAmount field synced with the derived value when
  // the user hasn't manually edited it.
  const retainageDisplay = retainageAmountManual
    ? retainageAmount
    : totals.retainage.toFixed(2);

  // In lump-sum mode, ship a single synthetic line so the existing data
  // path (lines table, totals math, reporting) keeps working. Progress
  // mode supplies a default description like "Billing #N — X% Progress"
  // so the rendered invoice carries the context even if the operator
  // leaves the Description field blank.
  const progressDefaultDescription = progressNumbers
    ? progressNumbers.sourceKind === 'co'
      ? `Billing #${progressNumbers.billingNumber} — ${progressNumbers.pct.toFixed(2)}% of ${progressNumbers.sourceLabel}`
      : `Billing #${progressNumbers.billingNumber} — ${progressNumbers.pct.toFixed(2)}% Progress`
    : '';
  const linesPayload = isLumpSum
    ? [
        {
          description:
            lumpDescription ||
            progressDefaultDescription ||
            'Lump sum billing',
          unit: '',
          quantity: '1',
          unitCost: lumpAmount || '0',
        },
      ]
    : lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitCost: l.unitCost,
      }));

  const updateLine = (rowId: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form
      action={formAction}
      onInput={() => {
        setDirty(true);
        setDraftSavedAt(null);
      }}
      className="space-y-6"
    >
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      {resumeAvailableAt !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            You have a saved invoice draft from{' '}
            {formatDraftTime(resumeAvailableAt)}.{' '}
            <span className="text-amber-700">(Notes/terms aren&apos;t restored.)</span>
          </span>
          <span className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={resumeDraft}>
              Resume draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(DRAFT_KEY);
                setResumeAvailableAt(null);
              }}
            >
              Discard
            </Button>
          </span>
        </div>
      )}

      <input type="hidden" name="lines" value={JSON.stringify(linesPayload)} />
      <input
        type="hidden"
        name="percentOfContract"
        value={isLumpSum ? percentOfContract : ''}
      />

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Invoice header</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Invoice number" error={err('number')} required>
            <Input
              name="number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              required
            />
          </Field>
          <Field label="Status" error={err('status')}>
            <Select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {invoiceStatusValues
                .filter((s) => s !== 'overdue')
                .map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Billing type" error={err('billingType')}>
            <Select
              name="billingType"
              value={billingType}
              onChange={(e) => setBillingType(e.target.value)}
            >
              {billingTypeValues.map((b) => (
                <option key={b} value={b}>
                  {BILLING_TYPE_LABEL[b]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project" error={err('projectId')} required>
            <ProjectPicker
              name="projectId"
              value={projectId}
              projects={projects.map((p) => ({ id: p.id, name: p.label }))}
              customers={customers}
              onChange={(id) => setProjectId(id)}
              allowNone={false}
              placeholder={
                projects.length === 0
                  ? 'No projects — create one first'
                  : 'Select a project'
              }
              required
            />
            {/* Phase 1.5: customer-credit auto-apply prompt. Appears only
                when the picked project's customer has unconsumed credit. */}
            {(() => {
              const proj = projects.find((p) => p.id === projectId);
              const openCredit = proj?.customerOpenCredit ?? 0;
              if (!proj || openCredit <= 0) return null;
              return (
                <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyCreditEnabled}
                      onChange={(e) => {
                        setApplyCreditEnabled(e.target.checked);
                        if (e.target.checked && applyCreditAmount === '0') {
                          // Default to full open credit; operator can shrink.
                          setApplyCreditAmount(openCredit.toFixed(2));
                        }
                      }}
                    />
                    <span className="flex-1">
                      <strong>{proj.customerName ?? 'This customer'}</strong>{' '}
                      has{' '}
                      <strong>
                        {openCredit.toLocaleString(undefined, {
                          style: 'currency',
                          currency: 'USD',
                        })}
                      </strong>{' '}
                      in open credit memos. Apply some / all to this new
                      invoice on save (FIFO across credits — oldest first).
                    </span>
                  </label>
                  {applyCreditEnabled && (
                    <div className="flex items-center gap-2 pl-6">
                      <span>Apply $</span>
                      <Input
                        name="applyCreditAmount"
                        type="number"
                        step="0.01"
                        min="0"
                        max={openCredit}
                        value={applyCreditAmount}
                        onChange={(e) => setApplyCreditAmount(e.target.value)}
                        className="w-32 h-7 text-xs"
                      />
                      <span className="text-amber-800">
                        (up to {openCredit.toFixed(2)})
                      </span>
                    </div>
                  )}
                  {!applyCreditEnabled && (
                    <input
                      type="hidden"
                      name="applyCreditAmount"
                      value="0"
                    />
                  )}
                </div>
              );
            })()}
          </Field>
          <Field label="Linked proposal (optional)" error={err('proposalId')}>
            <Select
              name="proposalId"
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
            >
              <option value="">— None —</option>
              {filteredProposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Linked change order (optional)" error={err('changeOrderId')}>
            <Select
              name="changeOrderId"
              value={changeOrderId}
              onChange={(e) => setChangeOrderId(e.target.value)}
            >
              <option value="">— None —</option>
              {filteredCOs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Template" error={err('templateId')}>
            <Select
              name="templateId"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">— Default (no template) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date" error={err('invoiceDate')} required>
            <Input
              name="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Due date" error={err('dueDate')}>
            <Input
              name="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          {showProjectMetadata && (
            <>
              <Field
                label={
                  activeTemplate?.poNumberLabel && activeTemplate.poNumberLabel.trim() !== ''
                    ? activeTemplate.poNumberLabel
                    : 'PO number'
                }
                error={err('purchaseOrderNumber')}
              >
                <Input
                  name="purchaseOrderNumber"
                  value={purchaseOrderNumber}
                  onChange={(e) => setPurchaseOrderNumber(e.target.value)}
                  placeholder="e.g. PO-2026-0042"
                />
              </Field>
              <Field
                label={
                  activeTemplate?.billingNumberLabel &&
                  activeTemplate.billingNumberLabel.trim() !== ''
                    ? activeTemplate.billingNumberLabel
                    : 'Billing #'
                }
                error={err('billingLabel')}
              >
                <Input
                  name="billingLabel"
                  value={billingLabel}
                  onChange={(e) => setBillingLabel(e.target.value)}
                  placeholder="e.g. Billing 3 of 12"
                />
              </Field>
            </>
          )}
          {!showProjectMetadata && (
            <>
              <input type="hidden" name="purchaseOrderNumber" value="" />
              <input type="hidden" name="billingLabel" value="" />
            </>
          )}
        </div>
      </fieldset>

      {activeTemplate && (
        <TemplateSummary template={activeTemplate} forcesLumpSum={templateForcesLumpSum} />
      )}

      {isLumpSum && (
        <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
          <legend className="px-2 text-sm font-medium text-slate-700">
            Lump sum billing
          </legend>
          <p className="text-xs text-slate-500">
            Single-line draw — enter what you&apos;re billing and the amount.
            To bill a percentage of the contract value (with auto prior-billed
            tracking), fill in &quot;% of contract&quot; once a project is
            selected. When a change order is linked above, the % bills against
            that CO&apos;s value on its own track — it never totals from the
            project.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <Label className="text-xs">Description</Label>
              <Input
                value={lumpDescription}
                onChange={(e) => setLumpDescription(e.target.value)}
                placeholder={
                  progressMode
                    ? `Billing #${progressNumbers?.billingNumber ?? 1} — ${(progressNumbers?.pct ?? 0).toFixed(0)}% progress`
                    : 'e.g. Foundation work — 30% draw'
                }
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">
                {progressMode ? 'Amount (auto from %)' : 'Amount'}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={lumpAmount}
                onChange={(e) => setLumpAmount(e.target.value)}
                readOnly={progressMode}
                disabled={progressMode}
                className="tabular-nums"
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">
                {activeCO ? `% of ${activeCO.label}` : '% of contract'}
              </Label>
              <Input
                type="number"
                step="0.001"
                value={percentOfContract}
                onChange={(e) => setPercentOfContract(e.target.value)}
                placeholder="e.g. 30"
                className="tabular-nums"
              />
            </div>
          </div>
          {progressMode && progressNumbers && (
            <ProgressBreakdown
              data={progressNumbers}
              taxRate={companyVatRatePercent}
              showRetainage={showRetainage}
              showTaxVat={showTaxVat}
            />
          )}
          {!progressMode &&
            isLumpSum &&
            percentOfContract.trim() !== '' &&
            (!progressSource || progressSource.value <= 0) && (
              <p className="text-xs text-amber-700">
                {activeCO
                  ? `${activeCO.label} has no value — automatic progress-billing math needs a non-zero change-order total.`
                  : 'Pick a project with a non-zero contract value to enable automatic progress-billing math.'}
              </p>
            )}
        </fieldset>
      )}

      <fieldset
        className={
          'border border-slate-200 rounded-lg p-4 space-y-3 ' +
          (isLumpSum || !showLineItems ? 'hidden' : '')
        }
      >
        <legend className="px-2 text-sm font-medium text-slate-700">
          Billing breakdown
        </legend>
        {isServiceProject && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
            <span className="font-medium">Time &amp; Materials.</span> Enter labor
            and materials as line items.{' '}
            {activeProject?.tmLaborBillRate != null && activeProject.tmLaborBillRate > 0
              ? `Default labor bill rate ${formatMoney(activeProject.tmLaborBillRate)}/hr. `
              : 'No default labor bill rate set on this project. '}
            {activeProject?.tmMaterialMarkupPct != null && activeProject.tmMaterialMarkupPct > 0
              ? `Bill materials at cost + ${activeProject.tmMaterialMarkupPct}% markup.`
              : ''}
          </div>
        )}
        {err('lines') && <p className="text-xs text-red-600">{err('lines')}</p>}
        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-[1.6fr_2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 px-1 text-xs font-medium text-slate-500">
            <span>Product</span>
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit cost</span>
            <span className="text-right">Line total</span>
            <span />
          </div>
          {lines.map((line) => {
            const lineTotal = multiply(
              Number(line.quantity) || 0,
              Number(line.unitCost) || 0,
            );
            return (
              <div
                key={line.rowId}
                className="grid grid-cols-1 md:grid-cols-[1.6fr_2.5fr_0.7fr_0.6fr_0.9fr_1fr_auto] gap-2 items-start"
              >
                <ProductPicker
                  value={line.inventoryItemId}
                  options={products}
                  onItemSelected={(picked) => {
                    if (!picked) {
                      updateLine(line.rowId, { inventoryItemId: '' });
                      return;
                    }
                    updateLine(line.rowId, {
                      inventoryItemId: picked.id,
                      description:
                        line.description.trim() === '' ? picked.name : line.description,
                      unit:
                        line.unit.trim() === '' && picked.unit
                          ? picked.unit
                          : line.unit,
                      unitCost:
                        (Number(line.unitCost) || 0) === 0 && picked.defaultCost > 0
                          ? picked.defaultCost.toString()
                          : line.unitCost,
                    });
                  }}
                />
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(line.rowId, { description: e.target.value })}
                  placeholder="Description"
                />
                <Input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.rowId, { quantity: e.target.value })}
                />
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(line.rowId, { unit: e.target.value })}
                  placeholder="lot"
                />
                <Input
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(e) => updateLine(line.rowId, { unitCost: e.target.value })}
                />
                <div className="flex items-center justify-end h-10 px-2 text-sm tabular-nums">
                  {formatMoney(lineTotal)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => prev.filter((l) => l.rowId !== line.rowId))
                  }
                  disabled={lines.length === 1}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, newEmptyLine()])}
          >
            + Add line
          </Button>
          {isServiceProject && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  addLineFromDefaults({
                    description: 'Labor',
                    unit: 'hr',
                    quantity: '1',
                    unitCost:
                      activeProject?.tmLaborBillRate != null &&
                      activeProject.tmLaborBillRate > 0
                        ? activeProject.tmLaborBillRate.toString()
                        : '0',
                  })
                }
              >
                + Add labor line
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  addLineFromDefaults({ description: 'Materials', unit: 'ea', quantity: '1' })
                }
              >
                + Add material line
              </Button>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Totals</legend>
        {activeTemplate && (
          <p className="text-xs text-slate-500">
            Showing fields enabled on{' '}
            <span className="font-medium text-slate-700">{activeTemplate.name}</span>
            . Sections turned off in the template are hidden here too —
            change the template above if you need different fields.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {showTaxVat && (
            <Field
              label={
                companyVatRatePercent > 0
                  ? `Tax / VAT (${companyVatRatePercent.toFixed(2)}% auto)`
                  : 'Tax / VAT'
              }
              error={err('taxAmount')}
            >
              <Input
                name="taxAmount"
                inputMode="decimal"
                value={taxDisplay}
                onChange={(e) => {
                  setTaxAmount(e.target.value);
                  setTaxAmountManual(true);
                }}
              />
              {companyVatRatePercent > 0 && taxAmountManual && (
                <button
                  type="button"
                  onClick={() => {
                    setTaxAmountManual(false);
                    setTaxAmount('0');
                  }}
                  className="mt-1 text-[11px] text-slate-500 hover:text-slate-900 underline"
                >
                  Reset to auto ({companyVatRatePercent.toFixed(2)}% of subtotal)
                </button>
              )}
            </Field>
          )}
          {/* Tax field is hidden — still post a zero value so the server
              schema doesn't reject the form. */}
          {!showTaxVat && <input type="hidden" name="taxAmount" value="0" />}
          {showRetainage && (
            <>
              <Field label="Retainage %" error={err('retainagePercent')}>
                <Input
                  name="retainagePercent"
                  inputMode="decimal"
                  value={retainagePercent}
                  onChange={(e) => {
                    setRetainagePercent(e.target.value);
                    setRetainageAmountManual(false);
                  }}
                  placeholder="e.g. 10"
                />
              </Field>
              <Field
                label={
                  retainageAmountManual
                    ? 'Retainage held (manual)'
                    : 'Retainage held (auto from %)'
                }
                error={err('retainageAmount')}
              >
                <Input
                  name="retainageAmount"
                  inputMode="decimal"
                  value={retainageDisplay}
                  onChange={(e) => {
                    setRetainageAmount(e.target.value);
                    setRetainageAmountManual(true);
                  }}
                />
              </Field>
              <Field
                label="Expected retainage release date"
                error={err('expectedRetainageReleaseDate')}
              >
                <Input
                  name="expectedRetainageReleaseDate"
                  type="date"
                  value={expectedRetainageReleaseDate}
                  onChange={(e) => setExpectedRetainageReleaseDate(e.target.value)}
                />
              </Field>
            </>
          )}
          {!showRetainage && (
            <>
              <input type="hidden" name="retainagePercent" value="0" />
              <input type="hidden" name="retainageAmount" value="0" />
              <input
                type="hidden"
                name="expectedRetainageReleaseDate"
                value=""
              />
            </>
          )}
          <Field label="Amount paid" error={err('amountPaid')}>
            <Input
              name="amountPaid"
              inputMode="decimal"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
        {/* Order: subtotal -> less retainage -> net of retainage -> VAT
            -> net amount due. VAT is computed on the post-retainage base
            so retainage held back isn't taxed (it'll be VATed on release). */}
        <Stat label="Subtotal" value={formatMoney(totals.subtotal)} />
        {showRetainage && totals.retainage > 0 && (
          <Stat
            label={`Less retainage${totals.pct > 0 ? ` (${totals.pct.toFixed(2)}%)` : ''}`}
            value={`(${formatMoney(totals.retainage)})`}
          />
        )}
        {showRetainage && totals.retainage > 0 && (
          <Stat
            label="Net of retainage"
            value={formatMoney(totals.netOfRetainage)}
          />
        )}
        {showTaxVat && (
          <Stat
            label={
              showRetainage && totals.retainage > 0 ? 'VAT on net' : 'Tax / VAT'
            }
            value={formatMoney(totals.tax)}
          />
        )}
        <Stat label="Net amount due" value={formatMoney(totals.total)} highlight />
        <Stat
          label="Balance due"
          value={formatMoney(totals.balance)}
          valueClassName={
            totals.balance <= 0
              ? 'text-emerald-700'
              : totals.balance > totals.total
                ? 'text-red-600'
                : 'text-slate-900'
          }
        />
      </div>

      {(showNotes || showPaymentTerms) && (
        <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
          <legend className="px-2 text-sm font-medium text-slate-700">
            Notes &amp; terms
          </legend>
          {showNotes && (
            <TextareaField name="notes" label="Notes" rows={3} />
          )}
          {showPaymentTerms && (
            <TextareaField
              name="termsOverride"
              label="Payment terms (override template)"
              rows={3}
            />
          )}
        </fieldset>
      )}
      {!showNotes && <input type="hidden" name="notes" value="" />}
      {!showPaymentTerms && <input type="hidden" name="termsOverride" value="" />}

      {showQualifications && activeTemplate?.qualificationsText && (
        <PreviewSection
          title="Qualifications & exclusions (from template)"
          body={activeTemplate.qualificationsText}
        />
      )}
      {showWireInstructions && activeTemplate?.wireInstructionsNote && (
        <PreviewSection
          title="Wire / payment instructions (from template)"
          body={activeTemplate.wireInstructionsNote}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending}
          onClick={() => clearDraft(DRAFT_KEY)}
        >
          {pending ? 'Creating…' : 'Create invoice'}
        </Button>
        <Button type="button" variant="outline" onClick={saveDraftNow}>
          Save draft
        </Button>
        <Link href="/invoices">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
        {draftSavedAt !== null && (
          <span className="text-xs text-emerald-700">
            ✓ Draft saved {formatDraftTime(draftSavedAt)} — safe to leave and
            resume later.
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextareaField({
  name,
  label,
  rows,
}: {
  name: string;
  label: string;
  rows: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        name={name}
        rows={rows}
        className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}

function TemplateSummary({
  template,
  forcesLumpSum,
}: {
  template: InvoiceFormTemplateOption;
  forcesLumpSum: boolean;
}) {
  // Same flag semantics as the form itself: opt-in sections (qualifications,
  // wire, bill-to TIN) treat undefined as off; everything else treats
  // undefined as on.
  const OPT_IN = new Set<keyof InvoiceFormTemplateOption>([
    'showQualifications',
    'showWireInstructions',
    'showBillToTin',
    'showProgressBilling',
    'showAccountHistory',
    'showRetainage',
  ]);
  const isOn = (key: keyof InvoiceFormTemplateOption): boolean => {
    const v = template[key];
    if (typeof v !== 'boolean') return !OPT_IN.has(key);
    return v;
  };
  const enabled = TEMPLATE_SUMMARY_ROWS.filter((r) => isOn(r.key));
  const disabled = TEMPLATE_SUMMARY_ROWS.filter((r) => !isOn(r.key));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-slate-700">
          Template:{' '}
          <span className="font-semibold text-slate-900">{template.name}</span>
        </p>
        {forcesLumpSum && (
          <span className="text-xs text-amber-700 font-medium">
            Lump-sum mode enforced by template
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        <div>
          <p className="text-xs uppercase tracking-wide text-emerald-700 font-medium mb-1">
            Will render on invoice
          </p>
          <ul className="space-y-0.5 text-xs text-slate-700">
            {enabled.length === 0 && (
              <li className="text-slate-400 italic">Nothing enabled.</li>
            )}
            {enabled.map((r) => (
              <li key={r.key}>
                ✓ {r.label}
                {!r.wired && (
                  <span className="ml-1 text-amber-700">(rendering coming soon)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">
            Hidden on invoice
          </p>
          <ul className="space-y-0.5 text-xs text-slate-500">
            {disabled.length === 0 && (
              <li className="italic">Nothing hidden.</li>
            )}
            {disabled.map((r) => (
              <li key={r.key}>– {r.label}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug">
        Toggles on the template control which sections appear on the rendered
        invoice. Edit the template under{' '}
        <Link href="/invoices/templates" className="underline">
          Invoices → Templates
        </Link>{' '}
        to change them. The form below only shows fields that are enabled.
      </p>
    </div>
  );
}

function ProgressBreakdown({
  data,
  taxRate,
  showRetainage,
  showTaxVat,
}: {
  data: {
    contract: number;
    pct: number;
    priorNet: number;
    priorCount: number;
    retentionPct: number;
    cumulativeBilled: number;
    thisRoundGross: number;
    cumulativeRetention: number;
    billingNumber: number;
    sourceKind: 'base' | 'co';
    sourceLabel: string;
  };
  taxRate: number;
  showRetainage: boolean;
  showTaxVat: boolean;
}) {
  // What the customer sees on the rendered invoice — same shape as the PDF
  // breakdown so the operator can verify the math before clicking save.
  // "Less retention" uses the cumulative figure (template-set retention% ×
  // cumulative billed) to match the user's reference PDF format.
  const cumRetentionShown = showRetainage ? data.cumulativeRetention : 0;
  const invoiceTotal =
    data.cumulativeBilled - data.priorNet - cumRetentionShown;
  const vat = showTaxVat
    ? Math.round(((invoiceTotal * taxRate) / 100) * 100) / 100
    : 0;
  const finalTotal = invoiceTotal + vat;
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
        <p className="font-medium text-emerald-900">
          Progress billing breakdown
        </p>
        <span className="uppercase tracking-wide text-[10px] text-emerald-700">
          Bills against {data.sourceLabel}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
        <span className="text-slate-700">
          {data.sourceKind === 'co'
            ? `${data.sourceLabel} value`
            : 'Contract value'}
        </span>
        <span className="text-slate-900 text-right">
          {formatMoney(data.contract)}
        </span>
        <span className="text-slate-700">
          Billing #{data.billingNumber} — {data.pct.toFixed(2)}% Progress
        </span>
        <span className="text-slate-900 text-right">
          {formatMoney(data.cumulativeBilled)}
        </span>
        <span className="text-slate-700">
          Less previously paid ({data.priorCount} prior invoice
          {data.priorCount === 1 ? '' : 's'})
        </span>
        <span className="text-slate-900 text-right">
          ({formatMoney(data.priorNet)})
        </span>
        {showRetainage && (
          <>
            <span className="text-slate-700">
              Less retention ({data.retentionPct.toFixed(2)}% of cumulative)
            </span>
            <span className="text-slate-900 text-right">
              ({formatMoney(data.cumulativeRetention)})
            </span>
          </>
        )}
        <span className="font-medium text-slate-900 border-t border-emerald-200 pt-1">
          Invoice total
        </span>
        <span className="font-medium text-slate-900 text-right border-t border-emerald-200 pt-1">
          {formatMoney(invoiceTotal)}
        </span>
        {showTaxVat && (
          <>
            <span className="text-slate-700">
              VAT ({taxRate.toFixed(2)}%)
            </span>
            <span className="text-slate-900 text-right">
              {formatMoney(vat)}
            </span>
          </>
        )}
        <span className="font-semibold text-emerald-900 border-t border-emerald-200 pt-1">
          Final total
        </span>
        <span className="font-semibold text-emerald-900 text-right border-t border-emerald-200 pt-1">
          {formatMoney(finalTotal)}
        </span>
      </div>
    </div>
  );
}

function PreviewSection({ title, body }: { title: string; body: string }) {
  return (
    <fieldset className="border border-slate-200 rounded-lg p-4 space-y-2">
      <legend className="px-2 text-sm font-medium text-slate-700">{title}</legend>
      <p className="whitespace-pre-wrap text-sm text-slate-600">{body}</p>
      <p className="text-[11px] text-slate-400">
        Stored on the template — edit there to change for all invoices using
        this template.
      </p>
    </fieldset>
  );
}

function Stat({
  label,
  value,
  highlight,
  valueClassName,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          valueClassName ?? (highlight ? 'text-slate-900' : 'text-slate-800')
        }`}
      >
        {value}
      </p>
    </div>
  );
}
