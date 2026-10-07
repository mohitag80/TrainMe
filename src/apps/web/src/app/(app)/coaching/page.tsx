'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { friendlyTime } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Connection, Connections, Profile, Session } from '@/lib/types';

const LIVE_REFRESH_SECONDS = 10;

/**
 * Trainer dashboard (FR-COA-03/06): live sessions assigned to you (refreshing), trainee requests, invitations
 * by e-mail and your trainees. Only sessions where a trainee picked you appear here.
 */
export default function CoachingPage() {
  const me = useData<Profile>('/profiles/me');
  const conns = useData<Connections>('/profiles/connections');
  const live = useData<{ items: Session[] }>('/sessions/coaching?status=IN_PROGRESS');
  const [email, setEmail] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();

  const reloadLive = live.reload;
  useEffect(() => {
    const t = setInterval(() => void reloadLive(), LIVE_REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, [reloadLive]);
  // Names for live sessions of trainees who are no longer connected (connections only list current ones).
  useEffect(() => {
    const known = new Set((conns.data?.asTrainer ?? []).map((c) => c.otherId));
    const missing = [
      ...new Set((live.data?.items ?? []).map((s) => s.userId!).filter((id) => id && !known.has(id) && !names[id])),
    ];
    if (missing.length)
      void api<{ items: { id: string; displayName: string }[] }>(`/profiles/names?ids=${missing.join(',')}`).then((r) =>
        setNames((n) => ({ ...n, ...Object.fromEntries(r.items.map((x) => [x.id, x.displayName])) })),
      );
  }, [live.data, conns.data, names]);

  async function act(fn: () => Promise<unknown>, text: string) {
    try {
      await fn();
      setMsg({ tone: 'ok', text });
      await conns.reload();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  if (conns.error) return <ErrorBanner error={conns.error} />;
  if (!conns.data || !me.data) return <Spinner />;
  if (me.data.canCoach === false)
    return (
      <div className="stack">
        <PageHeader title="Coaching" />
        <Empty>
          Admin, catalog and support accounts do not take part in coaching. Use a personal account to coach.
        </Empty>
      </div>
    );
  if (me.data.coachingRole === 'TRAINEE')
    return (
      <div className="stack">
        <PageHeader title="Coaching" />
        <Empty>
          Coaching is for coaches. You train with a coach, so you cannot coach others – see{' '}
          <Link href="/trainers">My trainers</Link>.
        </Empty>
      </div>
    );
  if (!me.data.isTrainer)
    return (
      <div className="stack">
        <PageHeader title="Coaching" />
        <Empty>
          Turn on <b>I coach or train others</b> on your <Link href="/profile">Profile</Link> to coach trainees.
        </Empty>
      </div>
    );

  const mine = conns.data.asTrainer;
  const nameOf = (id?: string) => mine.find((c) => c.otherId === id)?.otherName ?? names[id ?? ''] ?? 'Trainee';
  const incoming = mine.filter((c) => c.status === 'PENDING' && !c.requestedByMe);
  const invited = mine.filter((c) => c.status === 'PENDING' && c.requestedByMe);
  const trainees = mine.filter((c) => c.status === 'ACTIVE');
  const respond = (c: Connection, answer: 'accept' | 'decline') =>
    act(
      () => api(`/profiles/connections/${c.id}/${answer}`, { method: 'POST' }),
      answer === 'accept' ? `${c.otherName} is now your trainee.` : `You declined ${c.otherName}.`,
    );

  return (
    <div className="stack">
      <PageHeader
        title="Coaching"
        subtitle="Your trainees and their live sessions. You see only the sessions where a trainee picked you as trainer."
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card
        title={
          <span className="row gap-sm">
            Live now <span className="live-dot" />{' '}
            <span className="small muted">refreshes every {LIVE_REFRESH_SECONDS} s</span>
          </span>
        }
      >
        {(live.data?.items ?? []).length === 0 ? (
          <Empty>No live sessions right now. When a trainee starts a session with you, it appears here.</Empty>
        ) : (
          <div className="live-grid">
            {live.data!.items.map((s) => (
              <Link key={s.id} href={`/sessions/${s.id}`} className="live-card">
                <div className="row between">
                  <div className="pname">{nameOf(s.userId)}</div>
                  <Badge tone="brand">Live</Badge>
                </div>
                <div>{s.name}</div>
                <div className="small muted">
                  started {friendlyTime(s.startedAt)} · {s.entryCount} saved {s.entryCount === 1 ? 'entry' : 'entries'}
                </div>
                <span className="btn btn-sm btn-primary" style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                  Join and record →
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {incoming.length > 0 && (
        <Card title={`Trainees asking for you · ${incoming.length}`}>
          <ul className="list">
            {incoming.map((c) => (
              <li key={c.id}>
                <div>
                  <div className="pname">{c.otherName}</div>
                  <div className="phint">asked {friendlyTime(c.since)}</div>
                </div>
                <span className="row gap-sm">
                  <button className="btn btn-sm btn-primary" onClick={() => respond(c, 'accept')}>
                    Accept
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => respond(c, 'decline')}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid-2">
        <Card title={`My trainees · ${trainees.length}`}>
          {trainees.length === 0 ? (
            <Empty>No trainees yet – invite one by e-mail, or share your name so they can find you.</Empty>
          ) : (
            <ul className="list">
              {trainees.map((c) => (
                <li key={c.id}>
                  <div>
                    <Link className="pname" href={`/coaching/${c.otherId}`}>
                      {c.otherName}
                    </Link>
                    <div className="phint">trainee since {friendlyTime(c.since)}</div>
                  </div>
                  <span className="row gap-sm">
                    <Link className="btn btn-sm" href={`/coaching/${c.otherId}`}>
                      Sessions & charts
                    </Link>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        confirm(`Stop coaching ${c.otherName}? You keep their past sessions with you.`) &&
                        act(
                          () => api(`/profiles/connections/${c.id}`, { method: 'DELETE' }),
                          `You disconnected from ${c.otherName}.`,
                        )
                      }
                    >
                      Disconnect
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Invite a trainee">
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () => api('/profiles/connections', { method: 'POST', body: { traineeEmail: email.trim() } }),
                `Invitation sent to ${email.trim()}.`,
              ).then(() => setEmail(''));
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Trainee's e-mail address"
            />
            <button className="btn btn-primary" disabled={!email.includes('@')}>
              Invite
            </button>
          </form>
          <p className="small muted" style={{ marginTop: 8 }}>
            They need a TrainMe account; they accept under <b>My trainers</b>.
          </p>
          {invited.length > 0 && (
            <ul className="list" style={{ marginTop: 8 }}>
              {invited.map((c) => (
                <li key={c.id}>
                  <div>
                    <div className="pname">{c.otherName}</div>
                    <div className="phint">invited {friendlyTime(c.since)} · waiting</div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      act(() => api(`/profiles/connections/${c.id}`, { method: 'DELETE' }), 'Invitation withdrawn.')
                    }
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
