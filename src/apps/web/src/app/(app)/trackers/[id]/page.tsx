'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { EffectiveActivity, EffectiveParameter } from '@trainme/schema';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, ApiError, errorText } from '@/lib/client/api';
import { defaultSessionName, displayUnitFor, timeZone, todayLocal, units } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Profile, Session, TrackerDetail, TrackerSchema } from '@/lib/types';

export default function TrackerPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const tracker = useData<TrackerDetail>(`/trackers/${id}`);
  const schema = useData<TrackerSchema>(`/trackers/${id}/schema`);
  const profile = useData<Profile>('/profiles/me');
  const sessions = useData<{ items: Session[] }>(`/sessions?trackerId=${id}&limit=10`);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const reloadAll = async () => {
    await Promise.all([tracker.reload(), schema.reload()]);
  };
  if (tracker.error) return <ErrorBanner error={tracker.error} />;
  if (!tracker.data || !schema.data) return <Spinner />;
  const t = tracker.data;
  const prefs = profile.data?.unitPreferences ?? {};

  return (
    <div className="stack">
      <PageHeader
        title={t.displayName}
        subtitle={`${t.templateCode ?? 'Built from scratch'}${t.templateVersion ? ` v${t.templateVersion}` : ''} · schema v${t.schemaVersion}`}
        actions={
          <>
            <Link className="btn" href={`/trackers/${id}/charts`}>
              Charts
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

      {t.status === 'ACTIVE' && <StartSession tracker={t} autoFocus={search.get('start') === '1'} />}

      <Card title="Recent sessions">
        {(sessions.data?.items.length ?? 0) === 0 ? (
          <Empty>No sessions yet.</Empty>
        ) : (
          <ul className="list">
            {sessions.data!.items.map((s) => (
              <li key={s.id}>
                <div>
                  <Link href={`/sessions/${s.id}`} style={{ fontWeight: 700 }}>
                    {s.name}
                  </Link>
                  <div className="small muted">
                    {s.sessionDate} · {s.entryCount} entries{s.isAutoClosed ? ' · auto-closed' : ''}
                  </div>
                </div>
                <Badge tone={s.status === 'COMPLETED' ? 'ok' : 'brand'}>
                  {s.status === 'IN_PROGRESS' ? 'Live' : 'Done'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
            onChanged={async (msg) => {
              setMessage(msg);
              setError(undefined);
              await reloadAll();
            }}
            onError={(e) => {
              setError(e);
              setMessage(undefined);
            }}
          />
        ))}

      <CustomActivity
        trackerId={id}
        rowVersion={t.rowVersion}
        onChanged={async (m) => {
          setMessage(m);
          await reloadAll();
        }}
        onError={setError}
      />

      {t.overrides.length > 0 && (
        <Card title="My customisations">
          <ul className="list">
            {t.overrides.map((o) => (
              <li key={o.id}>
                <div>
                  <Badge tone={o.action === 'ADD' ? 'ok' : o.action === 'HIDE' ? 'warn' : 'brand'}>{o.action}</Badge>{' '}
                  {o.target.toLowerCase()} <strong>{o.itemKey ?? o.activityCode}</strong>{' '}
                  <span className="small muted">in {o.activityCode}</span>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    try {
                      await api(`/trackers/${id}/overrides/${o.id}`, {
                        method: 'DELETE',
                        headers: { 'if-match': `"${t.rowVersion}"` },
                      });
                      setMessage('Customisation removed – takes effect from the next session.');
                      await reloadAll();
                    } catch (e) {
                      setError(errorText(e));
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
        setError(e.message);
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
          <span className="field-hint">Unique per day, e.g. “Morning Nets”, “Evening Gym”</span>
        </label>
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="field-error" style={{ marginTop: 8 }}>
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
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => start()} disabled={busy || !name.trim()}>
          {busy ? 'Starting…' : '▶ Start session'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- activity: parameters, units, customise

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
  const [adding, setAdding] = useState<'param' | 'metric' | null>(null);
  const visible = activity.parameters.filter((p) => !p.hidden);

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
      await onChanged(`${p.label} now shown in ${unit} (stored values unchanged).`);
    } catch (e) {
      onError(errorText(e));
    }
  }

  return (
    <Card
      title={activity.name}
      actions={
        <>
          <Badge tone="brand">{activity.recordingMode.replace('PER_', 'per ').toLowerCase()}</Badge>
          <button className="btn btn-sm" onClick={() => setAdding(adding === 'param' ? null : 'param')}>
            + Parameter
          </button>
          <button className="btn btn-sm" onClick={() => setAdding(adding === 'metric' ? null : 'metric')}>
            + Ratio metric
          </button>
        </>
      }
    >
      {adding === 'param' && (
        <AddParameter
          activity={activity}
          onSubmit={(def) =>
            override(
              { target: 'PARAMETER', action: 'ADD', definition: def },
              `Added ${def.label} – available from the next session.`,
            )
          }
        />
      )}
      {adding === 'metric' && (
        <AddMetric
          activity={activity}
          onSubmit={(def) =>
            override({ target: 'METRIC', action: 'ADD', definition: def }, `Added metric ${def.label}.`)
          }
        />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Shown in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const shown = displayUnitFor(p, activity.code, displayUnits, prefs);
              const options = p.unit ? units.alternatives(p.unit) : [];
              return (
                <tr key={p.key}>
                  <td>
                    {p.label}
                    {p.custom && (
                      <>
                        {' '}
                        <Badge tone="ok">custom</Badge>
                      </>
                    )}
                    {p.condition && (
                      <div className="small muted">
                        when {p.condition.when.key} = {String(p.condition.when.eq)}
                      </div>
                    )}
                  </td>
                  <td className="mono">{p.type}</td>
                  <td>
                    {options.length > 1 ? (
                      <select
                        value={shown}
                        onChange={(e) => setUnit(p, e.target.value)}
                        style={{ width: 110 }}
                        aria-label={`Unit for ${p.label}`}
                      >
                        {options.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (p.unit ?? '')
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        override(
                          { target: 'PARAMETER', action: 'HIDE', itemKey: p.key },
                          `${p.label} hidden – history stays in charts.`,
                        )
                      }
                    >
                      Hide
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Metrics:{' '}
        {activity.metrics
          .filter((m) => !m.hidden)
          .map((m) => m.label)
          .join(' · ') || '–'}
      </p>
    </Card>
  );
}

function AddParameter({
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
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  const numeric = ['INT', 'DECIMAL', 'DURATION'].includes(type);
  return (
    <div className="card" style={{ marginBottom: 12, background: 'var(--bg)' }}>
      <div className="form-grid">
        <label className="field">
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Slower ball" />
          <span className="field-hint mono">key: {key || '…'}</span>
        </label>
        <label className="field">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['BOOL', 'INT', 'DECIMAL', 'ENUM', 'TEXT', 'DURATION'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {numeric && (
          <label className="field">
            Unit (optional)
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, km/h, s, reps…" />
          </label>
        )}
        {type === 'ENUM' && (
          <label className="field">
            Options
            <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="off, middle, leg" />
          </label>
        )}
        <label className="field">
          Only when (optional)
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">always</option>
            {parents.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} = yes
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 10 }}
        disabled={!key}
        onClick={() =>
          onSubmit({
            key,
            label: label.trim(),
            type,
            ...(numeric && unit ? { unit } : {}),
            ...(type === 'ENUM'
              ? {
                  constraints: {
                    options: options
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                }
              : {}),
            ...(parent ? { condition: { when: { key: parent, eq: true } } } : {}),
          })
        }
      >
        Add parameter
      </button>
    </div>
  );
}

function AddMetric({
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
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (bools.length === 0) return <p className="small muted">Ratio metrics need a yes/no parameter.</p>;
  return (
    <div className="card" style={{ marginBottom: 12, background: 'var(--bg)' }}>
      <div className="form-grid">
        <label className="field">
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Slower ball %" />
        </label>
        <label className="field">
          Count of yes for
          <select value={num} onChange={(e) => setNum(e.target.value)}>
            {bools.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Divided by
          <select value={den} onChange={(e) => setDen(e.target.value)}>
            <option value="*">all entries</option>
            {bools.map((p) => (
              <option key={p.key} value={p.key}>
                yes for {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 10 }}
        disabled={!key}
        onClick={() =>
          onSubmit({
            key,
            label: label.trim(),
            kind: 'RATIO',
            numerator: { fn: 'COUNT_TRUE', param: num },
            denominator: den === '*' ? { fn: 'COUNT', param: '*' } : { fn: 'COUNT_TRUE', param: den },
            display: { format: 'PERCENT', decimals: 1 },
          })
        }
      >
        Add metric
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
  const code = useMemo(
    () =>
      `custom.${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50)}`,
    [name],
  );
  if (!open)
    return (
      <div>
        <button className="btn" onClick={() => setOpen(true)}>
          + Add custom activity
        </button>
      </div>
    );
  return (
    <Card title="Custom activity">
      <div className="form-grid">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shadow bowling" />
        </label>
        <label className="field">
          Recorded
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="PER_ATTEMPT">per attempt</option>
            <option value="PER_SET">per set</option>
            <option value="PER_SESSION">once per session</option>
          </select>
        </label>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 10 }}
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
            await onChanged(`Added ${name.trim()} – now add its parameters.`);
          } catch (e) {
            onError(errorText(e));
          }
        }}
      >
        Create activity
      </button>
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
          if (!confirm(`Delete “${tracker.displayName}”? Sessions are removed asynchronously.`)) return;
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
      A new version (v{version}) of this profile is available.{' '}
      {!preview ? (
        <button
          className="btn btn-sm"
          onClick={async () => setPreview(await api(`/trackers/${trackerId}/upgrade?dryRun=true`, { method: 'POST' }))}
        >
          Preview
        </button>
      ) : (
        <>
          Adds {preview.addedActivities.length}, removes {preview.removedActivities.length} activities;{' '}
          {preview.droppedOverrides.length} customisations no longer apply.{' '}
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
            Upgrade
          </button>
        </>
      )}
    </Notice>
  );
}
