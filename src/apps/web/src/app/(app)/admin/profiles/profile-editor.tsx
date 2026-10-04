'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CategoryPicker, Crumbs } from '@/components/admin/category-picker';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import {
  activityKindLabel,
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
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string; list?: string[] }>();

  useEffect(() => {
    const d = doc.data;
    if (!d) return;
    setName(d.name);
    setDescription(d.description ?? '');
    setCategory(d.categoryCode);
    setPicked(d.activities.map((a) => a.code));
  }, [doc.data]);

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
    const errors = e instanceof ApiError ? (e.problem.errors ?? []).map((x) => x.message) : [];
    setMsg({ tone: 'bad', text: errors.length ? 'Please fix these:' : errorText(e), list: errors });
  };

  async function save(): Promise<{ code: string; version: number } | null> {
    if (!category) {
      setMsg({ tone: 'bad', text: 'Choose where this profile belongs in the catalog.' });
      return null;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        categoryCode: category,
        activityCodes: picked,
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
              <button className="btn" disabled={busy} onClick={save}>
                Save draft
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || picked.length === 0}
                onClick={async () => {
                  const s = await save();
                  if (!s) return;
                  await act(
                    `/admin/catalog/templates/${encodeURIComponent(s.code)}/versions/${s.version}/publish`,
                    'Published. It is now in the catalog; users of the previous version see “update available”.',
                    () => router.replace(`/admin/profiles/${encodeURIComponent(s.code)}/${s.version}`),
                  );
                }}
              >
                Publish
              </button>
            </>
          )
        }
      />
      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}
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
              <Link
                className="btn btn-sm"
                href={`/admin/activities/new${category ? `?category=${encodeURIComponent(category)}` : ''}`}
              >
                + New activity
              </Link>
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
