'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EntryValidator, evaluateMetric, type EffectiveActivity, type EffectiveParameter } from '@trainme/schema';
import type { UnitPreferences } from '@trainme/units';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { FeedbackPanel } from '@/components/coaching/feedback-panel';
import { Segmented, Switch } from '@/components/controls';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/client/api';
import { displayUnitFor, formatMetric, units } from '@/lib/client/format';
import { groupParameters, humanize } from '@/lib/labels';
import type { Profile, Session, SessionEntry, TrackerDetail, TrackerSchema } from '@/lib/types';

/** Checkpoint interval. The design allows 3–5 min (FR-REC-10); 60 s keeps the demo responsive. */
const SYNC_SECONDS = 60;
const FLUSH_AT_PENDING = 25;

type LocalEntry = SessionEntry & { synced: boolean; errors?: string[] };
interface LocalState {
  pending: LocalEntry[];
  deletes: string[];
  batchSeq: number;
}

/** With a trainer, both devices save at once and read each other's entries this often (docs/12 §2). */
const COACHED_SYNC_SECONDS = 5;

/**
 * Merges the server's entries into this device's list: entries logged on the other device are added, server
 * versions replace synced copies, synced entries the other device deleted disappear; local unsaved work stays.
 */
function mergeServer(local: LocalEntry[], server: SessionEntry[], deleted: string[]): LocalEntry[] {
  const onServer = new Map(server.map((e) => [e.clientEntryId, e]));
  const kept = local
    .filter((e) => !e.synced || e.errors || onServer.has(e.clientEntryId))
    .map((e) => (e.synced && onServer.has(e.clientEntryId) ? { ...onServer.get(e.clientEntryId)!, synced: true } : e));
  const known = new Set(kept.map((e) => e.clientEntryId));
  const added = server
    .filter((e) => !known.has(e.clientEntryId) && !deleted.includes(e.clientEntryId))
    .map((e) => ({ ...e, synced: true }));
  return [...kept, ...added].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

const storageKey = (id: string) => `trainme:session:${id}`;
const loadLocal = (id: string): LocalState | null => {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as LocalState) : null;
  } catch {
    return null;
  }
};
const toWire = (e: LocalEntry) => ({
  clientEntryId: e.clientEntryId,
  activity: e.activityCode,
  seq: e.seqNo,
  group: e.groupNo,
  recordedAt: e.recordedAt,
  values: e.values,
  rowVersion: e.rowVersion,
});

/** Switches start off: skill "attempted" flags and stand-alone yes/no fields are false until turned on. */
function switchDefaults(a: EffectiveActivity): Record<string, unknown> {
  return Object.fromEntries(
    groupParameters(a.parameters).flatMap((r) =>
      r.kind === 'skill'
        ? [[r.attempted.key, false]]
        : r.param.type === 'BOOL' && !r.param.condition
          ? [[r.param.key, false]]
          : [],
    ),
  );
}

