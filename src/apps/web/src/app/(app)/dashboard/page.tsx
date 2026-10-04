import Link from 'next/link';
import { Badge, Card, Empty, PageHeader, Stat } from '@/components/ui';
import { humanize } from '@/lib/labels';
import { api, requireSession } from '@/lib/server/api';
import type { Profile, Session, TrackerSummary } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

type Streak = { trackerId: string; currentDays: number; longestDays: number; lastActive: string | null };
type Pr = { trackerId: string; activityCode: string; metricKey: string; bestValue: number; achievedAt: string };

const SPORT_ICONS: [string, string][] = [
  ['cricket', '🏏'],
  ['tennis', '🎾'],
  ['badminton', '🏸'],
  ['football', '⚽'],
  ['athletics', '🏃'],
  ['gym', '🏋️'],
  ['cond', '💪'],
  ['body', '⚖️'],
];
const iconFor = (code: string | null) => SPORT_ICONS.find(([k]) => code?.startsWith(k))?.[1] ?? '📋';
const profileName = (code: string | null) => (code ? humanize(code.split('.').pop() ?? code) : 'Your own tracker');
/** PR values are in canonical units; the speed and weight units are implied by the metric key. */
const unitHint = (key: string) =>
  key.includes('speed') ? ' km/h' : key.endsWith('_kg') ? ' kg' : key.endsWith('_s') ? ' s' : '';

export default async function Dashboard() {
  const session = await requireSession();
  const [profile, trackers, streaks, records] = await Promise.all([
    api<Profile>('/profiles/me'),
    api<{ items: TrackerSummary[] }>('/trackers'),
    api<{ items: Streak[] }>('/analytics/streaks').catch(() => ({ items: [] })),
    api<{ items: Pr[] }>('/analytics/records').catch(() => ({ items: [] })),
  ]);
  const tz = profile.timezone && profile.timezone !== 'UTC' ? profile.timezone : undefined;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const todayLong = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const todays = await api<{ items: Session[] }>(`/sessions?date=${today}`).catch(() => ({ items: [] }));
  const active = trackers.items.filter((t) => t.status === 'ACTIVE');
  const byId = new Map(trackers.items.map((t) => [t.id, t]));
  const best = Math.max(0, ...streaks.items.map((s) => s.currentDays));
  const live = todays.items.find((s) => s.status === 'IN_PROGRESS');

  return (
    <div className="stack">
      <PageHeader
        title={`Hi ${profile.displayName.split(' ')[0]} 👋`}
        subtitle={todayLong}
        actions={
          <Link className="btn btn-primary" href="/catalog">
            + New tracker
          </Link>
        }
      />

      {live && (
        <div className="hero">
          <div className="row between wrap gap">
            <div>
              <h2 style={{ color: '#fff' }}>Session in progress: {live.name}</h2>
              <p className="hero-sub">
                {byId.get(live.trackerId)?.displayName} · {live.entryCount}{' '}
                {live.entryCount === 1 ? 'entry' : 'entries'} so far
              </p>
            </div>
            <Link className="btn btn-light btn-lg" href={`/sessions/${live.id}`}>
              Continue
            </Link>
          </div>
        </div>
      )}

      <div className="stats">
        <Stat label="Active trackers" value={active.length} />
        <Stat label="Sessions today" value={todays.items.length} />
        <Stat label="Current streak" value={`${best} ${best === 1 ? 'day' : 'days'}`} />
        <Stat
          label="Plan"
          value={session.user.plan.charAt(0) + session.user.plan.slice(1).toLowerCase()}
          hint={<Link href="/subscription">See plans</Link>}
        />
      </div>

      <div className="grid-2">
        <Card title="My trackers">
          {active.length === 0 ? (
            <Empty>
              No trackers yet. <Link href="/catalog">Pick a profile</Link> such as Fast Bowler or Push Day.
            </Empty>
          ) : (
            active.map((t) => (
              <div key={t.id} className="tracker-tile">
                <div className="icon-badge">{iconFor(t.templateCode)}</div>
                <div>
                  <Link href={`/trackers/${t.id}`} style={{ fontWeight: 700 }}>
                    {t.displayName}
                  </Link>
                  <div className="small muted">
                    {profileName(t.templateCode)}
                    {t.upgradeAvailable ? ' · update available' : ''}
                  </div>
                </div>
                <div className="row gap-sm">
                  <Link className="btn btn-sm btn-ghost" href={`/trackers/${t.id}/charts`}>
                    📈 Charts
                  </Link>
                  <Link className="btn btn-sm" href={`/trackers/${t.id}?start=1`}>
                    ▶ Start
                  </Link>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card
          title="Today"
          actions={
            <Link className="btn btn-sm btn-ghost" href="/sessions">
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
                      {byId.get(s.trackerId)?.displayName ?? 'Tracker'} ·{' '}
                      {new Date(s.startedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: s.timezone || tz,
                      })}{' '}
                      · {s.entryCount} {s.entryCount === 1 ? 'entry' : 'entries'}
                    </div>
                  </div>
                  <Badge tone={s.status === 'COMPLETED' ? 'ok' : 'brand'}>
                    {s.status === 'IN_PROGRESS' ? 'In progress' : 'Done'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Personal bests">
        {records.items.length === 0 ? (
          <Empty>No personal bests yet. They come from measurements such as top speed or heaviest lift.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Best</th>
                  <th>Tracker</th>
                  <th className="right">Value</th>
                  <th className="right">When</th>
                </tr>
              </thead>
              <tbody>
                {records.items.slice(0, 8).map((r) => (
                  <tr key={`${r.trackerId}${r.activityCode}${r.metricKey}`}>
                    <td className="pname">🏆 {humanize(r.metricKey)}</td>
                    <td className="muted">{byId.get(r.trackerId)?.displayName ?? ''}</td>
                    <td className="right" style={{ fontWeight: 800 }}>
                      {Math.round(r.bestValue * 10) / 10}
                      {unitHint(r.metricKey)}
                    </td>
                    <td className="right muted">
                      {new Date(r.achievedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
