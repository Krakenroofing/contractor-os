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
  type CreateInvoiceTemplateState,
} from '../actions';
import type { InvoiceTemplate } from '@/db/schema';

const initialState: CreateInvoiceTemplateState = {};

type Defaults = Partial<InvoiceTemplate> & { name?: string };

export function InvoiceTemplateForm({ defaults }: { defaults?: Defaults }) {
  const [state, formAction, pending] = useActionState(
    createInvoiceTemplateAction,
    initialState,
  );
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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
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
