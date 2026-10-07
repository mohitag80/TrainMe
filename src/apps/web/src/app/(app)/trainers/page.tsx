'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { friendlyTime } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Connection, Connections, Profile, TrainerHit } from '@/lib/types';

/**
 * FR-COA-02/04 (trainee side): trainers you work with, requests to answer, and a search to find a trainer.
 * Picking a trainer when starting a session is limited to the active ones listed here.
 */
export default function TrainersPage() {
  const me = useData<Profile>('/profiles/me');
  const conns = useData<Connections>('/profiles/connections');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TrainerHit[]>();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();

  const search = async (term: string) => {
    try {
      setHits((await api<{ items: TrainerHit[] }>(`/profiles/trainers?q=${encodeURIComponent(term)}`)).items);
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  };
  useEffect(() => {
    const t = setTimeout(() => void search(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  async function act(fn: () => Promise<unknown>, text: string) {
    try {
      await fn();
      setMsg({ tone: 'ok', text });
      await Promise.all([conns.reload(), search(q.trim())]);
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  if (conns.error) return <ErrorBanner error={conns.error} />;
  if (!conns.data || !me.data) return <Spinner />;
  if (me.data.canCoach === false)
    return (
      <div className="stack">
        <PageHeader title="My trainers" />
        <Empty>Admin, catalog and support accounts do not take part in coaching. Use a personal account.</Empty>
      </div>
    );
  // A coach never has a coach of their own (v1.5); the menu hides this page, this covers a typed URL.
  if (me.data.coachingRole === 'TRAINER')
    return (
      <div className="stack">
        <PageHeader title="My trainers" />
        <Empty>
          You are a coach, and coaches cannot be trainees of another coach. Your trainees are on the{' '}
          <Link href="/coaching">Coaching</Link> page.
        </Empty>
      </div>
    );
  const mine = conns.data.asTrainee;
  const incoming = mine.filter((c) => c.status === 'PENDING' && !c.requestedByMe);
  const active = mine.filter((c) => c.status === 'ACTIVE');
  const outgoing = mine.filter((c) => c.status === 'PENDING' && c.requestedByMe);

  const respond = (c: Connection, answer: 'accept' | 'decline') =>
    act(
      () => api(`/profiles/connections/${c.id}/${answer}`, { method: 'POST' }),
      answer === 'accept' ? `${c.otherName} is now your trainer.` : `You declined ${c.otherName}.`,
    );

  return (
    <div className="stack">
      <PageHeader
        title="My trainers"
        subtitle="Connect with a coach or trainer, then pick them when you start a session. They see only the sessions you share with them."
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {incoming.length > 0 && (
        <Card title={`Invitations for you · ${incoming.length}`}>
          <ul className="list">
            {incoming.map((c) => (
              <li key={c.id}>
                <div>
                  <div className="pname">{c.otherName}</div>
                  <div className="phint">wants to train you · {friendlyTime(c.since)}</div>
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
        <Card title={`Your trainers · ${active.length}`}>
          {active.length === 0 ? (
            <Empty>No trainers yet – find one on the right, or ask your coach to invite you.</Empty>
          ) : (
            <ul className="list">
              {active.map((c) => (
                <li key={c.id}>
                  <div>
                    <div className="pname">{c.otherName}</div>
                    <div className="phint">
                      {c.specialties.length ? `${c.specialties.join(' · ')} · ` : ''}since {friendlyTime(c.since)}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      confirm(`Stop training with ${c.otherName}? They keep seeing the sessions you already shared.`) &&
                      act(
                        () => api(`/profiles/connections/${c.id}`, { method: 'DELETE' }),
                        `You disconnected from ${c.otherName}.`,
                      )
                    }
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          {outgoing.length > 0 && (
            <>
              <h4 className="history-day" style={{ marginTop: 16 }}>
                Waiting for an answer
              </h4>
              <ul className="list">
                {outgoing.map((c) => (
                  <li key={c.id}>
                    <div className="pname">{c.otherName}</div>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        act(() => api(`/profiles/connections/${c.id}`, { method: 'DELETE' }), 'Request withdrawn.')
                      }
                    >
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Find a trainer">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or specialty – e.g. fast bowling" />
          {!hits ? (
            <p className="muted small">Loading…</p>
          ) : hits.length === 0 ? (
            <Empty>No trainers match “{q}”.</Empty>
          ) : (
            <ul className="list" style={{ marginTop: 10 }}>
              {hits.map((t) => (
                <li key={t.id}>
                  <div>
                    <div className="pname">{t.displayName}</div>
                    <div className="phint">
                      {[t.specialties.join(' · '), t.bio].filter(Boolean).join(' – ') || 'Trainer'}
                    </div>
                  </div>
                  {t.connection?.status === 'ACTIVE' ? (
                    <Badge tone="ok">Your trainer</Badge>
                  ) : t.connection ? (
                    <Badge tone="warn">{t.connection.requestedByMe ? 'Requested' : 'Invited you'}</Badge>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() =>
                        act(
                          () => api('/profiles/connections', { method: 'POST', body: { trainerId: t.id } }),
                          `Request sent to ${t.displayName}.`,
                        )
                      }
                    >
                      Request
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
