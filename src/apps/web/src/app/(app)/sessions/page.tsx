'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBanner, Spinner, Tabs } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { todayLocal } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Session, TrackerSummary } from '@/lib/types';

type View = 'history' | 'day';
type Period = '7' | '30' | '90' | '365';
const PERIODS: { value: Period; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 3 months' },
  { value: '365', label: 'Last 12 months' },
];

const shiftDate = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
/** "Today", "Yesterday" or "Sat, 3 Oct" for a YYYY-MM-DD session date. */
function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today';
  if (iso === shiftDate(today, -1)) return 'Yesterday';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  });
}

/** One session row: name, tracker, start time, entry count and status – links to the session. */
function SessionRow({ s, tracker }: { s: Session; tracker?: string }) {
  return (
    <li>
      <div>
        <Link href={`/sessions/${s.id}`} style={{ fontWeight: 700 }}>
          {s.name}
        </Link>
        <div className="small muted">
          {tracker ?? 'Tracker'} ·{' '}
          {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.entryCount}{' '}
          {s.entryCount === 1 ? 'entry' : 'entries'}
        </div>
      </div>
      <Badge tone={s.status === 'COMPLETED' ? 'ok' : 'brand'}>
        {s.status === 'IN_PROGRESS' ? 'Live' : s.isAutoClosed ? 'Auto-closed' : 'Done'}
      </Badge>
    </li>
  );
}

/** FR-REC-17/18: session history (newest first, grouped by day), a single-day view, and text search (S5). */
export default function SessionsPage() {
  const today = todayLocal();
  const trackers = useData<{ items: TrackerSummary[] }>('/trackers');
  const names = new Map((trackers.data?.items ?? []).map((t) => [t.id, t.displayName]));
  const [view, setView] = useState<View>('history');

  // history: paged list for a period, optionally one tracker
  const [period, setPeriod] = useState<Period>('30');
  const [trackerId, setTrackerId] = useState('');
  const [items, setItems] = useState<Session[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ from: shiftDate(today, 1 - Number(period)), to: today, limit: '50' });
        if (trackerId) qs.set('trackerId', trackerId);
        if (after) qs.set('cursor', after);
        const page = await api<{ items: Session[]; nextCursor: string | null }>(`/sessions?${qs}`);
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(undefined);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [period, trackerId, today],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  const groups = items.reduce<[string, Session[]][]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last[0] === s.sessionDate) last[1].push(s);
    else acc.push([s.sessionDate, [s]]);
    return acc;
  }, []);
  const entries = items.reduce((n, s) => n + s.entryCount, 0);

  // day view and search
  const [date, setDate] = useState(today);
  const day = useData<{ items: Session[] }>(view === 'day' ? `/sessions?date=${date}` : null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Session[] | null>(null);
  const [searchError, setSearchError] = useState<string>();

  return (
    <div className="stack">
      <PageHeader
        title="Sessions"
        subtitle="Every session you have recorded. Each one is identified by its date and a name that is unique for that day."
        actions={
          <Tabs<View>
            value={view}
            onChange={setView}
            options={[
              { value: 'history', label: 'History' },
              { value: 'day', label: 'One day' },
            ]}
          />
        }
      />

      {view === 'history' ? (
        <Card
          title={
            items.length
              ? `${items.length}${cursor ? '+' : ''} sessions · ${entries.toLocaleString()} entries`
              : 'History'
          }
          actions={
            <div className="row gap wrap">
              <select
                value={trackerId}
                onChange={(e) => setTrackerId(e.target.value)}
                aria-label="Tracker"
                style={{ width: 200 }}
              >
                <option value="">All trackers</option>
                {(trackers.data?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                aria-label="Period"
                style={{ width: 170 }}
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <ErrorBanner error={error} />
          {loading && items.length === 0 ? (
            <Spinner />
          ) : items.length === 0 ? (
            <Empty>No sessions in this period.</Empty>
          ) : (
            <div className="history">
              {groups.map(([d, list]) => (
                <section key={d}>
                  <h4 className="history-day">
                    {dayLabel(d, today)}
                    <span className="muted"> · {list.length === 1 ? '1 session' : `${list.length} sessions`}</span>
                  </h4>
                  <ul className="list">
                    {list.map((s) => (
                      <SessionRow key={s.id} s={s} tracker={names.get(s.trackerId)} />
                    ))}
                  </ul>
                </section>
              ))}
              {cursor && (
                <button className="btn" disabled={loading} onClick={() => load(cursor)}>
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card
          title={dayLabel(date, today)}
          actions={
            <div className="row gap">
              <button className="btn btn-sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
                ‹
              </button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
              <button className="btn btn-sm" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
                ›
              </button>
            </div>
          }
        >
          <ErrorBanner error={day.error} />
          {day.loading ? (
            <Spinner />
          ) : (day.data?.items.length ?? 0) === 0 ? (
            <Empty>No sessions on this day.</Empty>
          ) : (
            <ul className="list">
              {day.data!.items.map((s) => (
                <SessionRow key={s.id} s={s} tracker={names.get(s.trackerId)} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Search my sessions">
        <form
          className="row gap"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setFound((await api<{ items: Session[] }>(`/sessions/search?q=${encodeURIComponent(q)}`)).items);
              setSearchError(undefined);
            } catch (err) {
              setSearchError(errorText(err));
            }
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, notes or tags – e.g. run-up" />
          <button className="btn" disabled={!q.trim()}>
            Search
          </button>
        </form>
        {searchError && <p className="field-error">{searchError}</p>}
        {found &&
          (found.length === 0 ? (
            <Empty>No matching sessions in the last 12 months.</Empty>
          ) : (
            <ul className="list" style={{ marginTop: 10 }}>
              {found.map((s) => (
                <SessionRow key={s.id} s={s} tracker={names.get(s.trackerId)} />
              ))}
            </ul>
          ))}
      </Card>
    </div>
  );
}
