'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';

type Category = {
  code: string;
  name: string;
  kind: string;
  level: number;
  parentCode: string | null;
  templateCount: number;
};
type Template = { code: string; name: string; description: string | null; categoryCode: string; activityCount: number };
type Hit = {
  itemType: string;
  itemCode: string;
  name: string;
  kind: string | null;
  sports: string[];
  muscles: string[];
  equipment: string[];
};

/** Browse the taxonomy or search (typo tolerant: "dumbell chest", "fast bowlr"). */
export default function CatalogPage() {
  const tree = useData<{ items: Category[] }>('/categories');
  const [category, setCategory] = useState<string>('sports');
  const templates = useData<{ items: Template[] }>(`/templates?category=${encodeURIComponent(category)}`);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchError, setSearchError] = useState<unknown>();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ items: Hit[] }>(`/catalog/search?q=${encodeURIComponent(q)}&limit=20`)
        .then((r) => {
          setHits(r.items);
          setSearchError(undefined);
        })
        .catch(setSearchError);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const top = useMemo(() => (tree.data?.items ?? []).filter((c) => c.level <= 2), [tree.data]);
  const children = useMemo(
    () => (tree.data?.items ?? []).filter((c) => c.parentCode === category),
    [tree.data, category],
  );
  const current = tree.data?.items.find((c) => c.code === category);

  return (
    <div className="stack">
      <PageHeader
        title="Catalog"
        subtitle="Pick a profile to start a tracker – you can add or hide parameters later."
      />
      <input
        placeholder="Search drills, exercises, profiles… (try: dumbell chest, yorker, pushup)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search catalog"
      />
      <ErrorBanner error={searchError} />
      {hits && (
        <Card title={`Results for “${q}”`}>
          {hits.length === 0 ? (
            <Empty>Nothing found.</Empty>
          ) : (
            <ul className="list">
              {hits.map((h) => (
                <li key={`${h.itemType}${h.itemCode}`}>
                  <div>
                    {h.itemType === 'TEMPLATE' ? (
                      <Link href={`/catalog/${h.itemCode}`} style={{ fontWeight: 700 }}>
                        {h.name}
                      </Link>
                    ) : h.itemType === 'CATEGORY' ? (
                      <a
                        href="#browse"
                        onClick={() => {
                          setCategory(h.itemCode);
                          setQ('');
                        }}
                        style={{ fontWeight: 700 }}
                      >
                        {h.name}
                      </a>
                    ) : (
                      <strong>{h.name}</strong>
                    )}
                    <div className="small muted">
                      {[...h.sports, ...h.muscles.slice(0, 3), ...h.equipment.slice(0, 2)].join(' · ')}
                    </div>
                  </div>
                  <Badge tone={h.itemType === 'TEMPLATE' ? 'brand' : 'default'}>{h.itemType.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div id="browse" className="row gap wrap">
        {top.map((c) => (
          <button
            key={c.code}
            className={`chip ${c.code === category ? 'on' : ''}`}
            onClick={() => setCategory(c.code)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {children.length > 0 && (
        <div className="row gap wrap">
          {children.map((c) => (
            <button key={c.code} className="chip" onClick={() => setCategory(c.code)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <Card title={current ? `${current.name} profiles` : 'Profiles'}>
        <ErrorBanner error={templates.error} />
        {templates.loading ? (
          <Spinner />
        ) : (templates.data?.items.length ?? 0) === 0 ? (
          <Empty>No profiles in this category.</Empty>
        ) : (
          <div className="grid-auto">
            {templates.data!.items.map((t) => (
              <Link key={t.code} href={`/catalog/${t.code}`} className="tile">
                <h3>{t.name}</h3>
                <p className="small muted">{t.description}</p>
                <p className="small" style={{ marginTop: 8 }}>
                  <Badge>{t.activityCount} activities</Badge>
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
