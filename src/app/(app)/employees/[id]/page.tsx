import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getActiveCompanyId } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { canCreate } from '@/lib/permissions';
import { formatMoney } from '@/lib/money';
import { getEmployee } from '@/lib/data/employees';
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_TONE,
  type EmploymentType,
} from '@/modules/employees/schema';
import { ArchiveButton } from '@/modules/employees/components/archive-button';

export const dynamic = 'force-dynamic';

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const role = await getActiveRole();
  const allowEdit = canCreate(role, 'employees');

  const employee = await getEmployee(companyId, id);
  if (!employee) notFound();

  const employmentType = employee.employmentType as EmploymentType;
  const fullName = `${employee.firstName} ${employee.lastName}`.trim();

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Link href="/employees">
        <Button variant="outline" size="sm">
          ← Back to Employees
        </Button>
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-slate-900">{fullName}</h1>
            <Badge tone={EMPLOYMENT_TYPE_TONE[employmentType]}>
              {EMPLOYMENT_TYPE_LABEL[employmentType]}
            </Badge>
            {employee.active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="slate">Inactive</Badge>
            )}
            {employee.nibExempt && <Badge tone="amber">NIB exempt</Badge>}
            {employee.isSubcontractor && (
              <Badge tone="purple">Subcontractor</Badge>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {employee.nibExempt
              ? 'NIB exempt — no contributions withheld, excluded from C-10.'
              : employee.nibNumber
                ? `NIB ${employee.nibNumber}`
                : 'No NIB number on file'}
            {!employee.nibExempt && employee.nibStartDate && (
              <> · NIB from {employee.nibStartDate} (earlier weeks exempt)</>
            )}
          </p>
        </div>
        {allowEdit && (
          <div className="flex items-center gap-2">
            <Link href={`/employees/${employee.id}/edit`}>
              <Button variant="outline">Edit</Button>
            </Link>
            <ArchiveButton employeeId={employee.id} />
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Compensation
            </p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">
              {formatMoney(employee.payRate)}
              <span className="text-sm font-normal text-slate-500">
                {employmentType === 'hourly'
                  ? ' / hour'
                  : employmentType === 'salaried'
                    ? ' / week'
                    : ' / period'}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {employee.nibExempt
                ? 'NIB exempt — no contributions calculated for this employee.'
                : 'NIB ceiling $810/week · employee 4.65% · employer 6.65%'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Contact
            </p>
            <p className="text-sm text-slate-700">
              {employee.email ?? <span className="text-slate-400">No email</span>}
            </p>
            <p className="text-sm text-slate-700">
              {employee.phone ?? <span className="text-slate-400">No phone</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Hired
            </p>
            <p className="text-sm text-slate-700">
              {employee.hireDate ?? <span className="text-slate-400">Not recorded</span>}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Terminated
            </p>
            <p className="text-sm text-slate-700">
              {employee.terminationDate ?? (
                <span className="text-slate-400">Still employed</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {employee.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              Notes
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {employee.notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
