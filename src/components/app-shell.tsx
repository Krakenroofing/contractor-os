'use client';

import { useState } from 'react';
import { SIDEBAR_COOKIE } from '@/lib/sidebar-cookie';

/**
 * Office shell with a collapsible left sidebar.
 *
 * The collapsed flag lives in a plain document cookie rather than
 * localStorage so the server can render the right shell on the first paint —
 * no expanded-then-snap-shut flash on every navigation. The sidebar itself is
 * server-rendered (permissions, company list) and handed in as a prop.
 *
 * Collapsed still reserves a slim rail rather than hiding outright: nav
 * labels here are text, not icons, so a narrow icon rail would be useless,
 * and a floating overlay button would sit on top of page content.
 */
export function AppShell({
  sidebar,
  defaultCollapsed,
  children,
}: {
  sidebar: React.ReactNode;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? '1' : '0'}; path=/; max-age=${
        60 * 60 * 24 * 365
      }; samesite=lax`;
    } catch {
      /* cookies blocked — the toggle still works for this page view */
    }
  };

  if (collapsed) {
    return (
      <div className="flex min-h-screen">
        <div className="w-10 shrink-0 border-r border-slate-200 bg-white flex flex-col items-center py-4 print:hidden">
          <button
            type="button"
            onClick={toggle}
            aria-label="Show menu"
            aria-expanded={false}
            title="Show menu"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronsRight />
          </button>
        </div>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col print:hidden">
        <div className="flex items-center justify-end px-2 pt-2">
          <button
            type="button"
            onClick={toggle}
            aria-label="Hide menu"
            aria-expanded
            title="Hide menu"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronsLeft />
          </button>
        </div>
        {sidebar}
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function ChevronsLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m11 17-5-5 5-5" />
      <path d="m18 17-5-5 5-5" />
    </svg>
  );
}

function ChevronsRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </svg>
  );
}
