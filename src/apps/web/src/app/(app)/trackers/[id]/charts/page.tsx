'use client';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UnitPreferences } from '@trainme/units';
import { ErrorBanner, Spinner, Tabs } from '@/components/client-ui';
import { Card, Empty, PageHeader } from '@/components/ui';
import { displayUnitFor, formatMetric, todayLocal, units } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Profile, TrackerDetail, TrackerSchema, TrackerSummary } from '@/lib/types';

type Point = {
  period: string;
  value: number | null;
  num?: number | null;
  den?: number | null;
  count?: number;
  sessionCount: number;
};
type Day = {
  sessions: {
    sessionId: string;
    name: string;
    startedAt: string;
    metrics: Record<string, { num: number | null; den: number | null; value: number | null }>;
  }[];
};

/** FR-ANL-01/02/08/11: series from rollups; ratios show "num of den"; units follow the user's choice. */
export default function ChartsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tracker = useData<TrackerDetail>(`/trackers/${id}`);
  const all = useData<{ items: TrackerSummary[] }>('/trackers');
  const others = (all.data?.items ?? []).filter((t) => t.status === 'ACTIVE');
  const schema = useData<TrackerSchema>(`/trackers/${id}/schema`);
  const profile = useData<Profile>('/profiles/me');
  const activities = (schema.data?.activities ?? []).filter((a) => !a.hidden);
  const [activityCode, setActivityCode] = useState<string>();
  const activity = activities.find((a) => a.code === activityCode) ?? activities[0];
  const items = useMemo(
    () =>
      activity
        ? [
            ...activity.metrics
              .filter((m) => !m.hidden)
              .map((m) => ({ id: `metric:${m.key}`, label: m.label, kind: 'metric' as const, key: m.key })),
            ...activity.parameters
              .filter((p) => !p.hidden && ['INT', 'DECIMAL', 'DURATION'].includes(p.type))
              .map((p) => ({
                id: `param:${p.key}`,
                label: `${p.label} (average)`,
                kind: 'param' as const,
                key: p.key,
              })),
          ]
        : [],
    [activity],
  );
  const [itemId, setItemId] = useState<string>();
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const [granularity, setGranularity] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');
  const series = useData<{ points: Point[] }>(
    activity && item
      ? `/analytics/series?trackerId=${id}&activity=${encodeURIComponent(activity.code)}&${item.kind}=${item.key}&granularity=${granularity}${item.kind === 'param' ? '&agg=AVG' : ''}`
      : null,
  );
  const [date, setDate] = useState(todayLocal());
  const day = useData<Day>(`/analytics/day?trackerId=${id}&date=${date}`);
  const prefs = (profile.data?.unitPreferences ?? {}) as UnitPreferences;

  if (schema.error) return <ErrorBanner error={schema.error} />;
  if (!schema.data || !tracker.data) return <Spinner />;
  if (!activity || !item) return <Empty>No measurable activities in this tracker.</Empty>;

  const metric = item.kind === 'metric' ? activity.metrics.find((m) => m.key === item.key) : undefined;
  const param = item.kind === 'param' ? activity.parameters.find((p) => p.key === item.key) : undefined;
  const paramUnit = param ? displayUnitFor(param, activity.code, tracker.data.displayUnits, prefs) : undefined;
  const toShown = (v: number | null) => {
    if (v === null) return null;
    if (metric?.display.format === 'PERCENT') return Math.round(v * 1000) / 10;
    if (param?.unit && paramUnit) return units.toDisplay(v, param.unit, paramUnit);
    return Math.round(v * 100) / 100;
  };
  const data = (series.data?.points ?? []).map((p) => ({ ...p, shown: toShown(p.value) }));
  const unitLabel = metric?.display.format === 'PERCENT' ? '%' : (paramUnit ?? metric?.display.unit ?? '');
  const isRatio = metric?.kind === 'RATIO';

  return (
    <div className="stack">
      <PageHeader
        title={`${tracker.data.displayName} · Charts`}
        subtitle="Daily, weekly and monthly values from completed sessions."
        actions={
          others.length > 1 ? (
            <select
              value={id}
              onChange={(e) => router.push(`/trackers/${e.target.value}/charts`)}
              aria-label="Tracker"
              className="wide-select"
            >
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      <Card>
        <div className="row gap wrap">
          <select
            value={activity.code}
            onChange={(e) => {
              setActivityCode(e.target.value);
              setItemId(undefined);
            }}
            className="wide-select"
            aria-label="Activity"
          >
            {activities.map((a) => (
              <option key={a.code} value={a.code}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={item.id}
            onChange={(e) => setItemId(e.target.value)}
            className="wide-select"
            aria-label="Metric"
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
          <Tabs
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: 'DAY', label: 'Daily' },
              { value: 'WEEK', label: 'Weekly' },
              { value: 'MONTH', label: 'Monthly' },
            ]}
          />
        </div>
        <div style={{ height: 320, marginTop: 16 }}>
          {series.loading ? (
            <Spinner />
          ) : data.length === 0 ? (
            <Empty>No completed sessions in this period yet.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {granularity === 'DAY' ? (
                <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
                  <CartesianGrid stroke="#eef0f6" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit={unitLabel === '%' ? '%' : ''} />
                  <Tooltip content={<ChartTip unit={unitLabel} ratio={isRatio} />} />
                  <Line type="monotone" dataKey="shown" stroke="#5B5BF7" strokeWidth={3} dot={{ r: 4 }} connectNulls />
                </LineChart>
              ) : (
                <BarChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
                  <CartesianGrid stroke="#eef0f6" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit={unitLabel === '%' ? '%' : ''} />
                  <Tooltip content={<ChartTip unit={unitLabel} ratio={isRatio} />} />
                  <Bar dataKey="shown" fill="#22D3EE" radius={[6, 6, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
        {isRatio && (
          <p className="small muted">
            Ratios over a week or month are total successes ÷ total attempts, never an average of daily percentages.
          </p>
        )}
      </Card>
      <Card
        title="Sessions of a day"
        actions={<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />}
      >
        {(day.data?.sessions.length ?? 0) === 0 ? (
          <Empty>No completed sessions on {date}.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  {activity.metrics
                    .filter((m) => !m.hidden)
                    .slice(0, 4)
                    .map((m) => (
                      <th key={m.key}>{m.label}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {day.data!.sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td>
                      <strong>{s.name}</strong>
                      <div className="small muted">
                        {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    {activity.metrics
                      .filter((m) => !m.hidden)
                      .slice(0, 4)
                      .map((m) => {
                        const v = s.metrics[`${activity.code}.${m.key}`];
                        return (
                          <td key={m.key}>
                            {formatMetric(m, v?.value, prefs)}
                            {m.kind === 'RATIO' && v?.den ? (
                              <div className="small muted">
                                {v.num} of {v.den}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
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

function ChartTip({
  active,
  payload,
  unit,
  ratio,
}: {
  active?: boolean;
  payload?: { payload: Point & { shown: number | null } }[];
  unit: string;
  ratio: boolean;
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="card" style={{ padding: '8px 12px' }}>
      <div className="small muted">{p.period}</div>
      <div style={{ fontWeight: 800 }}>
        {p.shown ?? '–'} {unit}
      </div>
      {ratio && p.den !== null && p.den !== undefined && (
        <div className="small">
          {p.num} of {p.den}
        </div>
      )}
      <div className="small muted">
        {p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}
      </div>
    </div>
  );
}
