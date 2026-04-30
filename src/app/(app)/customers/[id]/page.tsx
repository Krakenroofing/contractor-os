import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { getMockCustomer, listMockProjects } from '@/lib/mock-store';
import type { Customer } from '@/db/schema';

export const dynamic = 'force-dynamic';

const TYPE_TONE: Record<Customer['customerType'], 'slate' | 'blue'> = {
  residential: 'slate',
  commercial: 'blue',
};

const TYPE_LABEL: Record<Customer['customerType'], string> = {
  residential: 'Residential',
  commercial: 'Commercial',
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowCreate = canCreate(role, 'customers');
  const customer = getMockCustomer(companyId, id);
  if (!customer) notFound();

  const billingAddress = [
    customer.billingAddressLine1,
    customer.billingCity,
    customer.billingState,
    customer.billingPostalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const linkedProjects = listMockProjects(companyId).filter(
    (p) => p.customerId === customer.id,
  );

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      <Breadcrumbs
        items={[
          { href: '/customers', label: 'Customers' },
          { label: customer.name },
        ]}
      />

      <div className="flex items-center justify-between">
        <Link href="/customers">
          <Button variant="outline" size="sm">
            ← Back to Customers
          </Button>
        </Link>
        {allowCreate && (
          <Link href="/customers/new">
            <Button size="sm">New Customer</Button>
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{customer.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            {customer.primaryContactName && <span>{customer.primaryContactName}</span>}
            {customer.email && <span className="text-slate-400">·</span>}
            {customer.email && <span>{customer.email}</span>}
            {customer.phone && <span className="text-slate-400">·</span>}
            {customer.phone && <span>{customer.phone}</span>}
          </div>
        </div>
        <Badge tone={TYPE_TONE[customer.customerType]}>
          {TYPE_LABEL[customer.customerType]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Company name" value={customer.name} />
            <Row label="Primary contact" value={customer.primaryContactName ?? '—'} />
            <Row label="Email" value={customer.email ?? '—'} />
            <Row label="Phone" value={customer.phone ?? '—'} />
            <Row label="Type" value={TYPE_LABEL[customer.customerType]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {billingAddress ? (
              <div className="space-y-1">
                {customer.billingAddressLine1 && (
                  <div className="text-slate-900">{customer.billingAddressLine1}</div>
                )}
                {(customer.billingCity ||
                  customer.billingState ||
                  customer.billingPostalCode) && (
                  <div className="text-slate-700">
                    {[
                      customer.billingCity,
                      customer.billingState,
                      customer.billingPostalCode,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-500">No billing address on file</span>
            )}
          </CardContent>
        </Card>
      </div>

      {customer.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{customer.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Projects ({linkedProjects.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {linkedProjects.length === 0 ? (
            <span className="text-slate-500">No projects yet for this customer.</span>
          ) : (
            <ul className="divide-y divide-slate-100">
              {linkedProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-mono text-xs text-slate-500">{p.number}</div>
                    <div className="text-slate-900">{p.name}</div>
                  </div>
                  <Link href={`/projects/${p.id}`}>
                    <Button size="sm" variant="outline">
                      View Project
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  );
}
