import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalcDebugToggle } from '@/components/calc-debug-toggle';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCalcDebug } from '@/lib/calc-debug';
import { canView, ROLE_LABELS } from '@/lib/permissions';
import { CompanySettingsForm } from '@/modules/settings/components/company-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const role = await getActiveRole();

  if (!canView(role, 'settings')) {
    return (
      <div className="p-8 max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">Company Settings</h1>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-2">
            <p>
              The active role{' '}
              <span className="font-medium">{ROLE_LABELS[role]}</span> cannot view
              company settings.
            </p>
            <p className="text-slate-500">
              Switch to <span className="font-medium">Owner / Admin</span> from the
              sidebar to edit settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const company = await getActiveCompany();
  const calcDebug = await getCalcDebug();

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Company Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Edit settings for the active company:{' '}
          <span className="font-medium text-slate-900">{company.name}</span>. Changes
          flow into proposal, change-order, and PO branding immediately.
        </p>
      </header>

      <Card>
        <CardContent className="p-6">
          <CompanySettingsForm company={company} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo & developer tools</CardTitle>
        </CardHeader>
        <CardContent>
          <CalcDebugToggle enabled={calcDebug} />
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Tip: switch the active company from the sidebar to edit a different company's
        settings. Each company keeps its own profile, financial defaults, and standard
        document language.
      </p>
    </div>
  );
}
