'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={{ pathname: href }}
      className={cn(
        'block rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-slate-900 text-white hover:bg-slate-800'
          : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      {label}
    </Link>
  );
}
