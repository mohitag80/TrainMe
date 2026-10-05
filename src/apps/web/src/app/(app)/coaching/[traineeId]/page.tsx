'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBanner, Spinner, Tabs } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { friendlyTime } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Session } from '@/lib/types';

type Item = { kind: 'metric' | 'param'; key: string; label: string; percent: boolean; unit: string | null };
type TrackerInfo = {
  trackerId: string;
  sessions: number;
  lastDate: string;
  activities: {
    code: string;
    name: string;
    metrics: { key: string; label: string; kind: string; display: { format: string; unit?: string } }[];
    params: { key: string; label: string; unit: string | null }[];
  }[];
};
type Point = { period: string; value: number | null; num?: number | null; den?: number | null; sessionCount: number };

/**
 * One trainee as their trainer sees them (FR-COA-08): only sessions where this trainer was assigned, and charts
 * computed from those sessions alone – never the trainee's other trainers or solo sessions.
 */
export default function TraineePage() {
  const { traineeId } = useParams<{ traineeId: string }>();
  const names = useData<{ items: { id: string; displayName: string }[] }>(`/profiles/names?ids=${traineeId}`);
  const sessions = useData<{ items: Session[] }>(`/sessions/coaching?traineeId=${traineeId}`);
  const trackers = useData<{ items: TrackerInfo[] }>(`/analytics/coaching/trainees/${traineeId}/trackers`);
  const [trackerId, setTrackerId] = useState<string>();
  const [activityCode, setActivityCode] = useState<string>();
  const [itemKey, setItemKey] = useState<string>();
  const [granularity, setGranularity] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');

  const tracker = trackers.data?.items.find((t) => t.trackerId === trackerId) ?? trackers.data?.items[0];
  const activity = tracker?.activities.find((a) => a.code === activityCode) ?? tracker?.activities[0];
  const items: Item[] = useMemo(
    () =>
      activity
        ? [
            ...activity.metrics.map((m) => ({
              kind: 'metric' as const,
              key: m.key,
              label: m.label,
              percent: m.display.format === 'PERCENT',
              unit: m.display.unit ?? null,
            })),
            ...activity.params.map((p) => ({
              kind: 'param' as const,
              key: p.key,
              label: `${p.label} (average)`,
              percent: false,
              unit: p.unit,
            })),
          ]
        : [],
    [activity],
  );
  const item = items.find((i) => `${i.kind}:${i.key}` === itemKey) ?? items[0];
  const series = useData<{ points: Point[] }>(
    tracker && activity && item
      ? `/analytics/coaching/series?traineeId=${traineeId}&trackerId=${tracker.trackerId}&activity=${encodeURIComponent(activity.code)}&${item.kind}=${item.key}&granularity=${granularity}`
      : null,
  );

  const name = names.data?.items[0]?.displayName ?? 'Trainee';
  if (sessions.error) return <ErrorBanner error={sessions.error} />;
  if (!sessions.data || !trackers.data) return <Spinner />;
  const data = (series.data?.points ?? []).map((p) => ({
    ...p,
    shown: p.value === null ? null : item?.percent ? Math.round(p.value * 1000) / 10 : Math.round(p.value * 100) / 100,
  }));

  return (
    <div className="stack">
      <nav className="crumbs">
        <Link href="/coaching">Coaching</Link> <span>›</span> {name}
      </nav>
      <PageHeader
        title={name}
        subtitle="Only sessions where you were the trainer – their other sessions stay private."
      />

      <Card
        title="Progress in your sessions"
        actions={
          <Tabs
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: 'DAY', label: 'Daily' },
              { value: 'WEEK', label: 'Weekly' },
              { value: 'MONTH', label: 'Monthly' },
            ]}
          />
        }
      >
        {!tracker || !activity || !item ? (
          <Empty>Charts appear after the first completed session with you.</Empty>
        ) : (
          <>
            <div className="row gap wrap" style={{ marginBottom: 12 }}>
              {trackers.data.items.length > 1 && (
                <select
                  value={tracker.trackerId}
                  onChange={(e) => setTrackerId(e.target.value)}
                  className="wide-select"
                  aria-label="Tracker"
                >
                  {trackers.data.items.map((t) => (
                    <option key={t.trackerId} value={t.trackerId}>
                      {t.activities[0]?.name ?? 'Tracker'} – {t.sessions} sessions
                    </option>
                  ))}
                </select>
              )}
              <select
                value={activity.code}
                onChange={(e) => setActivityCode(e.target.value)}
                className="wide-select"
                aria-label="Activity"
              >
                {tracker.activities.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={`${item.kind}:${item.key}`}
                onChange={(e) => setItemKey(e.target.value)}
                className="wide-select"
                aria-label="Stat"
              >
                {items.map((i) => (
                  <option key={`${i.kind}:${i.key}`} value={`${i.kind}:${i.key}`}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            {data.every((p) => p.shown === null) ? (
              <Empty>
                No “{item.label}” in your sessions with {name} yet – pick another stat above.
              </Empty>
            ) : (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#eef0f6" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit={item.percent ? '%' : ''} />
                    <Tooltip
                      formatter={(v) => [`${v}${item.percent ? ' %' : item.unit ? ` ${item.unit}` : ''}`, item.label]}
                      labelFormatter={(l) => `${l}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="shown"
                      stroke="#7c3aed"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="small muted">
              Built from {data.reduce((n, p) => n + p.sessionCount, 0)} of your sessions with {name}. Ratios are totals
              ÷ attempts across those sessions.
            </p>
          </>
        )}
      </Card>

      <Card title={`Sessions with you · ${sessions.data.items.length}`}>
        {sessions.data.items.length === 0 ? (
          <Empty>No sessions with you yet. When {name} starts one and picks you, it appears here.</Empty>
        ) : (
          <ul className="list">
            {sessions.data.items.map((s) => (
              <li key={s.id}>
                <div>
                  <Link className="pname" href={`/sessions/${s.id}`}>
                    {s.name}
                  </Link>
                  <div className="phint">
                    {friendlyTime(s.startedAt)} · {s.entryCount} {s.entryCount === 1 ? 'entry' : 'entries'}
                  </div>
                </div>
                <Badge tone={s.status === 'IN_PROGRESS' ? 'brand' : 'ok'}>
                  {s.status === 'IN_PROGRESS' ? 'Live' : 'Done'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
