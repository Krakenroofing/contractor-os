'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  HEADER_LAYOUT_LABEL,
  LINE_ITEM_LAYOUT_LABEL,
  SECTION_LABEL,
  headerLayoutValues,
  lineItemLayoutValues,
} from '../schema';
import {
  createInvoiceTemplateAction,
  updateInvoiceTemplateAction,
  type CreateInvoiceTemplateState,
} from '../actions';
import type { InvoiceTemplate } from '@/db/schema';

const initialState: CreateInvoiceTemplateState = {};

type Defaults = Partial<InvoiceTemplate> & { name?: string };

export function InvoiceTemplateForm({
  defaults,
  editId,
}: {
  defaults?: Defaults;
  /** When provided, switches the form to update mode against this id. */
  editId?: string;
}) {
  const action = editId
    ? updateInvoiceTemplateAction.bind(null, editId)
    : createInvoiceTemplateAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const err = (key: string) => state.errors?.[key]?.[0];

  const d = {
    name: defaults?.name ?? '',
    description: defaults?.description ?? '',
    isDefault: defaults?.isDefault ?? false,
    showCompanyBranding: defaults?.showCompanyBranding ?? true,
    showHeader: defaults?.showHeader ?? true,
    showLineItems: defaults?.showLineItems ?? true,
    showPaymentTerms: defaults?.showPaymentTerms ?? true,
    showRetainage: defaults?.showRetainage ?? false,
    showTaxVat: defaults?.showTaxVat ?? true,
    showNotes: defaults?.showNotes ?? true,
    showSignature: defaults?.showSignature ?? true,
    showFooter: defaults?.showFooter ?? true,
    headerLayout: defaults?.headerLayout ?? 'standard',
    lineItemLayout: defaults?.lineItemLayout ?? 'detailed',
    headerNote: defaults?.headerNote ?? '',
    paymentTermsText: defaults?.paymentTermsText ?? '',
    retainageText: defaults?.retainageText ?? '',
    notesText: defaults?.notesText ?? '',
    footerText: defaults?.footerText ?? '',

    // Phase 1 additions
    titleOverride: defaults?.titleOverride ?? '',
    tinLabel: defaults?.tinLabel ?? 'TIN',
    issuedByLabel: defaults?.issuedByLabel ?? 'Issued by',
    showBillToTin: defaults?.showBillToTin ?? false,
    billToAttentionLabel: defaults?.billToAttentionLabel ?? 'Attention',
    showProjectMetadata: defaults?.showProjectMetadata ?? true,
    poNumberLabel: defaults?.poNumberLabel ?? 'Purchase Order',
    billingNumberLabel: defaults?.billingNumberLabel ?? 'Billing #',
    projectDescriptionLabel:
      defaults?.projectDescriptionLabel ?? 'Project description',
    showWireInstructions: defaults?.showWireInstructions ?? false,
    wireInstructionsNote: defaults?.wireInstructionsNote ?? '',
    showQualifications: defaults?.showQualifications ?? false,
    qualificationsText: defaults?.qualificationsText ?? '',
    showAccountHistory: defaults?.showAccountHistory ?? false,
    accountHistoryLabel: defaults?.accountHistoryLabel ?? 'Account history',
    showProgressBilling: defaults?.showProgressBilling ?? false,
    progressBillingLabel: defaults?.progressBillingLabel ?? 'Progress billing',
    contractValueLabel: defaults?.contractValueLabel ?? 'Total contract value',
    changeOrdersLabel: defaults?.changeOrdersLabel ?? 'Approved change orders',
    priorBilledLabel: defaults?.priorBilledLabel ?? 'Less previously billed',
    retainageHeldLabel: defaults?.retainageHeldLabel ?? 'Less retainage',
    vatLabel: defaults?.vatLabel ?? 'VAT',
    vatRatePercent: defaults?.vatRatePercent ?? '0',
  };

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Identity</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Template name" error={err('name')} required>
            <Input name="name" defaultValue={d.name} required />
          </Field>
          <Field label="Description" error={err('description')}>
            <Input name="description" defaultValue={d.description ?? ''} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={d.isDefault}
            className="h-4 w-4"
          />
          <span>Use as default template for new invoices</span>
        </label>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-3">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Section visibility
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(Object.keys(SECTION_LABEL) as Array<keyof typeof SECTION_LABEL>).map(
            (key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={Boolean(d[key as keyof typeof d] ?? true)}
                  className="h-4 w-4"
                />
                <span>{SECTION_LABEL[key]}</span>
              </label>
            ),
          )}
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">Layout</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Header layout">
            <Select name="headerLayout" defaultValue={d.headerLayout}>
              {headerLayoutValues.map((v) => (
                <option key={v} value={v}>
                  {HEADER_LAYOUT_LABEL[v]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Line item layout">
            <Select name="lineItemLayout" defaultValue={d.lineItemLayout}>
              {lineItemLayoutValues.map((v) => (
                <option key={v} value={v}>
                  {LINE_ITEM_LAYOUT_LABEL[v]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Standard text
        </legend>
        <TextareaField
          name="headerNote"
          label="Header note"
          rows={2}
          defaultValue={d.headerNote ?? ''}
        />
        <TextareaField
          name="paymentTermsText"
          label="Payment terms"
          rows={3}
          defaultValue={d.paymentTermsText ?? ''}
        />
        <TextareaField
          name="retainageText"
          label="Retainage block"
          rows={2}
          defaultValue={d.retainageText ?? ''}
        />
        <TextareaField
          name="notesText"
          label="Notes block"
          rows={2}
          defaultValue={d.notesText ?? ''}
        />
        <TextareaField
          name="footerText"
          label="Footer text"
          rows={2}
          defaultValue={d.footerText ?? ''}
        />
      </fieldset>

      {/* ========================================================== */}
      {/* Phase 1 additions: header overrides, project metadata,
          progress billing, VAT, banking, qualifications, history. */}
      {/* ========================================================== */}

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Header customisation
        </legend>
        <Field
          label="Title override (e.g. VAT Invoice, Progress Invoice, Request for Change Order)"
        >
          <Input
            name="titleOverride"
            defaultValue={d.titleOverride}
            placeholder="Leave blank to use 'Invoice'"
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="TIN label">
            <Input name="tinLabel" defaultValue={d.tinLabel} />
          </Field>
          <Field label="'Issued by' label">
            <Input name="issuedByLabel" defaultValue={d.issuedByLabel} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Bill-to extras
        </legend>
        <Field label="Bill-to attention label">
          <Input
            name="billToAttentionLabel"
            defaultValue={d.billToAttentionLabel}
          />
        </Field>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Project metadata block
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Purchase order label">
            <Input name="poNumberLabel" defaultValue={d.poNumberLabel} />
          </Field>
          <Field label="Billing number label">
            <Input
              name="billingNumberLabel"
              defaultValue={d.billingNumberLabel}
            />
          </Field>
          <Field
            label="Project description label"
            className="md:col-span-2"
          >
            <Input
              name="projectDescriptionLabel"
              defaultValue={d.projectDescriptionLabel}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Progress billing summary
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Block heading">
            <Input
              name="progressBillingLabel"
              defaultValue={d.progressBillingLabel}
            />
          </Field>
          <Field label="Total contract value label">
            <Input
              name="contractValueLabel"
              defaultValue={d.contractValueLabel}
            />
          </Field>
          <Field label="Approved change orders label">
            <Input
              name="changeOrdersLabel"
              defaultValue={d.changeOrdersLabel}
            />
          </Field>
          <Field label="Less-previously-billed label">
            <Input
              name="priorBilledLabel"
              defaultValue={d.priorBilledLabel}
            />
          </Field>
          <Field label="Less-retainage label" className="md:col-span-2">
            <Input
              name="retainageHeldLabel"
              defaultValue={d.retainageHeldLabel}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          VAT row
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="VAT label" error={err('vatLabel')}>
            <Input name="vatLabel" defaultValue={d.vatLabel} />
          </Field>
          <Field
            label="VAT rate (%)"
            error={err('vatRatePercent')}
          >
            <Input
              name="vatRatePercent"
              inputMode="decimal"
              defaultValue={String(d.vatRatePercent ?? '0')}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Wire / bank instructions
        </legend>
        <p className="text-xs text-slate-500">
          Bank details are pulled from the active company&apos;s settings.
          Configure them under <strong>Settings → Banking & TIN</strong>.
        </p>
        <TextareaField
          name="wireInstructionsNote"
          label="Wire instructions note (optional)"
          rows={2}
          defaultValue={d.wireInstructionsNote ?? ''}
        />
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Qualifications & exclusions
        </legend>
        <TextareaField
          name="qualificationsText"
          label="Qualifications text"
          rows={4}
          defaultValue={d.qualificationsText ?? ''}
        />
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Account history
        </legend>
        <Field label="Section heading">
          <Input
            name="accountHistoryLabel"
            defaultValue={d.accountHistoryLabel}
          />
        </Field>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? 'Saving…'
            : editId
              ? 'Save changes'
              : 'Save template'}
        </Button>
        <Link href="/invoice-templates">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  required,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
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
  defaultValue,
}: {
  name: string;
  label: string;
  rows: number;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}
