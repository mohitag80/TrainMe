'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  catalog: 'M4 6h16M4 12h16M4 18h10',
  charts: 'M4 4v16h16M8 15l3.5-4 3 3L20 7',
  trainers: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  coaching:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  sessions: 'M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  notifications: 'M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  subscription: 'M3 10h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  admin: 'M12 3l8 4v5c0 5-3.4 8.7-8 9-4.6-.3-8-4-8-9V7l8-4z',
};

/** Charts live under /trackers/{id}/charts, so that path highlights "Charts" rather than nothing. */
const isActive = (path: string, href: string) =>
  href === '/charts' ? path === '/charts' || /^\/trackers\/[^/]+\/charts/.test(path) : path.startsWith(href);

export function Nav({
  isCurator,
  isTrainer,
  canCoach,
  unread,
}: {
  isCurator: boolean;
  isTrainer: boolean;
  /** Technical accounts (admin, curator, support) have no coaching menu at all. */
  canCoach: boolean;
  unread: number;
}) {
  const path = usePathname();
  const items = [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/catalog', label: 'Catalog', icon: 'catalog' },
    { href: '/sessions', label: 'Sessions', icon: 'sessions' },
    { href: '/charts', label: 'Charts', icon: 'charts' },
    ...(canCoach ? [{ href: '/trainers', label: 'My trainers', icon: 'trainers' }] : []),
    ...(isTrainer ? [{ href: '/coaching', label: 'Coaching', icon: 'coaching' }] : []),
    { href: '/notifications', label: 'Inbox', icon: 'notifications', count: unread },
    { href: '/profile', label: 'Profile', icon: 'profile' },
    { href: '/subscription', label: 'Plan', icon: 'subscription' },
    ...(isCurator ? [{ href: '/admin', label: 'Admin', icon: 'admin' }] : []),
  ];
  return (
    <nav className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={isActive(path, i.href) ? 'active' : ''}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={ICONS[i.icon]} />
          </svg>
          {i.label}
          {i.count ? <span className="count">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
