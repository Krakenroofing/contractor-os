import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canView } from '@/lib/permissions';
import { listCustomers } from '@/lib/data/customers';
import { BACKFILL_CUTOFF_ISO } from '@/modules/backfill/lib/backfill';
import { CustomerMiniForm } from '@/modules/backfill/components/customer-mini-form';
import { StepShell } from '@/modules/backfill/components/step-shell';

export const dynamic = 'force-dynamic';

const CUTOFF = new Date(`${BACKFILL_CUTOFF_ISO}T00:00:00Z`);

export default async function BackfillCustomersPage() {
  const role = await getActiveRole();
  if (!canView(role, 'backfill')) redirect('/dashboard');
  const companyId = await getActiveCompanyId();
  const customers = await listCustomers(companyId);
  const recent = customers.filter((c) => c.createdAt.getTime() >= CUTOFF.getTime());

  return (
    <StepShell step="customers" nextHref="/backfill/projects">
      <Card>
        <CardHeader>
          <CardTitle>Add a customer</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerMiniForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Customers entered ({recent.length})</CardTitle>
            <Link href={{ pathname: '/customers' }} className="text-sm text-slate-500 hover:underline">
              Full directory →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No customers backfilled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((c) => (
                <li
                  key={c.id}
                  className="py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {c.customerType === 'commercial' ? 'Commercial' : 'Residential'}
                      {c.primaryContactName ? ` · ${c.primaryContactName}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{c.createdAt.toISOString().slice(0, 10)}</Badge>
                    <Link
                      href={{ pathname: `/customers/${c.id}` }}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </StepShell>
  );
}
