'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  DataType,
  EffectiveParameter,
  MetricDefinition,
  ParameterDefinition,
  RecordingMode,
} from '@trainme/schema';
import { CategoryPicker } from '@/components/admin/category-picker';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Switch } from '@/components/controls';
import { ParameterTable } from '@/components/parameter-table';
import { Badge, Card, PageHeader } from '@/components/ui';
import {
  ACTIVITY_KINDS,
  ANSWER_TYPES,
  buildMetric,
  describeMetric,
  keyFrom,
  LEVELS,
  NUMBER_STATS,
  optionValue,
  RECORDING_MODES,
  STATUS_LABEL,
  STATUS_TONE,
  type ActivityDoc,
  type StatChoice,
  type TreeNode,
} from '@/lib/admin';
import { api, ApiError, errorText } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';
import { humanize, skillName } from '@/lib/labels';

type Unit = { code: string; dimension: string | null; label: string };
interface Form {
  name: string;
  categoryCode: string | null;
  kind: string;
  recordingMode: RecordingMode;
  level: string;
  description: string;
  equipment: string;
  synonyms: string;
  parameters: ParameterDefinition[];
  metrics: MetricDefinition[];
}

const blank = (categoryCode: string | null): Form => ({
  name: '',
  categoryCode,
  kind: 'DRILL',
  recordingMode: 'PER_ATTEMPT',
  level: '',
  description: '',
  equipment: '',
  synonyms: '',
  parameters: [],
  metrics: [],
});
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Creates or edits one activity version. Published and retired versions are read-only ("Edit" opens a new
 * draft); drafts can be saved, published or deleted. Keys and codes are generated and never shown.
 */