const entryLabel = (a: EffectiveActivity) =>
  a.recordingMode === 'PER_SET' ? 'set' : a.recordingMode === 'PER_ATTEMPT' ? 'ball' : 'result';

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session>();
  const [schema, setSchema] = useState<TrackerSchema>();
  const [tracker, setTracker] = useState<TrackerDetail>();
  const [prefs, setPrefs] = useState<UnitPreferences>({});
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    try {
      const s = await api<Session & { entries: SessionEntry[] }>(`/sessions/${id}?include=entries`);
      // A trainer cannot read the trainee's tracker: the session serves its pinned schema instead.
      const asTrainer = s.myRole === 'TRAINER';
      const [sc, t, p, names] = await Promise.all([
        asTrainer
          ? api<TrackerSchema>(`/sessions/${id}/schema`)
          : api<TrackerSchema>(`/trackers/${s.trackerId}/schema?version=${s.schemaVersion}`),
        asTrainer
          ? Promise.resolve({
              id: s.trackerId,
              displayName: 'Trainee session',
              displayUnits: {},
            } as unknown as TrackerDetail)
          : api<TrackerDetail>(`/trackers/${s.trackerId}`),
        api<Profile>('/profiles/me'),
        s.trainerId
          ? api<{ items: { id: string; displayName: string }[] }>(`/profiles/names?ids=${s.trainerId},${s.userId}`)
          : Promise.resolve({ items: [] }),
      ]);
      setPeople(Object.fromEntries(names.items.map((n) => [n.id, n.displayName])));
      const local = loadLocal(id);
      const server: LocalEntry[] = s.entries.map((e) => ({ ...e, synced: true }));
      const pending = (local?.pending ?? []).filter(
        (x) => !server.some((y) => y.clientEntryId === x.clientEntryId && y.rowVersion >= x.rowVersion),
      );
      const deleted = new Set(local?.deletes ?? []);
      setEntries([...server.filter((e) => !deleted.has(e.clientEntryId)), ...pending]);
      setSession(s);
      setSchema(sc);
      setTracker(t);
      setPrefs(p.unitPreferences as UnitPreferences);
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBanner error={error} />;
  if (!session || !schema || !tracker) return <Spinner />;
  return session.status === 'IN_PROGRESS' ? (
    <Recorder
      session={session}
      schema={schema}
      tracker={tracker}
      prefs={prefs}
      entries={entries}
      setEntries={setEntries}
      people={people}
      onDone={load}
    />
  ) : (
    <SessionSummary
      session={session}
      schema={schema}
      tracker={tracker}
      prefs={prefs}
      entries={entries}
      people={people}
      onChanged={load}
    />
  );
}

// ---------------------------------------------------------------- live recording

