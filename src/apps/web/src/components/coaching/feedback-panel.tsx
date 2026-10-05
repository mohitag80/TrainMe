'use client';
import { useCallback, useEffect, useState } from 'react';
import type { EffectiveActivity } from '@trainme/schema';
import { Card, Empty } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { friendlyTime } from '@/lib/client/format';
import { humanize } from '@/lib/labels';
import type { Feedback, Session, SessionEntry } from '@/lib/types';

/** "Ball #3 – Fast Bowling" style label for an entry comment. */
function entryLabel(e: SessionEntry | undefined, activities: EffectiveActivity[], all: SessionEntry[]) {
  if (!e) return 'An entry';
  // Same numbering as the session page: position in time order within the activity.
  const n =
    all
      .filter((x) => x.activityCode === e.activityCode)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .findIndex((x) => x.clientEntryId === e.clientEntryId) + 1;
  const a = activities.find((x) => x.code === e.activityCode);
  const what = a?.recordingMode === 'PER_SET' ? 'Set' : a?.recordingMode === 'PER_ATTEMPT' ? 'Ball' : 'Entry';
  return `${what} #${n || e.seqNo}${a ? ` · ${a.name}` : ` · ${humanize(e.activityCode)}`}`;
}

/**
 * Trainer feedback on a session (FR-COA-09): a note on the whole session or a comment on one entry. The trainer
 * writes and edits their own; the trainee reads. Refreshes every 15 s during a live session.
 */
export function FeedbackPanel({
  session,
  entries,
  activities,
  people,
  canWrite,
  live,
}: {
  session: Session;
  entries: SessionEntry[];
  activities: EffectiveActivity[];
  people: Record<string, string>;
  canWrite: boolean;
  live: boolean;
}) {
  const [items, setItems] = useState<Feedback[]>();
  const [body, setBody] = useState('');
  const [about, setAbout] = useState<string>('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Feedback[] }>(`/sessions/${session.id}/feedback`)).items);
    } catch (e) {
      setError(errorText(e));
    }
  }, [session.id]);
  useEffect(() => {
    void load();
    if (!live) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load, live]);

  const byId = new Map(entries.map((e) => [e.clientEntryId, e]));
  const trainerName = session.trainerId ? (people[session.trainerId] ?? 'Your trainer') : 'Trainer';

  async function send() {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/feedback`, {
        method: 'POST',
        body: { body: body.trim(), clientEntryId: about || null },
      });
      setBody('');
      setAbout('');
      setError(undefined);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Feedback from ${canWrite ? 'you' : trainerName}`}>
      {error && <p className="field-error">{error}</p>}
      {!items ? (
        <p className="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <Empty>
          {canWrite ? 'No feedback yet – write a note below.' : `${trainerName} has not left feedback yet.`}
        </Empty>
      ) : (
        <ul className="feedback-list">
          {items.map((f) => (
            <li key={f.id}>
              <div className="feedback-about">
                {f.clientEntryId ? entryLabel(byId.get(f.clientEntryId), activities, entries) : 'Whole session'}
              </div>
              <div className="feedback-body">{f.body}</div>
              <div className="small muted">
                {people[f.authorId] ?? (f.mine ? 'You' : trainerName)} · {friendlyTime(f.createdAt)}
                {f.mine && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      if (!confirm('Delete this feedback?')) return;
                      await api(`/sessions/${session.id}/feedback/${f.id}`, { method: 'DELETE' });
                      await load();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="feedback-compose">
          <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="About">
            <option value="">About the whole session</option>
            {[...entries]
              .filter((e) => !!e.id) // only entries already on the server can carry a comment
              .sort((a, b) => b.seqNo - a.seqNo)
              .map((e) => (
                <option key={e.clientEntryId} value={e.clientEntryId}>
                  {entryLabel(e, activities, entries)}
                </option>
              ))}
          </select>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Good rhythm – keep the wrist behind the ball"
          />
          <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()} onClick={send}>
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      )}
    </Card>
  );
}
