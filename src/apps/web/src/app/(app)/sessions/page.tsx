'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorBanner, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { todayLocal } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Session, TrackerSummary } from '@/lib/types';

/** FR-REC-17/18: a day's named sessions across trackers, lookup by date + name, and history search (S5). */
export default function SessionsPage() {
  const [date, setDate] = useState(todayLocal());
  const day = useData<{ items: Session[] }>(`/sessions?date=${date}`);
  const trackers = useData<{ items: TrackerSummary[] }>('/trackers');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Session[] | null>(null);
  const [error, setError] = useState<string>();
  const names = new Map((trackers.data?.items ?? []).map((t) => [t.id, t.displayName]));
  const shift = (days: number) => setDate(new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10));

  return (
    <div className="stack">
      <PageHeader
        title="Sessions"
        subtitle="Each session is identified by its date and a name that is unique for that day."
      />
      <Card
        title="Day view"
        actions={
          <div className="row gap">
            <button className="btn btn-sm" onClick={() => shift(-1)}>
              ‹
            </button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
            <button className="btn btn-sm" onClick={() => shift(1)}>
              ›
            </button>
          </div>
        }
      >
        <ErrorBanner error={day.error} />
        {day.loading ? (
          <Spinner />
        ) : (day.data?.items.length ?? 0) === 0 ? (
          <Empty>No sessions on {date}.</Empty>
        ) : (
          <ul className="list">
            {day.data!.items.map((s) => (
              <li key={s.id}>
                <div>
                  <Link href={`/sessions/${s.id}`} style={{ fontWeight: 700 }}>
                    {s.name}
                  </Link>
                  <div className="small muted">
                    {names.get(s.trackerId) ?? 'Tracker'} ·{' '}
                    {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {s.entryCount} entries
                  </div>
                </div>
                <Badge tone={s.status === 'COMPLETED' ? 'ok' : 'brand'}>
                  {s.status === 'IN_PROGRESS' ? 'Live' : s.isAutoClosed ? 'Auto-closed' : 'Done'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Search my sessions">
        <form
          className="row gap"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setFound((await api<{ items: Session[] }>(`/sessions/search?q=${encodeURIComponent(q)}`)).items);
              setError(undefined);
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, notes or tags – e.g. run-up" />
          <button className="btn" disabled={!q.trim()}>
            Search
          </button>
        </form>
        {error && <p className="field-error">{error}</p>}
        {found &&
          (found.length === 0 ? (
            <Empty>No matching sessions in the last 12 months.</Empty>
          ) : (
            <ul className="list" style={{ marginTop: 10 }}>
              {found.map((s) => (
                <li key={s.id}>
                  <Link href={`/sessions/${s.id}`}>{s.name}</Link>
                  <span className="small muted">{s.sessionDate}</span>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </div>
  );
}
