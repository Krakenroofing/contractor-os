// Field app home. Phase M1 lays down the structure with placeholder cards
// — Phase M2 wires Clock In/Out, M3 wires Today's Jobs, M4 wires Daily
// Report. Each card is a big thumb-target so even on a 4" screen the
// worker can hit it with gloves on.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveEmployee } from '@/lib/active-employee';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function FieldHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login' as never);
  const employee = await getActiveEmployee();

  const greetingName = employee
    ? employee.firstName
    : user.name?.split('@')[0] || 'there';

  // Today's date in a friendly format. Server-rendered (no useEffect /
  // hydration mismatch concerns) since this layout is force-dynamic.
  const today = new Date();
  const dateLine = today.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="px-4 py-5 space-y-5">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900">
          Hi {greetingName} 👋
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">{dateLine}</p>
      </section>

      {!employee && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            You&apos;re signed in, but no employee record is linked to this
            account.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Most field-app features need this link so your time and daily
            reports get credited correctly. Ask your administrator to link
            your account on the Invite Users page.
          </p>
        </div>
      )}

      {/* Phase M2 placeholder — Clock in/out card. Sized as the primary
          action on the screen (big, top-of-stack) because it's what a
          field worker opens the app to do most days. */}
      <ActionCard
        title="Clock in"
        subtitle="Coming in next update"
        tone="primary"
        disabled
      />

      {/* Phase M3 placeholder — Today's jobs. Smaller card. */}
      <ActionCard
        title="Today&apos;s jobs"
        subtitle="See where you&apos;re assigned"
        disabled
      />

      {/* Phase M4 placeholder — Daily report. Schema already exists; the
          mobile-friendly form is the M4 deliverable. */}
      <ActionCard
        title="Submit daily report"
        subtitle="Crew, scope, photos, work done"
        disabled
      />
    </div>
  );
}

function ActionCard({
  title,
  subtitle,
  tone = 'default',
  disabled = false,
  href,
}: {
  title: string;
  subtitle: string;
  tone?: 'default' | 'primary';
  disabled?: boolean;
  href?: string;
}) {
  const baseClasses =
    'block rounded-xl border px-5 py-5 transition active:scale-[0.99]';
  const toneClasses =
    tone === 'primary'
      ? 'border-blue-200 bg-blue-50'
      : 'border-slate-200 bg-white';
  const disabledClasses = disabled ? 'opacity-60' : 'hover:shadow-sm';

  const inner = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p
          className={
            'text-base font-semibold ' +
            (tone === 'primary' ? 'text-blue-900' : 'text-slate-900')
          }
        >
          {title}
        </p>
        <p
          className={
            'text-xs mt-0.5 ' +
            (tone === 'primary' ? 'text-blue-700' : 'text-slate-500')
          }
        >
          {subtitle}
        </p>
      </div>
      {disabled ? (
        <span className="text-[10px] uppercase tracking-wide rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500">
          Soon
        </span>
      ) : (
        <span
          className={
            tone === 'primary' ? 'text-blue-600' : 'text-slate-400'
          }
          aria-hidden
        >
          ›
        </span>
      )}
    </div>
  );

  if (disabled || !href) {
    return (
      <div className={`${baseClasses} ${toneClasses} ${disabledClasses}`}>
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={{ pathname: href }}
      className={`${baseClasses} ${toneClasses} ${disabledClasses}`}
    >
      {inner}
    </Link>
  );
}
