'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Crumbs, TreeBrowser } from '@/components/admin/category-picker';
import { ErrorBanner, Spinner, Tabs } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import {
  activityKindLabel,
  categoryKindLabel,
  pathText,
  STATUS_LABEL,
  STATUS_TONE,
  type ActivityRow,
  type ProfileRow,
  type TreeNode,
} from '@/lib/admin';
import { useData } from '@/lib/client/use-data';
import { recordingModeLabel } from '@/lib/labels';

type View = 'catalog' | 'profiles' | 'activities';

/** Admin Console home: browse the tree, list every profile and activity (latest version), start new ones. */
export function AdminHome() {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<View>((params.get('view') as View) ?? 'catalog');
  const tree = useData<{ items: TreeNode[] }>('/admin/catalog/tree');
  const profiles = useData<{ items: ProfileRow[] }>('/admin/catalog/profiles');
  const activities = useData<{ items: ActivityRow[] }>('/admin/catalog/activities');
  const [node, setNode] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'DRAFT' | 'PUBLISHED' | 'RETIRED'>('all');

  const nodes = tree.data?.items ?? [];
  const focused = nodes.find((n) => n.code === node);
  const subtree = useMemo(() => {
    if (!focused) return new Set<string>();
    const ids = new Set([focused.code]);
    for (const n of nodes)
      if (n.path.slice(0, focused.path.length).join('›') === focused.path.join('›')) ids.add(n.code);
    return ids;
  }, [focused, nodes]);

  const go = (v: View) => {
    setView(v);
    router.replace(`/admin?view=${v}`);
  };
  const keep = <T extends { name: string; status: string }>(rows: T[], where: (r: T) => string) =>
    rows.filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!q.trim() || `${r.name} ${where(r)}`.toLowerCase().includes(q.trim().toLowerCase())),
    );

  if (tree.error) return <ErrorBanner error={tree.error} />;
  if (!tree.data || !profiles.data || !activities.data) return <Spinner />;

  const newHere = (what: 'profiles' | 'activities') =>
    `/admin/${what}/new${focused ? `?category=${encodeURIComponent(focused.code)}` : ''}`;

  return (
    <div className="stack">
      <PageHeader
        title="Catalog admin"
        subtitle="Place profiles and activities in the catalog, edit them as drafts and publish. Published versions never change, so users' history stays valid."
        actions={
          <>
            <Link className="btn" href={newHere('activities')}>
              + New activity
            </Link>
            <Link className="btn btn-primary" href={newHere('profiles')}>
              + New profile
            </Link>
          </>
        }
      />
      <Tabs<View>
        value={view}
        onChange={go}
        options={[
          { value: 'catalog', label: 'Catalog tree' },
          { value: 'profiles', label: `Profiles (${profiles.data.items.length})` },
          { value: 'activities', label: `Activities (${activities.data.items.length})` },
        ]}
      />

      <DraftsWaiting profiles={profiles.data.items} activities={activities.data.items} />

      {view === 'catalog' && (
        <div className="admin-split">
          <Card title="Categories">
            <TreeBrowser
              tree={nodes}
              value={node}
              onPick={setNode}
              onFocusChange={setNode}
              pickLabel={null}
              onTreeChanged={tree.reload}
            />
          </Card>
          <div className="stack">
            {!focused ? (
              <Card>
                <Empty>Pick a category on the left to see what is placed there, or to add something new.</Empty>
              </Card>
            ) : (
              <>
                <Card title={<Crumbs path={focused.path} />} actions={<Badge>{categoryKindLabel(focused.kind)}</Badge>}>
                  <div className="row gap wrap">
                    <Link className="btn btn-primary btn-sm" href={newHere('profiles')}>
                      + New profile here
                    </Link>
                    <Link className="btn btn-sm" href={newHere('activities')}>
                      + New activity here
                    </Link>
                  </div>
                </Card>
                <ProfileList
                  title="Profiles in this branch"
                  rows={profiles.data.items.filter((p) => p.categoryCode && subtree.has(p.categoryCode))}
                />
                <ActivityList
                  title="Activities in this branch"
                  rows={activities.data.items.filter((a) =>
                    a.placements.some((p) =>
                      nodes.some((n) => subtree.has(n.code) && n.path.join('›') === p.join('›')),
                    ),
                  )}
                />
              </>
            )}
          </div>
        </div>
      )}

      {view !== 'catalog' && (
        <div className="row gap wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={view === 'profiles' ? 'Find a profile or sport…' : 'Find an activity…'}
            style={{ maxWidth: 360 }}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 170 }}>
            <option value="all">Any status</option>
            <option value="DRAFT">Drafts</option>
            <option value="PUBLISHED">Published</option>
            <option value="RETIRED">Retired</option>
          </select>
        </div>
      )}
      {view === 'profiles' && (
        <ProfileList title="All profiles" rows={keep(profiles.data.items, (r) => pathText(r.placement))} />
      )}
      {view === 'activities' && (
        <ActivityList
          title="All activities"
          rows={keep(activities.data.items, (r) => r.placements.map(pathText).join(' '))}
        />
      )}
    </div>
  );
}

