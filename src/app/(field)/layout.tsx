// Mobile-first layout for field employees. Sibling of (app)/layout.tsx,
// which is the desktop sidebar shell — this layout never imports it so
// /field routes get a clean, phone-sized chrome with bottom-tab nav and
// no admin chrome.
//
// Auth still required (middleware enforces). Once Phase M5 wraps the app
// in Capacitor, this same layout serves both phone-browser users and
// native shell users — Capacitor just renders the Next.js routes inside
// a WebView.

import { redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/active-company';
import { getActiveRole } from '@/lib/active-role';
import { getCurrentUser, isAuthEnabled, isDevDemoMode } from '@/lib/auth';
import { listMembershipsForUser } from '@/lib/data/memberships';
import { FieldBottomNav } from '@/modules/field/components/bottom-nav';
import { FieldHeader } from '@/modules/field/components/header';

export const dynamic = 'force-dynamic';

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authEnabled = isAuthEnabled();
  const demoMode = isDevDemoMode();
  const currentUser = await getCurrentUser();

  if (!authEnabled && !demoMode) redirect('/login' as never);
  if (authEnabled && !currentUser) redirect('/login' as never);

  if (authEnabled && currentUser) {
    const userMemberships = await listMembershipsForUser(currentUser.id);
    if (userMemberships.length === 0) redirect('/no-access' as never);
  }

  // Active role + company resolve through the same shared helpers as the
  // desktop layout. Field mode doesn't render a company switcher — most
  // field workers are single-company. Multi-company crews can still
  // switch by visiting the desktop URL.
  const company = await getActiveCompany();
  const role = await getActiveRole();

  return (
    // h-[100dvh] uses the dynamic viewport so mobile browsers' shrinking
    // address bars don't cause the bottom nav to jitter as the user
    // scrolls. Falls back to 100vh on older WebKit.
    <div className="flex flex-col h-[100dvh] bg-slate-50">
      <FieldHeader companyName={company.name} role={role} />

      {/* Scrollable content region. pb-24 leaves room for the fixed
          bottom-nav so content never hides behind it. */}
      <main className="flex-1 overflow-y-auto pb-24">{children}</main>

      <FieldBottomNav role={role} />
    </div>
  );
}
