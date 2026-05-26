'use client';

// Fixed bottom tab bar — thumb reach. Five icons max (HIG / Material both
// caution against more). M1 ships three: Home, Reports, Profile. M2 adds
// Clock; M3 adds Jobs. The icons are inline SVGs to avoid pulling in an
// icon library just for five glyphs.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/permissions';

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const ITEMS: Item[] = [
  {
    href: '/field',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path
          d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2v-9z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: '/field/profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
        <path
          d="M12 12a4 4 0 100-8 4 4 0 000 8z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M4 21a8 8 0 0116 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function FieldBottomNav({ role: _role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={{ pathname: item.href }}
                // 56px min height matches Apple HIG and Material guidance
                // for touch targets. text-[11px] keeps the label readable
                // on small phones without crowding the icon.
                className={
                  'flex flex-col items-center justify-center gap-0.5 min-h-[56px] py-2 ' +
                  (active
                    ? 'text-slate-900'
                    : 'text-slate-500 hover:text-slate-700')
                }
              >
                <span className={active ? 'text-blue-600' : ''}>
                  {item.icon}
                </span>
                <span className="text-[11px] font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
