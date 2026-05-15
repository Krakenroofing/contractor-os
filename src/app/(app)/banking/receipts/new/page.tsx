import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listVendors } from '@/lib/data/vendors';
import { listProjects } from '@/lib/data/projects';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { ReceiptForm } from '@/modules/receipts/components/receipt-form';

export const dynamic = 'force-dynamic';

export default async function NewReceiptPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    redirect('/banking/receipts' as never);
  }
  const company = await getActiveCompany();
  const [vendors, projects, costCodes, accountingAccounts, bankAccounts] =
    await Promise.all([
      listVendors(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
      listAccountingAccounts(company.id),
      listBankAccounts(company.id),
    ]);

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
          New receipt
        </h1>
        <p className="text-sm text-slate-500">
          Save a draft first, then attach a photo / PDF and Post when ready.
          {company.isVatActive
            ? ' VAT is on — split is computed live.'
            : ' VAT is off for this company.'}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Receipt details</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceiptForm
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
          />
        </CardContent>
      </Card>
    </div>
  );
}
