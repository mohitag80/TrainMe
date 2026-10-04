'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EntryValidator, evaluateMetric, type EffectiveActivity, type EffectiveParameter } from '@trainme/schema';
import type { UnitPreferences } from '@trainme/units';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/client/api';
import { displayUnitFor, formatMetric, units } from '@/lib/client/format';
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

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session>();
  const [schema, setSchema] = useState<TrackerSchema>();
  const [tracker, setTracker] = useState<TrackerDetail>();
  const [prefs, setPrefs] = useState<UnitPreferences>({});
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [error, setError] = useState<unknown>();

  const load = useCallback(async () => {
    try {
      const s = await api<Session & { entries: SessionEntry[] }>(`/sessions/${id}?include=entries`);
      const [sc, t, p] = await Promise.all([
        api<TrackerSchema>(`/trackers/${s.trackerId}/schema?version=${s.schemaVersion}`),
        api<TrackerDetail>(`/trackers/${s.trackerId}`),
        api<Profile>('/profiles/me'),
      ]);
      const local = loadLocal(id);
      const server: LocalEntry[] = s.entries.map((e) => ({ ...e, synced: true }));
      const pending = (local?.pending ?? []).filter(
        (p) => !server.some((x) => x.clientEntryId === p.clientEntryId && x.rowVersion >= p.rowVersion),
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
      onDone={load}
    />
  ) : (
    <SessionSummary
      session={session}
      schema={schema}
      tracker={tracker}
      prefs={prefs}
      entries={entries}
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
  onDone,
}: {
  session: Session;
  schema: TrackerSchema;
  tracker: TrackerDetail;
  prefs: UnitPreferences;
  entries: LocalEntry[];
  setEntries: React.Dispatch<React.SetStateAction<LocalEntry[]>>;
  onDone: () => Promise<void>;
}) {
  const router = useRouter();
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
  const [values, setValues] = useState<Record<string, unknown>>({});
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
    }
  }, [entries, persist, postBatch, setEntries]);

  // Periodic checkpoint, early flush when many are pending or the tab is hidden (FR-REC-10).
  useEffect(() => {
    const timer = setInterval(() => void flush(), SYNC_SECONDS * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);
  useEffect(() => {
    if (entries.filter((e) => !e.synced && !e.errors).length >= FLUSH_AT_PENDING) void flush();
  }, [entries, flush]);
  useEffect(() => {
    const started = Date.parse(session.startedAt);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [session.startedAt]);

  const visibleParams = activity.parameters.filter(
    (p) => !p.hidden && (!p.condition || values[p.condition.when.key] === p.condition.when.eq),
  );
  const activityEntries = entries.filter((e) => e.activityCode === activity.code);

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
          errs[p.key] = 'must be a number';
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
    for (const i of validator.validate(activity.code, canonical)) errs[i.pointer.replace('/values/', '')] = i.message;
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
    // Keep numbers (similar balls), reset yes/no choices for the next entry.
    setValues((v) =>
      Object.fromEntries(
        Object.entries(v).filter(([k]) => activity.parameters.find((p) => p.key === k)?.type !== 'BOOL'),
      ),
    );
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
  const label =
    activity.recordingMode === 'PER_SET' ? 'set' : activity.recordingMode === 'PER_ATTEMPT' ? 'entry' : 'result';

  return (
    <div className="stack">
      <PageHeader
        title={session.name}
        subtitle={
          <>
            {tracker.displayName} · {session.sessionDate} ·{' '}
            <span className="mono">
              {mm}:{ss}
            </span>
          </>
        }
        actions={
          <>
            <span className="small muted row gap">
              <span className={`sync-dot ${syncState === 'error' ? 'bad' : unsynced ? 'pending' : 'ok'}`} />
              {syncState === 'syncing'
                ? 'Syncing…'
                : unsynced
                  ? `${unsynced} not synced`
                  : lastSync
                    ? `Synced ${lastSync.toLocaleTimeString()}`
                    : 'All synced'}
            </span>
            <button className="btn" onClick={() => void flush()}>
              Sync now
            </button>
            {entries.length === 0 && (
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
              {ending ? 'Ending…' : '■ End session'}
            </button>
          </>
        }
      />
      {syncError && <Notice tone="bad">{syncError}</Notice>}
      <div className="recorder">
        <Card
          title="Log"
          actions={
            activities.length > 1 && (
              <select
                value={activityCode}
                onChange={(e) => {
                  setActivityCode(e.target.value);
                  setValues({});
                  setFormErrors({});
                }}
                aria-label="Activity"
                style={{ width: 240 }}
              >
                {activities.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
            )
          }
        >
          <p className="small muted" style={{ marginBottom: 12 }}>
            {activity.name} ·{' '}
            {activity.grouping
              ? `${activity.grouping.label} ${Math.floor(activityEntries.length / activity.grouping.size) + 1}, ${label} ${(activityEntries.length % activity.grouping.size) + 1}`
              : `${label} ${activityEntries.length + 1}`}
          </p>
          <div className="stack" style={{ gap: 14 }}>
            {visibleParams.map((p) => (
              <ParamInput
                key={p.key}
                p={p}
                unit={displayUnitFor(p, activity.code, tracker.displayUnits, prefs)}
                value={values[p.key]}
                error={formErrors[p.key]}
                onChange={(v) => setValues((cur) => ({ ...cur, [p.key]: v }))}
              />
            ))}
          </div>
          <div className="row gap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={() => logEntry()}>
              + Log {label}
            </button>
            {activityEntries.length > 0 && (
              <button className="btn" onClick={() => logEntry(activityEntries.at(-1)!.values)}>
                Repeat last
              </button>
            )}
          </div>
        </Card>
        <div className="stack">
          <LiveStats activity={activity} entries={activityEntries} prefs={prefs} />
          <Card title={`Entries (${activityEntries.length})`}>
            {activityEntries.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              [...activityEntries].reverse().map((e) => (
                <div key={e.clientEntryId} className="entry-row">
                  <div className="entry-seq">
                    {activity.grouping ? `${e.groupNo}.${((e.seqNo - 1) % activity.grouping.size) + 1}` : `#${e.seqNo}`}
                  </div>
                  <div className="entry-vals">
                    {formatValues(activity, e.values, tracker.displayUnits, prefs)}
                    {e.errors && <div className="field-error">{e.errors.join('; ')}</div>}
                  </div>
                  <div className="row gap">
                    <span
                      className={`sync-dot ${e.errors ? 'bad' : e.synced ? 'ok' : 'pending'}`}
                      title={e.synced ? 'synced' : 'not synced yet'}
                    />
                    <button className="btn btn-sm" onClick={() => removeEntry(e)} aria-label="Delete entry">
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ParamInput({
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
  const label = (
    <>
      {p.label}
      {p.required ? ' *' : ''}
      {unit ? <span className="field-hint"> ({unit})</span> : null}
    </>
  );
  if (p.type === 'BOOL') {
    return (
      <div className="field">
        <span>{label}</span>
        <div className="chips">
          <button type="button" className={`chip yes ${value === true ? 'on' : ''}`} onClick={() => onChange(true)}>
            Yes
          </button>
          <button type="button" className={`chip no ${value === false ? 'on' : ''}`} onClick={() => onChange(false)}>
            No
          </button>
        </div>
        {error && <span className="field-error">{error}</span>}
      </div>
    );
  }
  if (p.type === 'ENUM') {
    return (
      <div className="field">
        <span>{label}</span>
        <div className="chips">
          {(p.constraints.options ?? []).map((o) => (
            <button
              type="button"
              key={o}
              className={`chip ${value === o ? 'on' : ''}`}
              onClick={() => onChange(value === o ? undefined : o)}
            >
              {o.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
        {error && <span className="field-error">{error}</span>}
      </div>
    );
  }
  const numeric = p.type !== 'TEXT';
  const range =
    numeric && p.unit && unit
      ? units.rangeToDisplay(p.constraints.min, p.constraints.max, p.unit, unit)
      : { min: p.constraints.min, max: p.constraints.max };
  const step =
    unit && unit !== p.unit ? (units.get(unit)?.step ?? 'any') : (p.constraints.step ?? (p.type === 'INT' ? 1 : 'any'));
  return (
    <label className="field">
      {label}
      <input
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        step={numeric ? step : undefined}
        min={range.min}
        max={range.max}
        value={(value as string | number | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ maxWidth: 220 }}
      />
      {numeric && (range.min !== undefined || range.max !== undefined) && (
        <span className="field-hint">
          {range.min ?? '…'} – {range.max ?? '…'}
        </span>
      )}
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
  const metrics = activity.metrics.filter((m) => !m.hidden).slice(0, 8);
  const rows = entries.map((e) => ({ values: e.values }));
  return (
    <Card title="Live stats">
      {entries.length === 0 ? (
        <p className="small muted">Stats update after each entry – computed on this device, also offline.</p>
      ) : (
        <div className="stats">
          {metrics.map((m) => {
            const r = evaluateMetric(m, rows);
            return (
              <div className="stat" key={m.key}>
                <div className="stat-label">{m.label}</div>
                <div className="stat-value" style={{ fontSize: 18 }}>
                  {formatMetric(m, r.value, prefs)}
                </div>
                {m.kind === 'RATIO' && r.den !== null && (
                  <div className="stat-hint">
                    {r.num} of {r.den}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function formatValues(
  activity: EffectiveActivity,
  values: Record<string, unknown>,
  displayUnits: Record<string, string>,
  prefs: UnitPreferences,
): string {
  return activity.parameters
    .filter((p) => values[p.key] !== undefined)
    .map((p) => {
      const v = values[p.key];
      if (typeof v === 'boolean') return `${p.label} ${v ? '✓' : '✗'}`;
      if (typeof v === 'number' && p.unit) {
        const shown = displayUnitFor(p, activity.code, displayUnits, prefs) ?? p.unit;
        return `${units.toDisplay(v, p.unit, shown)} ${shown}`;
      }
      return `${p.label}: ${String(v).replaceAll('_', ' ')}`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------- completed session

function SessionSummary({
  session,
  schema,
  tracker,
  prefs,
  entries,
  onChanged,
}: {
  session: Session;
  schema: TrackerSchema;
  tracker: TrackerDetail;
  prefs: UnitPreferences;
  entries: LocalEntry[];
  onChanged: () => Promise<void>;
}) {
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
  return (
    <div className="stack">
      <PageHeader
        title={session.name}
        subtitle={`${tracker.displayName} · ${session.sessionDate} · ${session.entryCount} entries${session.isAutoClosed ? ' · auto-closed' : ''}`}
        actions={
          <>
            <Badge tone={session.status === 'COMPLETED' ? 'ok' : 'default'}>{session.status.toLowerCase()}</Badge>
            <button
              className="btn"
              onClick={() => {
                const n = prompt('Session name', session.name);
                if (n?.trim()) void save({ name: n.trim() });
              }}
            >
              Rename
            </button>
            <Link className="btn btn-primary" href={`/trackers/${tracker.id}/charts`}>
              Charts
            </Link>
          </>
        }
      />
      {msg && <Notice>{msg}</Notice>}
      {used.length === 0 && <Empty>This session has no entries.</Empty>}
      {used.map((a) => {
        const rows = entries.filter((e) => e.activityCode === a.code);
        return (
          <Card key={a.code} title={a.name}>
            <div className="stats" style={{ marginBottom: 12 }}>
              {a.metrics
                .filter((m) => !m.hidden)
                .slice(0, 8)
                .map((m) => {
                  const r = evaluateMetric(
                    m,
                    rows.map((e) => ({ values: e.values })),
                  );
                  return (
                    <div className="stat" key={m.key}>
                      <div className="stat-label">{m.label}</div>
                      <div className="stat-value" style={{ fontSize: 18 }}>
                        {formatMetric(m, r.value, prefs)}
                      </div>
                      {m.kind === 'RATIO' && r.den !== null && (
                        <div className="stat-hint">
                          {r.num} of {r.den}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
            {rows.map((e) => (
              <div key={e.clientEntryId} className="entry-row">
                <div className="entry-seq">
                  {a.grouping ? `${e.groupNo}.${((e.seqNo - 1) % a.grouping.size) + 1}` : `#${e.seqNo}`}
                </div>
                <div className="entry-vals">{formatValues(a, e.values, tracker.displayUnits, prefs)}</div>
                <span />
              </div>
            ))}
          </Card>
        );
      })}
      <Card title="Notes">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          placeholder="What did you work on?"
        />
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => save({ notes })}>
          Save notes
        </button>
      </Card>
    </div>
  );
}