export function ActivityEditor({
  code,
  version,
  categoryCode,
}: {
  code?: string;
  version?: number;
  categoryCode?: string;
}) {
  const router = useRouter();
  // Created from a profile's "+ New activity": go back there afterwards and add it to that profile.
  const sp = useSearchParams();
  const forProfile = sp.get('profile')
    ? { code: sp.get('profile')!, version: sp.get('pv') ?? '1', name: sp.get('pname') ?? 'the profile' }
    : null;
  const keepQuery = forProfile
    ? `?${new URLSearchParams({ profile: forProfile.code, pv: forProfile.version, pname: forProfile.name })}`
    : '';
  const backToProfile = (activityCode: string) => {
    if (forProfile)
      router.push(
        `/admin/profiles/${encodeURIComponent(forProfile.code)}/${forProfile.version}?add=${encodeURIComponent(activityCode)}`,
      );
  };
  const tree = useData<{ items: TreeNode[] }>('/admin/catalog/tree');
  const units = useData<{ units: Unit[] }>('/units');
  const doc = useData<ActivityDoc>(
    code && version ? `/admin/catalog/activities/${encodeURIComponent(code)}/versions/${version}` : null,
  );
  const [form, setForm] = useState<Form>(blank(categoryCode ?? null));
  const [fixedKeys, setFixedKeys] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ index: number | null; skill?: boolean } | null>(null);
  const [addingStat, setAddingStat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    tone: 'ok' | 'bad';
    text: string;
    list?: string[];
    link?: string;
    linkText?: string;
  }>();

  useEffect(() => {
    const d = doc.data;
    if (!d) return;
    setForm({
      name: d.name,
      categoryCode: d.categoryCode,
      kind: d.kind,
      recordingMode: d.recordingMode,
      level: d.level ?? '',
      description: d.description ?? '',
      equipment: d.equipment.map(humanize).join(', '),
      synonyms: d.synonyms.join(', '),
      parameters: d.parameters,
      metrics: d.metrics,
    });
    // Fields of any earlier (non-draft) version keep their kind of answer and unit.
    const earlier = d.versions.filter((v) => v.status !== 'DRAFT' && v.version !== d.version);
    if (d.status === 'DRAFT' && earlier.length)
      void api<ActivityDoc>(
        `/admin/catalog/activities/${encodeURIComponent(d.code)}/versions/${earlier[0]!.version}`,
      ).then((prev) => setFixedKeys(new Set(prev.parameters.map((p) => p.key))));
  }, [doc.data]);

  const readOnly = !!doc.data && doc.data.status !== 'DRAFT';
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const body = () => ({
    name: form.name.trim(),
    categoryCode: form.categoryCode ?? '',
    kind: form.kind,
    recordingMode: form.recordingMode,
    level: form.level || null,
    description: form.description.trim() || null,
    equipment: list(form.equipment),
    synonyms: list(form.synonyms),
    parameters: form.parameters,
    metrics: form.metrics,
  });
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.problem.type?.endsWith('/duplicate-name')) {
      const ex = e.problem.existing as { code: string; version: number; kind: 'profile' | 'activity' } | undefined;
      setMsg({
        tone: 'bad',
        text: `${e.message}. Open that one instead, or choose another name.`,
        ...(ex
          ? {
              link: `/admin/${ex.kind === 'profile' ? 'profiles' : 'activities'}/${encodeURIComponent(ex.code)}/${ex.version}`,
              linkText: 'Open it →',
            }
          : {}),
      });
      return;
    }
    const errors = e instanceof ApiError ? (e.problem.errors ?? []).map((x) => x.message) : [];
    setMsg({ tone: 'bad', text: errors.length ? 'Please fix these before saving:' : errorText(e), list: errors });
  };

  async function save(): Promise<{ code: string; version: number } | null> {
    if (!form.categoryCode) {
      setMsg({ tone: 'bad', text: 'Choose where this activity belongs in the catalog.' });
      return null;
    }
    setBusy(true);
    try {
      const r =
        code && version
          ? await api<{ code: string; version: number }>(
              `/admin/catalog/activities/${encodeURIComponent(code)}/versions/${version}`,
              { method: 'PUT', body: body() },
            )
          : await api<{ code: string; version: number }>('/admin/catalog/activities', { method: 'POST', body: body() });
      setMsg({ tone: 'ok', text: 'Draft saved. Users will not see it until you publish.' });
      if (!code) router.replace(`/admin/activities/${encodeURIComponent(r.code)}/${r.version}${keepQuery}`);
      else await doc.reload();
      return r;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const r = await api<{ updatedTemplates: string[] }>(
        `/admin/catalog/activities/${encodeURIComponent(saved.code)}/versions/${saved.version}/publish`,
        { method: 'POST' },
      );
      setMsg({
        tone: 'ok',
        text: r.updatedTemplates.length
          ? `Published. These profiles got a new version with it: ${r.updatedTemplates.join(', ')}. Their users will see “update available”.`
          : 'Published. It can now be added to profiles and to trackers from the catalog.',
      });
      if (forProfile) {
        backToProfile(saved.code);
        return;
      }
      router.replace(`/admin/activities/${encodeURIComponent(saved.code)}/${saved.version}`);
      await doc.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function act(
    path: string,
    method: string,
    done: string,
    then?: (r: { code: string; version: number }) => void,
  ) {
    setBusy(true);
    try {
      const r = await api<{ code: string; version: number }>(path, { method });
      setMsg({ tone: 'ok', text: done });
      then?.(r);
      await doc.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const params = form.parameters;
  const nodes = tree.data?.items ?? [];
  if (doc.error) return <ErrorBanner error={doc.error} />;
  if (!tree.data || !units.data || (code && !doc.data)) return <Spinner />;
  const d = doc.data;
  const base = d ? `/admin/catalog/activities/${encodeURIComponent(d.code)}/versions/${d.version}` : '';

  return (
    <div className="stack">
      <nav className="crumbs">
        <Link href="/admin?view=activities">Catalog admin</Link> <span>›</span> {d ? d.name : 'New activity'}
      </nav>
      <PageHeader
        title={form.name.trim() || 'New activity'}
        subtitle={
          d ? (
            <span className="row gap-sm">
              <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge> Version {d.version}
              {d.usedBy.length > 0 && <span className="muted">· used in {d.usedBy.join(', ')}</span>}
            </span>
          ) : (
            'Starts as a draft – nobody sees it until you publish.'
          )
        }
        actions={
          readOnly ? (
            <>
              {d!.status === 'PUBLISHED' && (
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    confirm('Retire this activity? It disappears from search; trackers keep it.') &&
                    act(`${base}/retire`, 'POST', 'Retired.')
                  }
                >
                  Retire
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  act(
                    `/admin/catalog/activities/${encodeURIComponent(d!.code)}/drafts`,
                    'POST',
                    'Draft opened – edit and publish when ready.',
                    (r) => router.push(`/admin/activities/${encodeURIComponent(r.code)}/${r.version}`),
                  )
                }
              >
                Edit (new draft)
              </button>
            </>
          ) : (
            <>
              {d && (
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm('Delete this draft?')) return;
                    try {
                      await api(base, { method: 'DELETE' });
                      router.push('/admin?view=activities');
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Delete draft
                </button>
              )}
              {forProfile ? (
                <>
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      router.push(`/admin/profiles/${encodeURIComponent(forProfile.code)}/${forProfile.version}`)
                    }
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || params.length === 0}
                    title={params.length === 0 ? 'Add at least one field first' : undefined}
                    onClick={async () => {
                      const s = await save();
                      if (s) backToProfile(s.code);
                    }}
                  >
                    Save and add to “{forProfile.name}”
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" disabled={busy} onClick={save}>
                    Save draft
                  </button>
                  <button className="btn btn-primary" disabled={busy || params.length === 0} onClick={publish}>
                    Publish
                  </button>
                </>
              )}
            </>
          )
        }
      />
      {forProfile && (
        <Notice tone="warn">
          New activity for the profile “{forProfile.name}”. Add its fields, then click <b>Save and add</b> – it is
          published together with the profile when you publish “{forProfile.name}”.
        </Notice>
      )}
      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}
          {msg.link && (
            <>
              {' '}
              <Link href={msg.link}>{msg.linkText ?? 'Open →'}</Link>
            </>
          )}
          {msg.list && msg.list.length > 0 && (
            <ul className="error-list">
              {msg.list.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {d && d.versions.length > 1 && (
        <div className="row gap-sm wrap small">
          <span className="muted">Versions:</span>
          {d.versions.map((v) => (
            <Link
              key={v.version}
              className={`chip${v.version === d.version ? ' on' : ''}`}
              href={`/admin/activities/${encodeURIComponent(d.code)}/${v.version}`}
            >
              {v.version} · {STATUS_LABEL[v.status]}
            </Link>
          ))}
        </div>
      )}

      <Card title="About this activity">
        <div className="form-grid">
          <label className="field">
            Name
            <input
              value={form.name}
              disabled={readOnly}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Table Tennis – Serve"
            />
          </label>
          <div className="field">
            Where it belongs
            <CategoryPicker
              tree={nodes}
              value={form.categoryCode}
              onChange={(c) => set('categoryCode', c)}
              onTreeChanged={tree.reload}
              disabled={readOnly}
            />
          </div>
          <label className="field">
            Type
            <select value={form.kind} disabled={readOnly} onChange={(e) => set('kind', e.target.value)}>
              {ACTIVITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Recorded
            <select
              value={form.recordingMode}
              disabled={readOnly}
              onChange={(e) => set('recordingMode', e.target.value as RecordingMode)}
            >
              {RECORDING_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Level
            <select value={form.level} disabled={readOnly} onChange={(e) => set('level', e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Equipment
            <input
              value={form.equipment}
              disabled={readOnly}
              onChange={(e) => set('equipment', e.target.value)}
              placeholder="e.g. Table tennis bat, Balls, Table"
            />
            <span className="field-hint">Separate with commas</span>
          </label>
          <label className="field span-2">
            Description
            <textarea
              rows={2}
              value={form.description}
              disabled={readOnly}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What the player does and what to record"
            />
          </label>
          <label className="field span-2">
            Other names people search for
            <input
              value={form.synonyms}
              disabled={readOnly}
              onChange={(e) => set('synonyms', e.target.value)}
              placeholder="e.g. ping pong serve, service practice"
            />
          </label>
        </div>
      </Card>

      <Card
        title={`What players record · ${params.length} ${params.length === 1 ? 'field' : 'fields'}`}
        actions={
          !readOnly && (
            <>
              <button className="btn btn-sm" onClick={() => setEditing({ index: null })}>
                + Add field
              </button>
              <button className="btn btn-sm" onClick={() => setEditing({ index: null, skill: true })}>
                + Add skill (tried → result)
              </button>
            </>
          )
        }
      >
        {editing?.skill && (
          <SkillForm
            taken={params.map((p) => p.key)}
            onCancel={() => setEditing(null)}
            onSave={(pair, stat) => {
              setForm((f) => ({
                ...f,
                parameters: [...f.parameters, ...pair],
                metrics: stat
                  ? [
                      ...f.metrics,
                      buildMetric(
                        stat,
                        { kind: 'percent', yes: pair[1]!.key, of: pair[0]!.key },
                        [...f.parameters, ...pair],
                        f.metrics.map((m) => m.key),
                      ),
                    ]
                  : f.metrics,
              }));
              setEditing(null);
            }}
          />
        )}
        {editing && !editing.skill && (
          <FieldForm
            initial={editing.index === null ? undefined : params[editing.index]}
            others={params.filter((_, i) => i !== editing.index)}
            units={units.data.units}
            fixed={editing.index !== null && fixedKeys.has(params[editing.index]!.key)}
            onCancel={() => setEditing(null)}
            onSave={(p) => {
              setForm((f) => ({
                ...f,
                parameters:
                  editing.index === null
                    ? [...f.parameters, p]
                    : f.parameters.map((x, i) => (i === editing.index ? p : x)),
              }));
              setEditing(null);
            }}
          />
        )}
        <ParameterTable
          params={params as EffectiveParameter[]}
          actions={
            readOnly
              ? undefined
              : (row) => {
                  const keys = row.kind === 'skill' ? [row.attempted.key, row.result.key] : [row.param.key];
                  const first = params.findIndex((p) => p.key === keys[0]);
                  const used = form.metrics.some((m) =>
                    JSON.stringify([m.numerator, m.denominator]).match(new RegExp(`"(${keys.join('|')})"`)),
                  );
                  return (
                    <span className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
                      {row.kind === 'single' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ index: first })}>
                          Edit
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={first <= 0}
                        title="Move up"
                        onClick={() =>
                          setForm((f) => {
                            const ps = [...f.parameters];
                            const moving = ps.filter((p) => keys.includes(p.key));
                            const rest = ps.filter((p) => !keys.includes(p.key));
                            const before = rest.findIndex((p) => p.key === ps[first - 1]?.key);
                            const at = Math.max(0, before);
                            return { ...f, parameters: [...rest.slice(0, at), ...moving, ...rest.slice(at)] };
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        title={used ? 'Remove the stats that use it first' : 'Remove'}
                        disabled={used}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            parameters: f.parameters
                              .filter((p) => !keys.includes(p.key))
                              .map((p) =>
                                p.condition && keys.includes(p.condition.when.key) ? { ...p, condition: undefined } : p,
                              ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </span>
                  );
                }
          }
        />
      </Card>

      <Card
        title={`Stats players see · ${form.metrics.length}`}
        actions={
          !readOnly && (
            <button className="btn btn-sm" disabled={params.length === 0} onClick={() => setAddingStat(true)}>
              + Add stat
            </button>
          )
        }
      >
        {addingStat && (
          <StatForm
            params={params}
            onCancel={() => setAddingStat(false)}
            onSave={(label, choice) => {
              setForm((f) => ({
                ...f,
                metrics: [
                  ...f.metrics,
                  buildMetric(
                    label,
                    choice,
                    f.parameters,
                    f.metrics.map((m) => m.key),
                  ),
                ],
              }));
              setAddingStat(false);
            }}
          />
        )}
        {form.metrics.length === 0 ? (
          <p className="muted small">No stats yet. Add one so players see progress in charts.</p>
        ) : (
          <ul className="list">
            {form.metrics.map((m) => (
              <li key={m.key}>
                <div>
                  <div className="pname">{m.label}</div>
                  <div className="phint">{describeMetric(m, params)}</div>
                </div>
                {!readOnly && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setForm((f) => ({ ...f, metrics: f.metrics.filter((x) => x.key !== m.key) }))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- one field

const NUMERIC: DataType[] = ['INT', 'DECIMAL', 'DURATION'];
const SUMMARY: Record<string, { value: ParameterDefinition['agg']; label: string }[]> = {
  number: [
    { value: 'AVG', label: 'Average' },
    { value: 'MAX', label: 'Best (highest)' },
    { value: 'MIN', label: 'Lowest' },
    { value: 'SUM', label: 'Total' },
  ],
  BOOL: [
    { value: 'COUNT_TRUE', label: 'How many times Yes' },
    { value: 'PCT_TRUE', label: '% of Yes' },
  ],
};

function FieldForm({
  initial,
  others,
  units,
  fixed,
  onSave,
  onCancel,
}: {
  initial?: ParameterDefinition;
  others: ParameterDefinition[];
  units: Unit[];
  /** Exists in a published version: kind of answer and unit cannot change. */
  fixed: boolean;
  onSave: (p: ParameterDefinition) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [type, setType] = useState<DataType>(initial?.type ?? 'DECIMAL');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [min, setMin] = useState(initial?.constraints.min?.toString() ?? '');
  const [max, setMax] = useState(initial?.constraints.max?.toString() ?? '');
  const [options, setOptions] = useState((initial?.constraints.options ?? []).map(humanize).join('\n'));
  const [required, setRequired] = useState(initial?.required ?? false);
  const [agg, setAgg] = useState<ParameterDefinition['agg']>(initial?.agg ?? 'AVG');
  const [whenKey, setWhenKey] = useState(initial?.condition?.when.key ?? '');
  const [whenEq, setWhenEq] = useState(String(initial?.condition?.when.eq ?? 'true'));
  const numeric = NUMERIC.includes(type);
  const unitChoices = useMemo(
    () => units.filter((u) => (type === 'DURATION' ? u.dimension === 'duration' : u.dimension !== 'duration')),
    [units, type],
  );
  const triggers = others.filter((p) => p.type === 'BOOL' || p.type === 'ENUM');
  const trigger = triggers.find((p) => p.key === whenKey);
  const summaries = numeric ? SUMMARY.number! : type === 'BOOL' ? SUMMARY.BOOL! : [];

  useEffect(() => {
    if (initial) return;
    setAgg(numeric ? 'AVG' : type === 'BOOL' ? 'COUNT_TRUE' : 'NONE');
    if (type === 'DURATION') setUnit('s');
  }, [type, numeric, initial]);

  return (
    <div className="inline-form">
      <div className="form-grid">
        <label className="field">
          What players record
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Ball speed" />
        </label>
        <label className="field">
          Kind of answer
          <select value={type} disabled={fixed} onChange={(e) => setType(e.target.value as DataType)}>
            {ANSWER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {fixed && <span className="field-hint">Fixed once published – add a new field for a different answer.</span>}
        </label>
        {numeric && (
          <>
            <label className="field">
              Unit
              <select value={unit} disabled={fixed} onChange={(e) => setUnit(e.target.value)}>
                {type !== 'DURATION' && <option value="">No unit</option>}
                {unitChoices.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.label} ({u.code})
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              Allowed range
              <div className="row gap-sm">
                <input type="number" value={min} onChange={(e) => setMin(e.target.value)} placeholder="from" />
                <input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="to" />
              </div>
            </div>
          </>
        )}
        {type === 'ENUM' && (
          <label className="field">
            Choices (one per line)
            <textarea
              rows={4}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder={'Topspin\nBackspin\nSidespin'}
            />
          </label>
        )}
        {summaries.length > 0 && (
          <label className="field">
            In charts, show the
            <select value={agg} onChange={(e) => setAgg(e.target.value as ParameterDefinition['agg'])}>
              {summaries.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          Only ask when
          <div className="row gap-sm">
            <select value={whenKey} onChange={(e) => setWhenKey(e.target.value)}>
              <option value="">Always</option>
              {triggers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {trigger?.type === 'ENUM' && (
              <select value={whenEq} onChange={(e) => setWhenEq(e.target.value)}>
                {(trigger.constraints.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    is {humanize(o)}
                  </option>
                ))}
              </select>
            )}
            {trigger?.type === 'BOOL' && <span className="small muted">is switched on</span>}
          </div>
        </div>
        {type !== 'BOOL' && (
          <div className="field">
            Must be filled in
            <Switch checked={required} onChange={setRequired} label={required ? 'Required' : 'Optional'} />
          </div>
        )}
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={label.trim().length < 2 || (type === 'ENUM' && options.trim() === '')}
          onClick={() => {
            const opts = [
              ...new Set(
                options
                  .split('\n')
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map(optionValue),
              ),
            ];
            const condition = trigger
              ? {
                  when: {
                    key: trigger.key,
                    eq: trigger.type === 'BOOL' ? true : whenEq || trigger.constraints.options?.[0] || '',
                  },
                }
              : undefined;
            onSave({
              key:
                initial?.key ??
                keyFrom(
                  label,
                  others.map((o) => o.key),
                ),
              label: label.trim(),
              type,
              ...(numeric && unit ? { unit } : {}),
              constraints: {
                ...(numeric && min !== '' ? { min: Number(min) } : {}),
                ...(numeric && max !== '' ? { max: Number(max) } : {}),
                ...(type === 'ENUM' ? { options: opts } : {}),
              },
              agg: summaries.some((s) => s.value === agg) ? agg : 'NONE',
              required: type === 'BOOL' ? !condition : required,
              ...(condition ? { condition } : {}),
            });
          }}
        >
          {initial ? 'Update field' : 'Add field'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A skill = "tried?" switch (off by default) + "accurate?" result shown only when tried, plus an optional % stat. */
function SkillForm({
  taken,
  onSave,
  onCancel,
}: {
  taken: string[];
  onSave: (pair: ParameterDefinition[], statLabel: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [stat, setStat] = useState(true);
  const n = skillName(name.trim());
  return (
    <div className="inline-form">
      <div className="form-grid">
        <label className="field">
          Skill
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Backhand flick" />
          <span className="field-hint">Players switch it on only when they try it, then mark Accurate or Missed.</span>
        </label>
        <div className="field">
          Also add a stat
          <Switch checked={stat} onChange={setStat} label={stat ? `“${n || 'Skill'} accuracy”` : 'No stat'} />
        </div>
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={n.length < 2}
          onClick={() => {
            const tried = keyFrom(`${n} attempted`, taken);
            const ok = keyFrom(`${n} accurate`, [...taken, tried]);
            onSave(
              [
                {
                  key: tried,
                  label: `${n} attempted`,
                  type: 'BOOL',
                  constraints: {},
                  agg: 'COUNT_TRUE',
                  required: true,
                },
                {
                  key: ok,
                  label: `${n} accurate`,
                  type: 'BOOL',
                  constraints: {},
                  agg: 'COUNT_TRUE',
                  required: true,
                  condition: { when: { key: tried, eq: true } },
                },
              ],
              stat ? `${n} accuracy` : null,
            );
          }}
        >
          Add skill
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatForm({
  params,
  onSave,
  onCancel,
}: {
  params: ParameterDefinition[];
  onSave: (label: string, choice: StatChoice) => void;
  onCancel: () => void;
}) {
  const bools = params.filter((p) => p.type === 'BOOL');
  const numbers = params.filter((p) => NUMERIC.includes(p.type));
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'percent' | 'number' | 'count'>(
    bools.length ? 'percent' : numbers.length ? 'number' : 'count',
  );
  const [yes, setYes] = useState(bools[0]?.key ?? '');
  const [of, setOf] = useState('*');
  const [fn, setFn] = useState<'MAX' | 'MIN' | 'AVG' | 'SUM'>('AVG');
  const [param, setParam] = useState(numbers[0]?.key ?? '');
  return (
    <div className="inline-form">
      <div className="form-grid">
        <label className="field">
          Stat name
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Serve accuracy" />
        </label>
        <label className="field">
          Show
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {bools.length > 0 && <option value="percent">A percentage</option>}
            {numbers.length > 0 && <option value="number">A number from a field</option>}
            <option value="count">How many entries</option>
          </select>
        </label>
        {kind === 'percent' && (
          <>
            <label className="field">
              Count entries where
              <select value={yes} onChange={(e) => setYes(e.target.value)}>
                {bools.map((p) => (
                  <option key={p.key} value={p.key}>
                    “{p.label}” is on
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Out of
              <select value={of} onChange={(e) => setOf(e.target.value)}>
                <option value="*">All entries</option>
                {bools
                  .filter((p) => p.key !== yes)
                  .map((p) => (
                    <option key={p.key} value={p.key}>
                      Entries where “{p.label}” is on
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {kind === 'number' && (
          <>
            <label className="field">
              Which
              <select value={fn} onChange={(e) => setFn(e.target.value as typeof fn)}>
                {NUMBER_STATS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Of field
              <select value={param} onChange={(e) => setParam(e.target.value)}>
                {numbers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={label.trim().length < 2}
          onClick={() =>
            onSave(
              label.trim(),
              kind === 'percent' ? { kind, yes, of } : kind === 'number' ? { kind, fn, param } : { kind: 'count' },
            )
          }
        >
          Add stat
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
