import Link from 'next/link';
import { Fragment } from 'react';

export type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm text-slate-500"
    >
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {c.href && !isLast ? (
              <Link href={c.href} className="hover:text-slate-900 hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-slate-900 font-medium' : ''}>
                {c.label}
              </span>
            )}
            {!isLast && <span className="text-slate-300">/</span>}
          </Fragment>
        );
      })}
    </nav>
  );
}
