'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CategoryPicker, Crumbs } from '@/components/admin/category-picker';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import {
  activityKindLabel,
  pathText,
  STATUS_LABEL,
  STATUS_TONE,
  type ActivityRow,
  type ProfileDoc,
  type TreeNode,
} from '@/lib/admin';
import { api, ApiError, errorText } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';
import { recordingModeLabel } from '@/lib/labels';

/**
 * Creates or edits one profile (template) version: name, place in the tree and its activities. Publishing
 * links each activity's latest published version; users of the old version see "update available".
 */
export function ProfileEditor({
  code,
  version,
  categoryCode,
}: {
  code?: string;
  version?: number;
  categoryCode?: string;
}) {
  const router = useRouter();
  const addParam = useSearchParams().get('add');
  const tree = useData<{ items: TreeNode[] }>('/admin/catalog/tree');
  const all = useData<{ items: ActivityRow[] }>('/admin/catalog/activities');
  const doc = useData<ProfileDoc>(
    code && version ? `/admin/catalog/templates/${encodeURIComponent(code)}/versions/${version}` : null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(categoryCode ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
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
    setName(d.name);
    setDescription(d.description ?? '');
    setCategory(d.categoryCode);
    setPicked(d.activities.map((a) => a.code));
  }, [doc.data]);

  // Back from "+ New activity": add the activity just created to this draft and save it straight away.
  useEffect(() => {
    const d = doc.data;
    const added = addParam ? all.data?.items.find((a) => a.code === addParam) : undefined;
    if (!d || !added || d.status !== 'DRAFT') return;
    router.replace(`/admin/profiles/${encodeURIComponent(d.code)}/${d.version}`);
    if (d.activities.some((a) => a.code === added.code)) return;
    const next = [...d.activities.map((a) => a.code), added.code];
    setPicked(next);
    void save(next).then(
      (ok) =>
        ok &&
        setMsg({
          tone: 'ok',
          text: `Added “${added.name}”. ${added.status === 'PUBLISHED' ? 'Click Publish to show this profile in the Catalog.' : 'Publish that activity, then this profile.'}`,
        }),
    );
  }, [doc.data, all.data, addParam]);

  const nodes = tree.data?.items ?? [];
  const byCode = useMemo(() => new Map((all.data?.items ?? []).map((a) => [a.code, a])), [all.data]);
  const branch = nodes.find((n) => n.code === category)?.path ?? [];
  // Suggest activities placed in the same sport/branch first, then everything else by name.
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = (all.data?.items ?? []).filter((a) => a.status !== 'RETIRED' && !picked.includes(a.code));
    const near = (a: ActivityRow) => a.placements.some((p) => branch.length > 1 && p[1] === branch[1]);
    return rows
      .filter((a) => !term || `${a.name} ${a.placements.flat().join(' ')}`.toLowerCase().includes(term))
      .sort((a, b) => Number(near(b)) - Number(near(a)) || a.name.localeCompare(b.name))
      .slice(0, term ? 30 : 12);
  }, [all.data, picked, q, branch]);

  const readOnly = !!doc.data && doc.data.status !== 'DRAFT';
  const d = doc.data;
  const base = d ? `/admin/catalog/templates/${encodeURIComponent(d.code)}/versions/${d.version}` : '';
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
    setMsg({ tone: 'bad', text: errors.length ? 'Please fix these:' : errorText(e), list: errors });
  };

  async function save(activityCodes = picked): Promise<{ code: string; version: number } | null> {
    if (!category) {
      setMsg({ tone: 'bad', text: 'Choose where this profile belongs in the catalog.' });
      return null;
    }
    if (name.trim().length < 2) {
      setMsg({ tone: 'bad', text: 'Give the profile a name first.' });
      return null;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        categoryCode: category,
        activityCodes,
      };
      const r =
        code && version
          ? await api<{ code: string; version: number }>(base, { method: 'PUT', body })
          : await api<{ code: string; version: number }>('/admin/catalog/templates', { method: 'POST', body });
      setMsg({ tone: 'ok', text: 'Draft saved. Users will not see it until you publish.' });
      if (!code) router.replace(`/admin/profiles/${encodeURIComponent(r.code)}/${r.version}`);
      else await doc.reload();
      return r;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, done: string, then?: (r: { code: string; version: number }) => void) {
    setBusy(true);
    try {
      const r = await api<{ code: string; version: number }>(path, { method: 'POST' });
      setMsg({ tone: 'ok', text: done });
      then?.(r);
      await doc.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Save, then publish – including any draft activities, after the admin confirms them by name. */
  async function publishNow() {
    const s = await save();
    if (!s) return;
    const drafts = picked
      .map((c) => byCode.get(c))
      .filter((a): a is ActivityRow => !!a && (a.status === 'DRAFT' || a.hasDraft));
    // Brand-new activities are simply part of this profile. Changes to activities that are already live may
    // also update other profiles, so only those are confirmed.
    const liveChanges = drafts.filter((a) => a.publishedVersion !== null);
    if (
      liveChanges.length &&
      !confirm(
        `These activities are already in use and have unpublished changes. Publishing also applies the changes everywhere they are used:\n\n• ${liveChanges.map((a) => a.name).join('\n• ')}\n\nContinue?`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/admin/catalog/templates/${encodeURIComponent(s.code)}/versions/${s.version}/publish`, {
        method: 'POST',
        body: { publishActivities: drafts.length > 0 },
      });
      setMsg({
        tone: 'ok',
        text: drafts.length
          ? `Published together with ${drafts.map((a) => `“${a.name}”`).join(', ')} – it is now in the Catalog for everyone.`
          : 'Published – it is now in the Catalog for everyone.',
        link: `/catalog/${encodeURIComponent(s.code)}`,
      });
      router.replace(`/admin/profiles/${encodeURIComponent(s.code)}/${s.version}`);
      await Promise.all([doc.reload(), all.reload()]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const placed = nodes.find((n) => n.code === category);
  const draftActivities = picked.map((c) => byCode.get(c)).filter((a) => a && (a.status === 'DRAFT' || a.hasDraft));
  const checks = [
    { ok: name.trim().length >= 2, text: name.trim().length >= 2 ? `Named “${name.trim()}”` : 'Give it a name' },
    {
      ok: !!placed,
      text: placed ? `Placed in ${pathText(placed.path)}` : 'Choose where it belongs in the catalog',
      tip:
        placed && placed.level === 1
          ? `Tip: place it under a sport or area (e.g. ${placed.name} › Swimming) so users find it there – add one with “Change”.`
          : undefined,
    },
    {
      ok: picked.length > 0,
      text: picked.length
        ? `${picked.length} ${picked.length === 1 ? 'activity' : 'activities'}${draftActivities.length ? ` – ${draftActivities.length} still a draft, published together with the profile` : ''}`
        : 'Add at least one activity (pick one on the right, or “+ New activity”)',
    },
  ];
  const ready = checks.every((c) => c.ok);

  if (doc.error) return <ErrorBanner error={doc.error} />;
  if (!tree.data || !all.data || (code && !d)) return <Spinner />;

  return (
    <div className="stack">
      <nav className="crumbs">
        <Link href="/admin?view=profiles">Catalog admin</Link> <span>›</span> {d ? d.name : 'New profile'}
      </nav>
      <PageHeader
        title={name.trim() || 'New profile'}
        subtitle={
          d ? (
            <span className="row gap-sm">
              <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge> Version {d.version}
            </span>
          ) : (
            'A profile is what users pick in the catalog, e.g. “Fast Bowler” – a set of activities.'
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
                    confirm('Retire this profile? It disappears from the catalog; existing trackers keep working.') &&
                    act(`${base}/retire`, 'Retired.')
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
                    `/admin/catalog/templates/${encodeURIComponent(d!.code)}/drafts`,
                    'Draft opened – edit and publish when ready.',
                    (r) => router.push(`/admin/profiles/${encodeURIComponent(r.code)}/${r.version}`),
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
                      router.push('/admin?view=profiles');
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  Delete draft
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => save()}>
                Save draft
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !ready}
                title={
                  ready
                    ? 'Make it visible in the Catalog'
                    : checks
                        .filter((c) => !c.ok)
                        .map((c) => c.text)
                        .join(' · ')
                }
                onClick={publishNow}
              >
                Publish
              </button>
            </>
          )
        }
      />
      {(!d || d.status === 'DRAFT') && (
        <Card title={ready ? 'Ready to publish' : 'Before you can publish'} className="checklist-card">
          <p className="small muted" style={{ marginTop: -6 }}>
            This is a draft – nobody else sees it until you click Publish.
          </p>
          <ul className="checklist">
            {checks.map((c, i) => (
              <li key={i} className={c.ok ? 'ok' : ''}>
                <span className="tick">{c.ok ? '✓' : '○'}</span>
                <span>
                  {c.text}
                  {c.tip && <span className="field-hint"> {c.tip}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {d?.status === 'PUBLISHED' && !msg && (
        <Notice tone="ok">
          Live in the Catalog for everyone.{' '}
          <Link href={`/catalog/${encodeURIComponent(d.code)}`}>View it as users see it →</Link>
        </Notice>
      )}
      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}
          {msg.link && (
            <>
              {' '}
              <Link href={msg.link}>{msg.linkText ?? 'View it as users see it →'}</Link>
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
              href={`/admin/profiles/${encodeURIComponent(d.code)}/${v.version}`}
            >
              {v.version} · {STATUS_LABEL[v.status]}
            </Link>
          ))}
        </div>
      )}

      <Card title="About this profile">
        <div className="form-grid">
          <label className="field">
            Name
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Table Tennis Attacker"
            />
          </label>
          <div className="field">
            Where it belongs
            <CategoryPicker
              tree={nodes}
              value={category}
              onChange={setCategory}
              onTreeChanged={tree.reload}
              disabled={readOnly}
            />
          </div>
          <label className="field span-2">
            Description
            <textarea
              rows={2}
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who it is for and what it tracks"
            />
          </label>
        </div>
      </Card>

      <div className={readOnly ? '' : 'admin-split'}>
        <Card title={`Activities in this profile · ${picked.length}`}>
          {picked.length === 0 ? (
            <Empty>Add activities from the list{readOnly ? '' : ' on the right'}.</Empty>
          ) : (
            <ol className="pick-list">
              {picked.map((c, i) => {
                const row = byCode.get(c);
                const a = row ?? d?.activities.find((x) => x.code === c);
                return (
                  <li key={c}>
                    <div>
                      <Link
                        className="pname"
                        href={row ? `/admin/activities/${encodeURIComponent(c)}/${row.version}` : '#'}
                      >
                        {a?.name ?? 'Activity'}
                      </Link>
                      <div className="phint">
                        {a
                          ? `${row ? `${activityKindLabel(row.kind)} · ` : ''}${recordingModeLabel(a.recordingMode)}`
                          : ''}
                        {a && a.status !== 'PUBLISHED' && (
                          <>
                            {' '}
                            · <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                          </>
                        )}
                      </div>
                    </div>
                    {!readOnly && (
                      <span className="row gap-sm">
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={i === 0}
                          title="Move up"
                          onClick={() => setPicked((p) => [...p.slice(0, i - 1), p[i]!, p[i - 1]!, ...p.slice(i + 1)])}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setPicked((p) => p.filter((x) => x !== c))}
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {picked.some((c) => byCode.get(c)?.status === 'DRAFT') && (
            <p className="small muted" style={{ marginTop: 10 }}>
              Draft activities must be published before this profile can be published.
            </p>
          )}
        </Card>
        {!readOnly && (
          <Card
            title="Add activities"
            actions={
              <button
                className="btn btn-sm"
                disabled={busy}
                title="Saves this profile as a draft, then creates the activity and brings you back"
                onClick={async () => {
                  const s = await save();
                  if (!s) return;
                  const qs = new URLSearchParams({
                    category: category ?? '',
                    profile: s.code,
                    pv: String(s.version),
                    pname: name.trim(),
                  });
                  router.push(`/admin/activities/new?${qs}`);
                }}
              >
                + New activity
              </button>
            }
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activities…" />
            <ul className="list" style={{ marginTop: 10 }}>
              {candidates.map((a) => (
                <li key={a.code}>
                  <div>
                    <div className="pname">{a.name}</div>
                    <div className="phint">
                      {a.placements[0] ? <Crumbs path={a.placements[0]} /> : recordingModeLabel(a.recordingMode)}
                      {a.status === 'DRAFT' && ' · draft'}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => setPicked((p) => [...p, a.code])}>
                    + Add
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
