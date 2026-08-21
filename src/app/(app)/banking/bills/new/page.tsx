import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { listVendors } from '@/lib/data/vendors';
import { listPaymentMethods } from '@/lib/data/payment-methods';
import { listProjects } from '@/lib/data/projects';
import { listCustomers } from '@/lib/data/customers';
import { listCostCodes } from '@/lib/data/cost-codes';
import { listAccountingAccounts } from '@/lib/data/accounting-accounts';
import { listBankAccounts } from '@/lib/data/bank-accounts';
import { listMembersForCompany } from '@/lib/data/memberships';
import { requireAuth } from '@/lib/auth';
import { ReceiptForm } from '@/modules/receipts/components/receipt-form';
import { toAccountingAccountOptions } from '@/modules/accounting/lib/account-options';

export const dynamic = 'force-dynamic';

// QB-style "Add Bill": an amount the company OWES that hasn't moved through
// any account yet. Same engine as receipts (bills ARE receipts) — this
// surface just presents it bill-first: bill date + due date + the vendor's
// invoice number, defaulting to unpaid (Bank) so posting puts it on
// Accounts Payable where it stays an outstanding bill until the bank
// payment is matched. Expenses that already happened (cash or a specific
// card charge) belong on New receipt instead.
export default async function NewBillPage() {
  const role = await getActiveRole();
  if (!canCreate(role, 'receipts')) {
    redirect('/banking' as never);
  }
  const company = await getActiveCompany();
  const currentUser = await requireAuth();
  const [
    vendors,
    projects,
    customers,
    costCodes,
    accountingAccounts,
    bankAccounts,
    members,
  ] = await Promise.all([
    listVendors(company.id),
    listProjects(company.id),
    listCustomers(company.id),
    listCostCodes(company.id),
    listAccountingAccounts(company.id),
    listBankAccounts(company.id),
    listMembersForCompany(company.id),
  ]);
  const paymentMethodOptions = (await listPaymentMethods(company.id)).map(
    (m) => ({ id: m.id, name: m.name }),
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={{ pathname: '/banking/receipts' }}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← Back to Receipts &amp; Bills
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 mt-1">New bill</h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          An amount owed that hasn&apos;t hit any account yet. Enter the
          vendor&apos;s invoice, post it, and it sits in outstanding bills
          (Accounts Payable) until you match the bank payment. Billing a
          purchase order? Use &ldquo;Create bill&rdquo; on the PO instead —
          it prefills the lines.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Bill details</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceiptForm
            mode="bill"
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
            customers={customers.map((c) => ({ id: c.id, name: c.name }))}
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
            paymentMethods={paymentMethodOptions}
            members={members.map((m) => ({ id: m.userId, label: m.name }))}
            currentUserId={currentUser.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