function StatusBadge({
  row,
}: {
  row: { status: ProfileRow['status']; hasDraft: boolean; publishedVersion: number | null };
}) {
  return (
    <span className="row gap-sm">
      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
      {row.hasDraft && row.status !== 'DRAFT' && <Badge tone="warn">Draft open</Badge>}
    </span>
  );
}

function ProfileList({ title, rows }: { title: string; rows: ProfileRow[] }) {
  return (
    <Card title={`${title} · ${rows.length}`}>
      {rows.length === 0 ? (
        <Empty>No profiles here yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="ptable">
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '42%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Placed in</th>
                <th className="right">Activities</th>
                <th className="right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>
                    <Link className="pname" href={`/admin/profiles/${encodeURIComponent(r.code)}/${r.version}`}>
                      {r.name}
                    </Link>
                    <div className="phint">Version {r.version}</div>
                  </td>
                  <td>
                    <Crumbs path={r.placement} />
                  </td>
                  <td className="right">{r.activityCount}</td>
                  <td className="right">
                    <StatusBadge row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ActivityList({ title, rows }: { title: string; rows: ActivityRow[] }) {
  return (
    <Card title={`${title} · ${rows.length}`}>
      {rows.length === 0 ? (
        <Empty>No activities here yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="ptable">
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Placed in</th>
                <th>Used in</th>
                <th className="right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>
                    <Link className="pname" href={`/admin/activities/${encodeURIComponent(r.code)}/${r.version}`}>
                      {r.name}
                    </Link>
                    <div className="phint">
                      {activityKindLabel(r.kind)} · {recordingModeLabel(r.recordingMode)} · version {r.version}
                    </div>
                  </td>
                  <td>
                    {r.placements.length ? (
                      r.placements.map((p, i) => (
                        <div key={i}>
                          <Crumbs path={p} />
                        </div>
                      ))
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td className="small muted">
                    {r.usedBy.length === 0
                      ? '–'
                      : r.usedBy.length <= 2
                        ? r.usedBy.join(', ')
                        : `${r.usedBy.slice(0, 2).join(', ')} +${r.usedBy.length - 2}`}
                  </td>
                  <td className="right">
                    <StatusBadge row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Unfinished work first: every profile/activity whose latest version is a draft, with a link to continue. */
function DraftsWaiting({ profiles, activities }: { profiles: ProfileRow[]; activities: ActivityRow[] }) {
  const items = [
    ...profiles
      .filter((p) => p.status === 'DRAFT')
      .map((p) => ({
        kind: 'Profile',
        name: p.name,
        href: `/admin/profiles/${encodeURIComponent(p.code)}/${p.version}`,
        live: p.publishedVersion !== null,
        where: p.placement,
      })),
    ...activities
      .filter((a) => a.status === 'DRAFT')
      .map((a) => ({
        kind: 'Activity',
        name: a.name,
        href: `/admin/activities/${encodeURIComponent(a.code)}/${a.version}`,
        live: a.publishedVersion !== null,
        where: a.placements[0] ?? [],
      })),
  ];
  if (items.length === 0) return null;
  return (
    <Card title={`Drafts waiting to be published · ${items.length}`} className="drafts-card">
      <ul className="list">
        {items.map((i) => (
          <li key={i.href}>
            <div>
              <Link className="pname" href={i.href}>
                {i.name}
              </Link>
              <div className="phint">
                {i.kind}
                {i.where.length > 0 && <> · {pathText(i.where)}</>}
                {i.live ? ' · changes to a published version' : ' · not in the Catalog yet'}
              </div>
            </div>
            <Link className="btn btn-sm btn-primary" href={i.href}>
              Continue
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
