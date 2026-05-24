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
import { listMembersForCompany } from '@/lib/data/memberships';
import { requireAuth } from '@/lib/auth';
import { ReceiptForm } from '@/modules/receipts/components/receipt-form';
import { toAccountingAccountOptions } from '@/modules/accounting/components/accounting-account-picker';

export const dynamic = 'force-dynamic';

export default async function NewReceiptPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    redirect('/banking/receipts' as never);
  }
  const company = await getActiveCompany();
  const currentUser = await requireAuth();
  const [vendors, projects, costCodes, accountingAccounts, bankAccounts, members] =
    await Promise.all([
      listVendors(company.id),
      listProjects(company.id),
      listCostCodes(company.id),
      listAccountingAccounts(company.id),
      listBankAccounts(company.id),
      listMembersForCompany(company.id),
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
              label: p.name,
            }))}
            costCodes={costCodes.map((c) => ({
              id: c.id,
              label: `${c.code} — ${c.description}`,
            }))}
            accountingAccounts={toAccountingAccountOptions(
              accountingAccounts.filter(
                (a) => a.type !== 'bank' && a.type !== 'credit_card',
              ),
            )}
            bankAccounts={bankAccounts.map((b) => ({
              id: b.id,
              label: `${b.name} (${b.type === 'credit_card' ? 'CC' : 'Bank'})`,
            }))}
            members={members.map((m) => ({ id: m.userId, label: m.name }))}
            currentUserId={currentUser.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
