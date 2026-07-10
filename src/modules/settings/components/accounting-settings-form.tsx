'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccountingAccountPicker } from '@/modules/accounting/components/accounting-account-picker';
import type { AccountingAccountOption } from '@/modules/accounting/lib/account-options';
import { CostCodePicker } from '@/modules/cost-codes/components/cost-code-picker';
import type { LaborCostCodeOption } from '@/lib/data/cost-codes';
import {
  updateAccountingSettingsAction,
  type AccountingSettingsState,
} from '../actions';
import type { Company } from '@/db/schema';

const initialState: AccountingSettingsState = {};

const SELECT_CLASS =
  'flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function AccountingSettingsForm({
  company,
  accounts,
  laborCostCodes,
}: {
  company: Company;
  accounts: AccountingAccountOption[];
  laborCostCodes: LaborCostCodeOption[];
}) {
  const [state, formAction, pending] = useActionState(
    updateAccountingSettingsAction,
    initialState,
  );
  const [laborCogsAccountId, setLaborCogsAccountId] = useState(
    company.laborCogsAccountId ?? '',
  );
  const [laborBurdenAccountId, setLaborBurdenAccountId] = useState(
    company.laborBurdenAccountId ?? '',
  );
  const err = (key: string) => state.errors?.[key]?.[0];

  return (
    <form action={formAction} className="space-y-6">
      {state.formError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          Saved. Reports and invoices reflect the new policy immediately.
        </div>
      )}

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Method & periods
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Accounting method"
            error={err('accountingMethod')}
            hint="Cash-basis P&L is still being wired up; accrual is fully supported today."
          >
            <select
              name="accountingMethod"
              defaultValue={company.accountingMethod}
              className={SELECT_CLASS}
            >
              <option value="accrual">Accrual (recognize when earned/billed)</option>
              <option value="cash">Cash (recognize when paid)</option>
            </select>
          </Field>
          <Field
            label="Fiscal year starts"
            error={err('fiscalYearStartMonth')}
            hint="Drives the default period boundaries on reports."
          >
            <select
              name="fiscalYearStartMonth"
              defaultValue={String(company.fiscalYearStartMonth)}
              className={SELECT_CLASS}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">VAT</legend>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="isVatActive"
            defaultChecked={company.isVatActive}
            className="mt-1 h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">
            <span className="font-medium">This company charges VAT</span>
            <span className="block text-xs text-slate-500">
              Off hides every VAT field, column, and report (e.g. a US company
              like Kraken). On shows VAT across invoices, banking, and reports.
            </span>
          </span>
        </label>
        <Field
          label="VAT rate %"
          error={err('vatRatePercent')}
          className="max-w-[12rem]"
          hint="Used to gross up invoices and split VAT on matched bank lines."
        >
          <Input
            name="vatRatePercent"
            inputMode="decimal"
            defaultValue={company.vatRatePercent}
          />
        </Field>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Retainage
        </legend>
        <Field
          label="Recognize held retainage as income…"
          error={err('retainageRevenueBasis')}
          hint="Controls when the held-back portion of an invoice hits the P&L Income line."
        >
          <select
            name="retainageRevenueBasis"
            defaultValue={company.retainageRevenueBasis}
            className={SELECT_CLASS}
          >
            <option value="billed">
              When released — exclude held retainage from income until you release
              it (current)
            </option>
            <option value="accrual">
              When billed — recognize the full contract value, including
              retainage, up front
            </option>
          </select>
        </Field>
        <Field
          label="Default retainage %"
          error={err('defaultRetainagePercent')}
          className="max-w-[12rem]"
          hint="Auto-fills new invoices when there's no prior invoice on the project to copy. 0 = none."
        >
          <Input
            name="defaultRetainagePercent"
            inputMode="decimal"
            defaultValue={company.defaultRetainagePercent}
          />
        </Field>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-lg p-4 space-y-4">
        <legend className="px-2 text-sm font-medium text-slate-700">
          Payroll posting
        </legend>
        <p className="text-xs text-slate-500">
          When you post a pay period to job costs, wages post to the labor
          account and employer burden (NIB) to a separate account. Both are
          required before a period can be posted.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Direct labor account (COGS)"
            error={err('laborCogsAccountId')}
            hint="Wages land here."
          >
            <AccountingAccountPicker
              name="laborCogsAccountId"
              value={laborCogsAccountId}
              onChange={setLaborCogsAccountId}
              accounts={accounts}
              placeholder="— Select labor account —"
            />
          </Field>
          <Field
            label="Payroll burden account"
            error={err('laborBurdenAccountId')}
            hint="Employer NIB / payroll taxes land here."
          >
            <AccountingAccountPicker
              name="laborBurdenAccountId"
              value={laborBurdenAccountId}
              onChange={setLaborBurdenAccountId}
              accounts={accounts}
              placeholder="— Select burden account —"
            />
          </Field>
        </div>
        <Field
          label="Default labor cost code"
          error={err('defaultLaborCostCodeId')}
          className="md:max-w-[24rem]"
          hint="Clock-posted hours on a job that carry no cost code fall back to this code so they land in job-cost labor instead of overhead. A per-project code (set on the project) overrides it. Leave blank for no fallback."
        >
          <CostCodePicker
            name="defaultLaborCostCodeId"
            defaultValue={company.defaultLaborCostCodeId ?? ''}
            options={laborCostCodes}
            emptyLabel="— No fallback (stay overhead) —"
            className={SELECT_CLASS}
          />
        </Field>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save accounting settings'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
