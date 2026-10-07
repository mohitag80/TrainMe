import { Avatar, Badge, Logo } from '@/components/ui';
import { Nav } from '@/components/nav';
import { api, requireSession } from '@/lib/server/api';
import type { CoachingRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Signed-in shell: navigation, user and plan; every page below requires a session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [unread, me] = await Promise.all([
    api<{ unread: number }>('/notifications?limit=1')
      .then((r) => r.unread)
      .catch(() => 0),
    api<{ coachingRole?: CoachingRole; avatarUpdatedAt?: string | null }>('/profiles/me').catch(() => ({
      coachingRole: 'TECHNICAL' as const,
      avatarUpdatedAt: null,
    })),
  ]);
  const u = session.user;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <Nav
          isCurator={u.roles.includes('curator') || u.roles.includes('admin')}
          coachingRole={me.coachingRole ?? 'TECHNICAL'}
          unread={unread}
        />
        <div className="sidebar-foot">
          <div className="user-chip">
            <Avatar name={u.name} version={me.avatarUpdatedAt} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{u.name}</div>
              <div className="row gap small muted">
                {u.email} <Badge tone="brand">{u.plan}</Badge>
              </div>
            </div>
          </div>
          <form action="/bff/auth/logout" method="post">
            <button className="btn btn-sm btn-block" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
