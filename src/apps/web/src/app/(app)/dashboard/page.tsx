import Link from 'next/link';
import { Badge, Card, Empty, PageHeader, Stat } from '@/components/ui';
import { api, requireSession } from '@/lib/server/api';
import type { Profile, Session, TrackerSummary } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

type Streak = { trackerId: string; currentDays: number; longestDays: number; lastActive: string | null };
type Pr = { trackerId: string; activityCode: string; metricKey: string; bestValue: number; achievedAt: string };

export default async function Dashboard() {
  const session = await requireSession();
  const [profile, trackers, streaks, records] = await Promise.all([
    api<Profile>('/profiles/me'),
    api<{ items: TrackerSummary[] }>('/trackers'),
    api<{ items: Streak[] }>('/analytics/streaks').catch(() => ({ items: [] })),
    api<{ items: Pr[] }>('/analytics/records').catch(() => ({ items: [] })),
  ]);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const todays = await api<{ items: Session[] }>(`/sessions?date=${today}`).catch(() => ({ items: [] }));
  const byId = new Map(trackers.items.map((t) => [t.id, t]));
  const best = Math.max(0, ...streaks.items.map((s) => s.currentDays));

  return (
    <div className="stack">
      <PageHeader
        title={`Hi ${profile.displayName.split(' ')[0]} 👋`}
        subtitle={`${today} · ${profile.timezone}`}
        actions={
          <Link className="btn btn-primary" href="/catalog">
            + New tracker
          </Link>
        }
      />
      <div className="stats">
        <Stat label="Trackers" value={trackers.items.filter((t) => t.status === 'ACTIVE').length} />
        <Stat label="Sessions today" value={todays.items.length} />
        <Stat label="Best streak" value={`${best} day${best === 1 ? '' : 's'}`} />
        <Stat label="Plan" value={session.user.plan} hint={<Link href="/subscription">Change plan</Link>} />
      </div>

      <div className="grid-2">
        <Card title="My trackers">
          {trackers.items.length === 0 ? (
            <Empty>
              No trackers yet. <Link href="/catalog">Pick a profile</Link> such as Fast Bowler or Push Day.
            </Empty>
          ) : (
            <ul className="list">
              {trackers.items.map((t) => (
                <li key={t.id}>
                  <div>
                    <Link href={`/trackers/${t.id}`} style={{ fontWeight: 700 }}>
                      {t.displayName}
                    </Link>
                    <div className="small muted">
                      {t.templateCode ?? 'custom'} · schema v{t.schemaVersion}
                    </div>
                  </div>
                  <div className="row gap">
                    {t.upgradeAvailable && <Badge tone="warn">Update</Badge>}
                    {t.status === 'ARCHIVED' ? (
                      <Badge>Archived</Badge>
                    ) : (
                      <Link className="btn btn-sm" href={`/trackers/${t.id}?start=1`}>
                        Start
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Today"
          actions={
            <Link className="btn btn-sm" href="/sessions">
              All sessions
            </Link>
          }
        >
          {todays.items.length === 0 ? (
            <Empty>No sessions yet today.</Empty>
          ) : (
            <ul className="list">
              {todays.items.map((s) => (
                <li key={s.id}>
                  <div>
                    <Link href={`/sessions/${s.id}`} style={{ fontWeight: 700 }}>
                      {s.name}
                    </Link>
                    <div className="small muted">
                      {byId.get(s.trackerId)?.displayName ?? 'Tracker'} · {s.entryCount} entries
                    </div>
                  </div>
                  <Badge tone={s.status === 'COMPLETED' ? 'ok' : 'brand'}>
                    {s.status === 'IN_PROGRESS' ? 'Live' : 'Done'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent personal bests">
        {records.items.length === 0 ? (
          <Empty>Complete a session to set your first personal best.</Empty>
        ) : (
          <ul className="list">
            {records.items.slice(0, 6).map((r) => (
              <li key={`${r.trackerId}${r.activityCode}${r.metricKey}`}>
                <div>
                  <strong>{r.metricKey.replaceAll('_', ' ')}</strong>
                  <div className="small muted">
                    {byId.get(r.trackerId)?.displayName ?? ''} · {r.activityCode}
                  </div>
                </div>
                <div className="row gap">
                  <strong>{Math.round(r.bestValue * 100) / 100}</strong>
                  <span className="small muted">{r.achievedAt.slice(0, 10)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
