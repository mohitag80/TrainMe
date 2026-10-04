import { Badge, Logo } from '@/components/ui';
import { Nav } from '@/components/nav';
import { api, requireSession } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

/** Signed-in shell: navigation, user and plan; every page below requires a session. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const unread = await api<{ unread: number }>('/notifications?limit=1')
    .then((r) => r.unread)
    .catch(() => 0);
  const u = session.user;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <Nav isCurator={u.roles.includes('curator') || u.roles.includes('admin')} unread={unread} />
        <div className="sidebar-foot">
          <div>
            <div style={{ fontWeight: 700 }}>{u.name}</div>
            <div className="row gap small muted">
              {u.email} <Badge tone="brand">{u.plan}</Badge>
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
