'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { EffectiveActivity, EffectiveParameter } from '@trainme/schema';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { ParameterTable } from '@/components/parameter-table';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/client/api';
import { defaultSessionName, displayUnitFor, timeZone, todayLocal, units } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import { humanize, recordingModeLabel, type ParamRow } from '@/lib/labels';
import type { Profile, Session, TrackerDetail, TrackerSchema } from '@/lib/types';

export default function TrackerPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const tracker = useData<TrackerDetail>(`/trackers/${id}`);
  const schema = useData<TrackerSchema>(`/trackers/${id}/schema`);
  const profile = useData<Profile>('/profiles/me');
  const sessions = useData<{ items: Session[] }>(`/sessions?trackerId=${id}&limit=8`);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const reloadAll = async () => {
    await Promise.all([tracker.reload(), schema.reload()]);
  };
  const done = async (msg: string) => {
    setMessage(msg);
    setError(undefined);
    await reloadAll();
  };
  const failed = (e: string) => {
    setError(e);
    setMessage(undefined);
  };

  if (tracker.error) return <ErrorBanner error={tracker.error} />;
  if (!tracker.data || !schema.data) return <Spinner />;
  const t = tracker.data;
  const prefs = profile.data?.unitPreferences ?? {};
  const based = t.templateCode
    ? `Based on the ${humanize(t.templateCode.split('.').pop() ?? '')} profile`
    : 'Your own tracker';

  return (
    <div className="stack">
      <nav className="crumbs">
        <Link href="/dashboard">Dashboard</Link> <span>›</span> {t.displayName}
      </nav>
      <PageHeader
        title={t.displayName}
        subtitle={`${based}${t.status === 'ARCHIVED' ? ' · archived' : ''}`}
        actions={
          <>
            <Link className="btn" href={`/trackers/${id}/charts`}>
              📈 Charts
            </Link>
            <TrackerMenu tracker={t} onChanged={reloadAll} />
          </>
        }
      />
      {message && <Notice>{message}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {t.upgradeAvailable && (
        <UpgradeBanner
          trackerId={id}
          rowVersion={t.rowVersion}
          version={t.upgradeAvailable.version}
          onDone={reloadAll}
        />
      )}

      <div className="grid-2">
        {t.status === 'ACTIVE' ? (
          <StartSession tracker={t} autoFocus={search.get('start') === '1'} />
        ) : (
          <Card title="Archived">Restore this tracker to record new sessions.</Card>
        )}
        <Card
          title="Recent sessions"
          actions={
            <Link className="btn btn-sm btn-ghost" href="/sessions">
              All sessions
            </Link>
          }
        >
          {(sessions.data?.items.length ?? 0) === 0 ? (
            <Empty>No sessions yet – start your first one.</Empty>
          ) : (
            <ul className="list">
              {sessions.data!.items.map((s) => (
                <li key={s.id}>
                  <div>
                    <Link href={`/sessions/${s.id}`} style={{ fontWeight: 700 }}>
                      {s.name}
                    </Link>
                    <div className="small muted">
                      {new Date(`${s.sessionDate}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      · {s.entryCount} {s.entryCount === 1 ? 'entry' : 'entries'}
                      {s.isAutoClosed ? ' · closed automatically' : ''}
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

      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h2>What you record</h2>
          <p className="muted small">
            Changes apply from your next session. Hidden fields stay in your history and charts.
          </p>
        </div>
      </div>
      {schema.data.activities
        .filter((a) => !a.hidden)
        .map((a) => (
          <ActivityCard
            key={a.code}
            trackerId={id}
            activity={a}
            displayUnits={t.displayUnits}
            prefs={prefs}
            rowVersion={t.rowVersion}
            onChanged={done}
            onError={failed}
          />
        ))}

      <CustomActivity trackerId={id} rowVersion={t.rowVersion} onChanged={done} onError={failed} />

      {t.overrides.length > 0 && (
        <Card title="Your changes">
          <ul className="list">
            {t.overrides.map((o) => (
              <li key={o.id}>
                <div>
                  <Badge tone={o.action === 'ADD' ? 'ok' : o.action === 'HIDE' ? 'warn' : 'brand'}>
                    {o.action === 'ADD' ? 'Added' : o.action === 'HIDE' ? 'Hidden' : 'Changed'}
                  </Badge>{' '}
                  {describeOverride(o, schema.data!)}
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    try {
                      await api(`/trackers/${id}/overrides/${o.id}`, {
                        method: 'DELETE',
                        headers: { 'if-match': `"${t.rowVersion}"` },
                      });
                      await done('Change undone – applies from your next session.');
                    } catch (e) {
                      failed(errorText(e));
                    }
                  }}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- start a named session (FR-REC-17..20)

function StartSession({ tracker, autoFocus }: { tracker: TrackerDetail; autoFocus: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(() => defaultSessionName(tracker.displayName.replace(/^My /, '')));
  const [date, setDate] = useState(todayLocal());
  const [suggestion, setSuggestion] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start(useName = name) {
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<Session>('/sessions', {
        method: 'POST',
        body: {
          clientSessionId: crypto.randomUUID(),
          trackerId: tracker.id,
          name: useName,
          sessionDate: date,
          startedAt: new Date().toISOString(),
          timezone: timeZone(),
          source: 'WEB',
          onNameConflict: 'REJECT',
        },
      });
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && typeof e.problem.suggestedName === 'string') {
        setSuggestion(e.problem.suggestedName);
        setError(`You already have “${useName}” on this day.`);
      } else setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Card title="Start a session">
      <div className="form-grid">
        <label className="field">
          Session name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuggestion(undefined);
            }}
            maxLength={80}
            autoFocus={autoFocus}
          />
          <span className="field-hint">Unique for the day – e.g. “Morning Nets”, “Evening Gym”</span>
        </label>
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && (
        <div className="alert alert-warn" style={{ marginTop: 12 }}>
          {error}{' '}
          {suggestion && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setName(suggestion);
                void start(suggestion);
              }}
            >
              Use “{suggestion}”
            </button>
          )}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="btn btn-primary btn-lg" onClick={() => start()} disabled={busy || !name.trim()}>
          {busy ? 'Starting…' : '▶ Start session'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- activity: fields, units, customise

function ActivityCard({
  trackerId,
  activity,
  displayUnits,
  prefs,
  rowVersion,
  onChanged,
  onError,
}: {
  trackerId: string;
  activity: EffectiveActivity;
  displayUnits: Record<string, string>;
  prefs: Profile['unitPreferences'];
  rowVersion: number;
  onChanged: (msg: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const [adding, setAdding] = useState<'field' | 'stat' | null>(null);

  async function override(body: Record<string, unknown>, msg: string) {
    try {
      await api(`/trackers/${trackerId}/overrides`, {
        method: 'POST',
        body: { activityCode: activity.code, ...body },
        headers: { 'if-match': `"${rowVersion}"` },
      });
      setAdding(null);
      await onChanged(msg);
    } catch (e) {
      onError(errorText(e));
    }
  }
  async function setUnit(p: EffectiveParameter, unit: string) {
    try {
      await api(`/trackers/${trackerId}/display-units`, {
        method: 'PUT',
        body: { displayUnits: { [`${activity.code}.${p.key}`]: unit === p.unit ? null : unit } },
      });
      await onChanged(`${p.label} is now shown in ${unit}. Your recorded values are unchanged.`);
    } catch (e) {
      onError(errorText(e));
    }
  }

  return (
    <Card
      title={activity.name}
      actions={
        <>
          <Badge tone="brand">{recordingModeLabel(activity.recordingMode)}</Badge>
          <button className="btn btn-sm" onClick={() => setAdding(adding === 'field' ? null : 'field')}>
            + Add field
          </button>
          <button className="btn btn-sm" onClick={() => setAdding(adding === 'stat' ? null : 'stat')}>
            + Add % stat
          </button>
        </>
      }
    >
      {adding === 'field' && (
        <AddField
          activity={activity}
          onSubmit={(def) =>
            override(
              { target: 'PARAMETER', action: 'ADD', definition: def },
              `Added “${def.label}” – you’ll see it from your next session.`,
            )
          }
        />
      )}
      {adding === 'stat' && (
        <AddStat
          activity={activity}
          onSubmit={(def) =>
            override({ target: 'METRIC', action: 'ADD', definition: def }, `Added the stat “${def.label}”.`)
          }
        />
      )}
      <ParameterTable
        params={activity.parameters}
        unitCell={(p) => {
          const options = p.unit ? units.alternatives(p.unit) : [];
          if (options.length < 2) return p.unit ?? <span className="muted">–</span>;
          return (
            <select
              className="unit-select"
              value={displayUnitFor(p, activity.code, displayUnits, prefs)}
              onChange={(e) => setUnit(p, e.target.value)}
              aria-label={`Unit for ${p.label}`}
            >
              {options.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code}
                </option>
              ))}
            </select>
          );
        }}
        actions={(row: ParamRow) => {
          const target = row.kind === 'skill' ? row.attempted : row.param;
          const label = row.kind === 'skill' ? row.name : row.param.label;
          return (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                override(
                  { target: 'PARAMETER', action: 'HIDE', itemKey: target.key },
                  `“${label}” hidden – earlier sessions still show it in charts.`,
                )
              }
            >
              Hide
            </button>
          );
        }}
      />
      {activity.metrics.some((m) => !m.hidden) && (
        <div className="metric-chips">
          <span className="muted small">Charts:</span>
          {activity.metrics
            .filter((m) => !m.hidden)
            .map((m) => (
              <span key={m.key} className="tag">
                {m.label}
              </span>
            ))}
        </div>
      )}
    </Card>
  );
}

const FIELD_TYPES = [
  { value: 'BOOL', label: 'Yes / No switch' },
  { value: 'INT', label: 'Whole number (e.g. reps)' },
  { value: 'DECIMAL', label: 'Number (e.g. speed, weight)' },
  { value: 'ENUM', label: 'Pick one of a list' },
  { value: 'DURATION', label: 'Time' },
  { value: 'TEXT', label: 'Short note' },
];

const toKey = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

function AddField({
  activity,
  onSubmit,
}: {
  activity: EffectiveActivity;
  onSubmit: (def: Record<string, unknown> & { label: string }) => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('BOOL');
  const [unit, setUnit] = useState('');
  const [options, setOptions] = useState('');
  const [parent, setParent] = useState('');
  const parents = activity.parameters.filter((p) => !p.hidden && p.type === 'BOOL');
  const numeric = ['INT', 'DECIMAL', 'DURATION'].includes(type);
  return (
    <div className="card" style={{ marginBottom: 14, background: 'var(--bg)', boxShadow: 'none' }}>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Slower ball" />
        </label>
        <label className="field">
          Recorded as
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {numeric && (
          <label className="field">
            Unit (optional)
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, km/h, m, reps…" />
          </label>
        )}
        {type === 'ENUM' && (
          <label className="field">
            Choices
            <input
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="Off side, Middle, Leg side"
            />
            <span className="field-hint">Separate with commas</span>
          </label>
        )}
        <label className="field">
          Show it
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">always</option>
            {parents.map((p) => (
              <option key={p.key} value={p.key}>
                only when “{p.label}” is on
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 12 }}
        disabled={!toKey(label)}
        onClick={() =>
          onSubmit({
            key: toKey(label),
            label: label.trim(),
            type,
            ...(numeric && unit ? { unit } : {}),
            ...(type === 'ENUM' ? { constraints: { options: options.split(',').map(toKey).filter(Boolean) } } : {}),
            ...(parent ? { condition: { when: { key: parent, eq: true } } } : {}),
          })
        }
      >
        Add field
      </button>
    </div>
  );
}

function AddStat({
  activity,
  onSubmit,
}: {
  activity: EffectiveActivity;
  onSubmit: (def: Record<string, unknown> & { label: string }) => void;
}) {
  const bools = activity.parameters.filter((p) => p.type === 'BOOL' && !p.hidden);
  const [label, setLabel] = useState('');
  const [num, setNum] = useState(bools[0]?.key ?? '');
  const [den, setDen] = useState('*');
  if (bools.length === 0) return <p className="small muted">A % stat needs a yes/no field – add one first.</p>;
  return (
    <div className="card" style={{ marginBottom: 14, background: 'var(--bg)', boxShadow: 'none' }}>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Slower ball %" />
        </label>
        <label className="field">
          Count how often
          <select value={num} onChange={(e) => setNum(e.target.value)}>
            {bools.map((p) => (
              <option key={p.key} value={p.key}>
                “{p.label}” is on
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Out of
          <select value={den} onChange={(e) => setDen(e.target.value)}>
            <option value="*">every entry</option>
            {bools.map((p) => (
              <option key={p.key} value={p.key}>
                entries where “{p.label}” is on
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 12 }}
        disabled={!toKey(label)}
        onClick={() =>
          onSubmit({
            key: toKey(label),
            label: label.trim(),
            kind: 'RATIO',
            numerator: { fn: 'COUNT_TRUE', param: num },
            denominator: den === '*' ? { fn: 'COUNT', param: '*' } : { fn: 'COUNT_TRUE', param: den },
            display: { format: 'PERCENT', decimals: 1 },
          })
        }
      >
        Add stat
      </button>
    </div>
  );
}

function CustomActivity({
  trackerId,
  rowVersion,
  onChanged,
  onError,
}: {
  trackerId: string;
  rowVersion: number;
  onChanged: (m: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('PER_SET');
  const code = useMemo(() => `custom.${toKey(name).slice(0, 50)}`, [name]);
  if (!open)
    return (
      <div>
        <button className="btn" onClick={() => setOpen(true)}>
          + Add your own activity
        </button>
      </div>
    );
  return (
    <Card title="Your own activity">
      <div className="form-grid">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shadow bowling" />
        </label>
        <label className="field">
          Recorded
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="PER_ATTEMPT">Each ball / attempt</option>
            <option value="PER_SET">Each set</option>
            <option value="PER_SESSION">Once per session</option>
          </select>
        </label>
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={name.trim().length < 2}
          onClick={async () => {
            try {
              await api(`/trackers/${trackerId}/overrides`, {
                method: 'POST',
                body: {
                  target: 'ACTIVITY',
                  action: 'ADD',
                  activityCode: code,
                  definition: { code, name: name.trim(), recordingMode: mode },
                },
                headers: { 'if-match': `"${rowVersion}"` },
              });
              setOpen(false);
              await onChanged(`Added “${name.trim()}” – now add its fields.`);
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          Create activity
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- rename / archive / upgrade

function TrackerMenu({ tracker, onChanged }: { tracker: TrackerDetail; onChanged: () => Promise<void> }) {
  const router = useRouter();
  async function patch(body: Record<string, unknown>) {
    await api(`/trackers/${tracker.id}`, { method: 'PATCH', body, headers: { 'if-match': `"${tracker.rowVersion}"` } });
    await onChanged();
  }
  return (
    <>
      <button
        className="btn"
        onClick={async () => {
          const n = prompt('Tracker name', tracker.displayName);
          if (n?.trim()) await patch({ displayName: n.trim() }).catch((e) => alert(errorText(e)));
        }}
      >
        Rename
      </button>
      <button
        className="btn"
        onClick={() =>
          patch({ status: tracker.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }).catch((e) => alert(errorText(e)))
        }
      >
        {tracker.status === 'ACTIVE' ? 'Archive' : 'Restore'}
      </button>
      <button
        className="btn btn-danger"
        onClick={async () => {
          if (!confirm(`Delete “${tracker.displayName}” and its sessions?`)) return;
          await api(`/trackers/${tracker.id}`, { method: 'DELETE', headers: { 'if-match': `"${tracker.rowVersion}"` } })
            .then(() => router.push('/dashboard'))
            .catch((e) => alert(errorText(e)));
        }}
      >
        Delete
      </button>
    </>
  );
}

function UpgradeBanner({
  trackerId,
  rowVersion,
  version,
  onDone,
}: {
  trackerId: string;
  rowVersion: number;
  version: number;
  onDone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<{
    addedActivities: string[];
    removedActivities: string[];
    droppedOverrides: string[];
  }>();
  return (
    <Notice tone="warn">
      A newer version of this profile is available.{' '}
      {!preview ? (
        <button
          className="btn btn-sm"
          onClick={async () => setPreview(await api(`/trackers/${trackerId}/upgrade?dryRun=true`, { method: 'POST' }))}
        >
          What changes?
        </button>
      ) : (
        <>
          It adds {preview.addedActivities.length} and removes {preview.removedActivities.length} activities
          {preview.droppedOverrides.length
            ? `; ${preview.droppedOverrides.length} of your changes no longer apply`
            : ''}
          .{' '}
          <button
            className="btn btn-sm btn-primary"
            onClick={async () => {
              await api(`/trackers/${trackerId}/upgrade`, {
                method: 'POST',
                headers: { 'if-match': `"${rowVersion}"` },
              });
              await onDone();
            }}
          >
            Update to v{version}
          </button>
        </>
      )}
    </Notice>
  );
}

/** "Added field “Slower ball” in Fast Bowling – Delivery" – no keys or codes. */
function describeOverride(o: TrackerDetail['overrides'][number], schema: TrackerSchema): string {
  const activity = schema.activities.find((a) => a.code === o.activityCode);
  if (o.target === 'ACTIVITY')
    return o.action === 'ADD'
      ? `activity “${String(o.definition.name ?? humanize(o.activityCode))}”`
      : `activity “${activity?.name ?? humanize(o.activityCode)}”`;
  const item =
    activity?.parameters.find((p) => p.key === o.itemKey)?.label ??
    activity?.metrics.find((m) => m.key === o.itemKey)?.label ??
    (typeof o.definition.label === 'string' ? o.definition.label : humanize(o.itemKey ?? ''));
  return `${o.target === 'METRIC' ? 'stat' : 'field'} “${item}”${activity ? ` in ${activity.name}` : ''}`;
}