function Recorder({
  session,
  schema,
  tracker,
  prefs,
  entries,
  setEntries,
  people,
  onDone,
}: {
  session: Session;
  schema: TrackerSchema;
  tracker: TrackerDetail;
  prefs: UnitPreferences;
  entries: LocalEntry[];
  setEntries: React.Dispatch<React.SetStateAction<LocalEntry[]>>;
  people: Record<string, string>;
  onDone: () => Promise<void>;
}) {
  const router = useRouter();
  const coached = !!session.trainerId;
  const asTrainer = session.myRole === 'TRAINER';
  const inFlight = useRef(false);
  const activities = useMemo(
    () =>
      schema.activities
        .filter((a) => !a.hidden)
        .sort((a, b) => (a.recordingMode === 'PER_ATTEMPT' ? -1 : 0) - (b.recordingMode === 'PER_ATTEMPT' ? -1 : 0)),
    [schema],
  );
  const validator = useMemo(() => new EntryValidator(schema), [schema]);
  const [activityCode, setActivityCode] = useState(activities[0]?.code ?? '');
  const activity = activities.find((a) => a.code === activityCode)!;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    activities[0] ? switchDefaults(activities[0]) : {},
  );
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string>();
  const [lastSync, setLastSync] = useState<Date>();
  const [ending, setEnding] = useState(false);
  const local = useRef<LocalState>(
    loadLocal(session.id) ?? { pending: [], deletes: [], batchSeq: session.lastBatchSeq },
  );
  const [elapsed, setElapsed] = useState(0);

  const persist = useCallback(
    (next: LocalEntry[]) => {
      local.current.pending = next.filter((e) => !e.synced);
      try {
        localStorage.setItem(storageKey(session.id), JSON.stringify(local.current));
      } catch {
        // Private mode: keep going in memory; checkpoints still protect the data.
      }
    },
    [session.id],
  );

  /** Posts one checkpoint batch (≤ 100 entries) and returns the server's rejections. */
  const postBatch = useCallback(
    async (batch: LocalEntry[], deletes: string[]) => {
      local.current.batchSeq += 1;
      const r = await api<{ rejected: { clientEntryId: string; errors: { pointer: string; message: string }[] }[] }>(
        `/sessions/${session.id}/entries:batch`,
        {
          method: 'POST',
          body: {
            batchSeq: local.current.batchSeq,
            schemaVersion: session.schemaVersion,
            entries: batch.map(toWire),
            deletes,
          },
        },
      );
      return new Map(
        r.rejected.map((x) => [
          x.clientEntryId,
          x.errors.map((er) => `${er.pointer.replace('/values/', '')}: ${er.message}`),
        ]),
      );
    },
    [session.id, session.schemaVersion],
  );

  /** Sends unsynced entries and deletes; rejected entries stay local with their errors. */
  const flush = useCallback(async () => {
    const pending = entries.filter((e) => !e.synced && !e.errors);
    if (pending.length === 0 && local.current.deletes.length === 0) return true;
    if (inFlight.current) return true; // one save at a time; the next tick picks up the rest
    inFlight.current = true;
    setSyncState('syncing');
    try {
      for (let i = 0; i < Math.max(pending.length, 1); i += 100) {
        const chunk = pending.slice(i, i + 100);
        const deletes = i === 0 ? local.current.deletes.slice(0, 100) : [];
        const rejected = await postBatch(chunk, deletes);
        local.current.deletes = local.current.deletes.filter((d) => !deletes.includes(d));
        const ids = new Set(chunk.map((c) => c.clientEntryId));
        setEntries((all) => {
          const next = all.map((e) =>
            ids.has(e.clientEntryId)
              ? rejected.has(e.clientEntryId)
                ? { ...e, errors: rejected.get(e.clientEntryId) }
                : { ...e, synced: true }
              : e,
          );
          persist(next);
          return next;
        });
      }
      setSyncState('idle');
      setSyncError(undefined);
      setLastSync(new Date());
      return true;
    } catch (e) {
      setSyncState('error');
      setSyncError(errorText(e));
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [entries, persist, postBatch, setEntries]);

  // Periodic checkpoint, early flush when many are pending or the tab is hidden (FR-REC-10).
  useEffect(() => {
    const timer = setInterval(() => void flush(), (coached ? COACHED_SYNC_SECONDS : SYNC_SECONDS) * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush, coached]);
  useEffect(() => {
    const waiting = entries.filter((e) => !e.synced && !e.errors).length;
    // With a trainer every entry goes up at once, so the other device sees it within seconds.
    if (waiting >= (coached ? 1 : FLUSH_AT_PENDING)) void flush();
  }, [entries, flush, coached]);
  // Coached session: pick up the other device's entries, and notice when the other side ends the session.
  useEffect(() => {
    if (!coached) return;
    const t = setInterval(async () => {
      try {
        const s = await api<Session & { entries: SessionEntry[] }>(`/sessions/${session.id}?include=entries`);
        if (s.status !== 'IN_PROGRESS') {
          await onDone();
          return;
        }
        setEntries((all) => mergeServer(all, s.entries, local.current.deletes));
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    }, COACHED_SYNC_SECONDS * 1000);
    return () => clearInterval(t);
  }, [coached, session.id, onDone, setEntries]);
  useEffect(() => {
    const started = Date.parse(session.startedAt);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [session.startedAt]);

  // In time order: with a trainer two devices log into one session, so numbers follow when each ball was bowled.
  const activityEntries = entries
    .filter((e) => e.activityCode === activity.code)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const numberOf = new Map(activityEntries.map((e, i) => [e.clientEntryId, i + 1]));

  /** Validates with the shared schema validator, converts display units to canonical and stores locally. */
  function logEntry(repeat?: Record<string, unknown>) {
    const source = repeat ?? values;
    const canonical: Record<string, unknown> = {};
    const errs: Record<string, string> = {};
    for (const p of activity.parameters.filter(
      (x) => !x.hidden && (!x.condition || source[x.condition.when.key] === x.condition.when.eq),
    )) {
      const v = source[p.key];
      if (v === undefined || v === '') continue;
      if (repeat) {
        canonical[p.key] = v;
        continue;
      }
      if (p.type === 'INT' || p.type === 'DECIMAL' || p.type === 'DURATION') {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          errs[p.key] = 'Enter a number';
          continue;
        }
        const shown = displayUnitFor(p, activity.code, tracker.displayUnits, prefs);
        canonical[p.key] =
          p.unit && shown && shown !== p.unit
            ? units.toCanonical(n, shown, p.unit)
            : p.type === 'INT'
              ? Math.round(n)
              : n;
      } else canonical[p.key] = v;
    }
    for (const i of validator.validate(activity.code, canonical)) {
      const key = i.pointer.replace('/values/', '');
      errs[key] =
        i.code === 'required'
          ? 'Required'
          : i.code === 'minimum' || i.code === 'maximum'
            ? 'Outside the allowed range'
            : i.message;
    }
    setFormErrors(errs);
    if (Object.keys(errs).length) return;
    const seq = activityEntries.reduce((m, e) => Math.max(m, e.seqNo), 0) + 1;
    const entry: LocalEntry = {
      clientEntryId: crypto.randomUUID(),
      activityCode: activity.code,
      seqNo: seq,
      groupNo: activity.grouping ? Math.ceil(seq / activity.grouping.size) : null,
      recordedAt: new Date().toISOString(),
      values: canonical,
      rowVersion: 1,
      synced: false,
    };
    setEntries((all) => {
      const next = [...all, entry];
      persist(next);
      return next;
    });
    // Keep numbers and choices (similar balls); switches go back to off, results are cleared.
    setValues((v) => ({
      ...Object.fromEntries(
        Object.entries(v).filter(([k]) => activity.parameters.find((p) => p.key === k)?.type !== 'BOOL'),
      ),
      ...switchDefaults(activity),
    }));
  }

  function removeEntry(e: LocalEntry) {
    if (e.synced) local.current.deletes.push(e.clientEntryId);
    setEntries((all) => {
      const next = all.filter((x) => x.clientEntryId !== e.clientEntryId);
      persist(next);
      return next;
    });
  }

  /** FR-REC-12: flush, then complete with the full id list; entries the server lacks are resent once. */
  async function end() {
    setEnding(true);
    try {
      if (!(await flush())) throw new Error(syncError ?? 'Could not sync – check your connection and try again');
      const live = entries.filter((e) => !e.errors);
      const body = {
        endedAt: new Date().toISOString(),
        entryCount: live.length,
        clientEntryIds: live.map((e) => e.clientEntryId),
      };
      try {
        await api(`/sessions/${session.id}/complete`, { method: 'POST', body });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409 && Array.isArray(err.problem.missingClientEntryIds)))
          throw err;
        const missing = new Set(err.problem.missingClientEntryIds as string[]);
        await postBatch(
          live.filter((x) => missing.has(x.clientEntryId)),
          [],
        );
        await api(`/sessions/${session.id}/complete`, { method: 'POST', body });
      }
      localStorage.removeItem(storageKey(session.id));
      await onDone();
    } catch (e) {
      setSyncError(errorText(e));
    } finally {
      setEnding(false);
    }
  }

  const unsynced = entries.filter((e) => !e.synced).length;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const label = entryLabel(activity);
  const position = activity.grouping
    ? `${activity.grouping.label} ${Math.floor(activityEntries.length / activity.grouping.size) + 1} · ${label} ${(activityEntries.length % activity.grouping.size) + 1}`
    : `${humanize(label)} ${activityEntries.length + 1}`;

  return (
    <div className="stack">
      <nav className="crumbs">
        {asTrainer ? (
          <>
            <Link href="/coaching">Coaching</Link> <span>›</span>{' '}
            <Link href={`/coaching/${session.userId}`}>{people[session.userId ?? ''] ?? 'Trainee'}</Link>
          </>
        ) : (
          <Link href={`/trackers/${tracker.id}`}>{tracker.displayName}</Link>
        )}{' '}
        <span>›</span> {session.name}
      </nav>
      <PageHeader
        title={session.name}
        subtitle={
          <>
            Live ·{' '}
            <span className="timer">
              {mm}:{ss}
            </span>{' '}
            ·{' '}
            <span className="row gap" style={{ display: 'inline-flex' }}>
              <span className={`sync-dot ${syncState === 'error' ? 'bad' : unsynced ? 'pending' : 'ok'}`} />
              {syncState === 'syncing'
                ? 'Saving…'
                : unsynced
                  ? `${unsynced} not saved yet`
                  : lastSync
                    ? `Saved at ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'All saved'}
            </span>
          </>
        }
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => void flush()}>
              Save now
            </button>
            {entries.length === 0 && !asTrainer && (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await api(`/sessions/${session.id}/discard`, { method: 'POST' });
                  router.push(`/trackers/${tracker.id}`);
                }}
              >
                Discard
              </button>
            )}
            <button className="btn btn-primary" onClick={end} disabled={ending}>
              {ending ? 'Finishing…' : '■ End session'}
            </button>
          </>
        }
      />
      {syncError && <Notice tone="bad">{syncError}</Notice>}
      {coached && (
        <Notice tone="ok">
          {asTrainer
            ? `You are recording for ${people[session.userId ?? ''] ?? 'your trainee'} – both of you can log; each screen updates within ${COACHED_SYNC_SECONDS} seconds.`
            : `Training with ${people[session.trainerId ?? ''] ?? 'your trainer'} – they can follow and log in this session too.`}
        </Notice>
      )}
      {activities.length > 1 && (
        <div className="activity-pills" role="tablist" aria-label="Activity">
          {activities.map((a) => {
            const logged = entries.filter((e) => e.activityCode === a.code).length;
            return (
              <button
                key={a.code}
                role="tab"
                aria-selected={a.code === activityCode}
                className={a.code === activityCode ? 'chip on' : 'chip'}
                onClick={() => {
                  setActivityCode(a.code);
                  setValues(switchDefaults(a));
                  setFormErrors({});
                }}
              >
                {a.name}
                {logged > 0 && <span className="pill-count">{logged}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="recorder">
        <Card title={activity.name} actions={<Badge tone="brand">{position}</Badge>}>
          <EntryForm
            activity={activity}
            values={values}
            errors={formErrors}
            unitFor={(p) => displayUnitFor(p, activity.code, tracker.displayUnits, prefs)}
            onChange={(key, v) =>
              setValues((cur) => {
                const next = { ...cur, [key]: v };
                if (v === undefined) delete next[key];
                return next;
              })
            }
          />
          <div className="log-bar">
            <button className="btn btn-primary btn-lg" onClick={() => logEntry()}>
              + Log {label}
            </button>
            {activityEntries.length > 0 && (
              <button className="btn btn-lg" onClick={() => logEntry(activityEntries.at(-1)!.values)}>
                Repeat last
              </button>
            )}
          </div>
        </Card>
        <div className="stack">
          <LiveStats activity={activity} entries={activityEntries} prefs={prefs} />
          <Card title={`Logged (${activityEntries.length})`}>
            {activityEntries.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              [...activityEntries].reverse().map((e) => (
                <div key={e.clientEntryId} className="entry-row">
                  <div className="entry-seq">
                    {activity.grouping && e.groupNo
                      ? `${e.groupNo}.${((e.seqNo - 1) % activity.grouping.size) + 1}`
                      : `#${numberOf.get(e.clientEntryId) ?? e.seqNo}`}
                  </div>
                  <div className="entry-vals">
                    <EntryChips
                      activity={activity}
                      values={e.values}
                      displayUnits={tracker.displayUnits}
                      prefs={prefs}
                    />
                    {e.errors && <div className="field-error">{e.errors.join('; ')}</div>}
                    {coached && e.recordedBy && e.recordedBy !== session.userId && (
                      <span className="tag">by {people[e.recordedBy] ?? 'trainer'}</span>
                    )}
                  </div>
                  <div className="row gap">
                    <span
                      className={`sync-dot ${e.errors ? 'bad' : e.synced ? 'ok' : 'pending'}`}
                      title={e.synced ? 'saved' : 'not saved yet'}
                    />
                    <button className="btn btn-sm btn-ghost" onClick={() => removeEntry(e)} aria-label="Delete entry">
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </Card>
          {coached && (
            <FeedbackPanel
              session={session}
              entries={entries}
              activities={activities}
              people={people}
              canWrite={asTrainer}
              live
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The entry form in plain sections: measurements, choices, skills (switch → result) and other switches. */
function EntryForm({
  activity,
  values,
  errors,
  unitFor,
  onChange,
}: {
  activity: EffectiveActivity;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  unitFor: (p: EffectiveParameter) => string | undefined;
  onChange: (key: string, v: unknown) => void;
}) {
  const rows = groupParameters(activity.parameters).filter(
    (r) => r.kind === 'skill' || !r.param.condition || values[r.param.condition.when.key] === r.param.condition.when.eq,
  );
  const numbers = rows.flatMap((r) =>
    r.kind === 'single' && r.param.type !== 'BOOL' && r.param.type !== 'ENUM' ? [r.param] : [],
  );
  const choices = rows.flatMap((r) => (r.kind === 'single' && r.param.type === 'ENUM' ? [r.param] : []));
  const skills = rows.flatMap((r) => (r.kind === 'skill' ? [r] : []));
  const toggles = rows.flatMap((r) => (r.kind === 'single' && r.param.type === 'BOOL' ? [r.param] : []));
  return (
    <div className="stack" style={{ gap: 18 }}>
      {numbers.length > 0 && (
        <div className="form-section">
          <div className="section-title">Measurements</div>
          <div className="form-grid">
            {numbers.map((p) => (
              <NumberInput
                key={p.key}
                p={p}
                unit={unitFor(p)}
                value={values[p.key]}
                error={errors[p.key]}
                onChange={(v) => onChange(p.key, v)}
              />
            ))}
          </div>
        </div>
      )}
      {choices.length > 0 && (
        <div className="form-section">
          <div className="section-title">Choices</div>
          {choices.map((p) => (
            <div key={p.key} className="field">
              <span>{p.label}</span>
              <Segmented
                size="sm"
                value={values[p.key] as string | undefined}
                onChange={(v) => onChange(p.key, v)}
                options={(p.constraints.options ?? []).map((o) => ({ value: o, label: humanize(o) }))}
              />
              {errors[p.key] && <span className="field-error">{errors[p.key]}</span>}
            </div>
          ))}
        </div>
      )}
      {skills.length > 0 && (
        <div className="form-section">
          <div className="section-title">
            Skills tried on this {entryLabel(activity)} – switch on only what you attempted
          </div>
          <div className="skills-grid">
            {skills.map((r) => {
              const on = values[r.attempted.key] === true;
              return (
                <div key={r.attempted.key} className={`skill ${on ? 'on' : ''}`}>
                  <Switch
                    checked={on}
                    label={r.name}
                    hint={on ? 'How did it go?' : 'Not attempted'}
                    onChange={(v) => {
                      onChange(r.attempted.key, v);
                      if (!v) onChange(r.result.key, undefined);
                    }}
                  />
                  {on && (
                    <div className="skill-result">
                      <Segmented
                        size="sm"
                        value={values[r.result.key] as boolean | undefined}
                        onChange={(v) => onChange(r.result.key, v)}
                        options={[
                          { value: true, label: 'Accurate', tone: 'ok' },
                          { value: false, label: 'Missed', tone: 'bad' },
                        ]}
                      />
                      {errors[r.result.key] && <span className="field-error">Mark Accurate or Missed</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {toggles.length > 0 && (
        <div className="form-section">
          <div className="section-title">Other</div>
          <div className="skills-grid">
            {toggles.map((p) => (
              <div key={p.key} className={`skill ${values[p.key] === true ? 'on' : ''}`}>
                <Switch checked={values[p.key] === true} label={p.label} onChange={(v) => onChange(p.key, v)} />
                {errors[p.key] && <span className="field-error">{errors[p.key]}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberInput({
  p,
  unit,
  value,
  error,
  onChange,
}: {
  p: EffectiveParameter;
  unit?: string;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const numeric = p.type !== 'TEXT';
  const range =
    numeric && p.unit && unit
      ? units.rangeToDisplay(p.constraints.min, p.constraints.max, p.unit, unit)
      : { min: p.constraints.min, max: p.constraints.max };
  const step =
    unit && unit !== p.unit ? (units.get(unit)?.step ?? 'any') : (p.constraints.step ?? (p.type === 'INT' ? 1 : 'any'));
  const shownUnit = unit ?? p.unit;
  return (
    <label className="field">
      <span>
        {p.label}
        {!p.required && <span className="field-hint"> · optional</span>}
      </span>
      <div className="input-unit">
        <input
          type={numeric ? 'number' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          step={numeric ? step : undefined}
          min={range.min}
          max={range.max}
          placeholder={numeric && range.min !== undefined && range.max !== undefined ? `${range.min}–${range.max}` : ''}
          value={(value as string | number | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
        {shownUnit && <span className="unit">{shownUnit}</span>}
      </div>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function LiveStats({
  activity,
  entries,
  prefs,
}: {
  activity: EffectiveActivity;
  entries: LocalEntry[];
  prefs: UnitPreferences;
}) {
  const rows = entries.map((e) => ({ values: e.values }));
  const metrics = activity.metrics
    .filter((m) => !m.hidden)
    .map((m) => ({ m, r: evaluateMetric(m, rows) }))
    // Ratios with no attempts yet ("0 of 0") are noise; show them once something was tried.
    .filter(({ m, r }) => m.kind !== 'RATIO' || (r.den ?? 0) > 0)
    .slice(0, 8);
  return (
    <Card title="Live stats">
      {entries.length === 0 || metrics.length === 0 ? (
        <p className="small muted">Stats appear after the first entries – worked out on this device, even offline.</p>
      ) : (
        <div className="stats">
          {metrics.map(({ m, r }) => (
            <div className="stat" key={m.key}>
              <div className="stat-label">{m.label}</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {formatMetric(m, r.value, prefs)}
              </div>
              {m.kind === 'RATIO' && r.den !== null && (
                <div className="stat-hint">
                  {r.num} of {r.den}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** One entry as readable chips: "131.4 km/h", "Off stump", "Yorker ✓", "No-ball". */
function EntryChips({
  activity,
  values,
  displayUnits,
  prefs,
}: {
  activity: EffectiveActivity;
  values: Record<string, unknown>;
  displayUnits: Record<string, string>;
  prefs: UnitPreferences;
}) {
  const chips: { text: string; tone?: 'ok' | 'bad' | 'strong' }[] = [];
  for (const r of groupParameters(activity.parameters.map((p) => ({ ...p, hidden: false })))) {
    if (r.kind === 'skill') {
      if (values[r.attempted.key] === true) {
        const hit = values[r.result.key] === true;
        chips.push({ text: `${r.name} ${hit ? '✓' : '✗'}`, tone: hit ? 'ok' : 'bad' });
      }
      continue;
    }
    const p = r.param;
    const v = values[p.key];
    if (v === undefined || v === null || v === false) continue;
    if (v === true) chips.push({ text: p.label });
    else if (typeof v === 'number' && p.unit) {
      const shown = displayUnitFor(p, activity.code, displayUnits, prefs) ?? p.unit;
      chips.push({ text: `${units.toDisplay(v, p.unit, shown)} ${shown}`, tone: 'strong' });
    } else if (typeof v === 'number') chips.push({ text: `${p.label} ${v}`, tone: 'strong' });
    else chips.push({ text: p.type === 'ENUM' ? humanize(String(v)) : `${p.label}: ${String(v)}` });
  }
  if (chips.length === 0) return <span className="muted small">–</span>;
  return (
    <>
      {chips.map((c, i) => (
        <span key={i} className={`chip-val ${c.tone ?? ''}`}>
          {c.text}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- completed session

function SessionSummary({
  session,
  schema,
  tracker,
  prefs,
  entries,
  people,
  onChanged,
}: {
  session: Session;
  schema: TrackerSchema;
  tracker: TrackerDetail;
  prefs: UnitPreferences;
  entries: LocalEntry[];
  people: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const asTrainer = session.myRole === 'TRAINER';
  const traineeName = people[session.userId ?? ''] ?? 'Trainee';
  const [notes, setNotes] = useState(session.notes ?? '');
  const [msg, setMsg] = useState<string>();
  const used = schema.activities.filter((a) => entries.some((e) => e.activityCode === a.code));
  async function save(body: Record<string, unknown>) {
    try {
      await api(`/sessions/${session.id}`, {
        method: 'PATCH',
        body,
        headers: { 'if-match': `"${session.rowVersion}"` },
      });
      setMsg('Saved');
      await onChanged();
    } catch (e) {
      setMsg(errorText(e));
    }
  }
  // Resuming is allowed only on the session's own calendar day, in the time zone it was recorded in.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: session.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const canResume = !asTrainer && session.status === 'COMPLETED' && session.sessionDate === today;
  async function resume() {
    try {
      await api(`/sessions/${session.id}/reopen`, { method: 'POST' });
      await onChanged();
    } catch (e) {
      setMsg(errorText(e));
    }
  }
  const when = new Date(`${session.sessionDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <div className="stack">
      <nav className="crumbs">
        {asTrainer ? (
          <>
            <Link href="/coaching">Coaching</Link> <span>›</span>{' '}
            <Link href={`/coaching/${session.userId}`}>{traineeName}</Link>
          </>
        ) : (
          <Link href={`/trackers/${tracker.id}`}>{tracker.displayName}</Link>
        )}{' '}
        <span>›</span> {session.name}
      </nav>
      <PageHeader
        title={session.name}
        subtitle={`${asTrainer ? `${traineeName} · ` : ''}${when} · ${session.entryCount} ${session.entryCount === 1 ? 'entry' : 'entries'}${session.trainerId && !asTrainer ? ` · with ${people[session.trainerId] ?? 'your trainer'}` : ''}${session.isAutoClosed ? ' · closed automatically' : ''}`}
        actions={
          <>
            <Badge tone={session.status === 'COMPLETED' ? 'ok' : 'default'}>
              {session.status === 'COMPLETED' ? 'Completed' : 'Discarded'}
            </Badge>
            {!asTrainer && (
              <button
                className="btn"
                onClick={() => {
                  const n = prompt('Session name', session.name);
                  if (n?.trim()) void save({ name: n.trim() });
                }}
              >
                Rename
              </button>
            )}
            <Link
              className={canResume ? 'btn' : 'btn btn-primary'}
              href={asTrainer ? `/coaching/${session.userId}` : `/trackers/${tracker.id}/charts`}
            >
              📈 Charts
            </Link>
            {canResume && (
              <button className="btn btn-primary" onClick={resume} title="Add more entries to this session today">
                ▶ Resume session
              </button>
            )}
          </>
        }
      />
      {msg && <Notice>{msg}</Notice>}
      {used.length === 0 && <Empty>This session has no entries.</Empty>}
      {used.map((a) => {
        const rows = entries
          .filter((e) => e.activityCode === a.code)
          .sort((x, y) => x.recordedAt.localeCompare(y.recordedAt));
        const metrics = a.metrics
          .filter((m) => !m.hidden)
          .map((m) => ({
            m,
            r: evaluateMetric(
              m,
              rows.map((e) => ({ values: e.values })),
            ),
          }))
          .filter(({ m, r }) => m.kind !== 'RATIO' || (r.den ?? 0) > 0)
          .slice(0, 8);
        return (
          <Card key={a.code} title={a.name}>
            <div className="stats" style={{ marginBottom: 14 }}>
              {metrics.map(({ m, r }) => (
                <div className="stat" key={m.key}>
                  <div className="stat-label">{m.label}</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>
                    {formatMetric(m, r.value, prefs)}
                  </div>
                  {m.kind === 'RATIO' && r.den !== null && (
                    <div className="stat-hint">
                      {r.num} of {r.den}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rows.map((e) => (
              <div key={e.clientEntryId} className="entry-row">
                <div className="entry-seq">
                  {a.grouping && e.groupNo
                    ? `${e.groupNo}.${((e.seqNo - 1) % a.grouping.size) + 1}`
                    : `#${rows.indexOf(e) + 1}`}
                </div>
                <div className="entry-vals">
                  <EntryChips activity={a} values={e.values} displayUnits={tracker.displayUnits} prefs={prefs} />
                  {session.trainerId && e.recordedBy && e.recordedBy !== session.userId && (
                    <span className="tag">by {people[e.recordedBy] ?? 'trainer'}</span>
                  )}
                </div>
                <span />
              </div>
            ))}
          </Card>
        );
      })}
      {session.trainerId && (
        <FeedbackPanel
          session={session}
          entries={entries}
          activities={schema.activities}
          people={people}
          canWrite={asTrainer}
          live={false}
        />
      )}
      {asTrainer ? (
        session.notes && <Card title={`${traineeName}'s notes`}>{session.notes}</Card>
      ) : (
        <Card title="Notes">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="What did you work on?"
          />
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => save({ notes })}>
            Save notes
          </button>
        </Card>
      )}
    </div>
  );
}
