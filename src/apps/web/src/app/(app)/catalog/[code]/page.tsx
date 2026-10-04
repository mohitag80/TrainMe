import Link from 'next/link';
import type { TemplateSnapshot } from '@trainme/schema';
import { ParameterTable } from '@/components/parameter-table';
import { Badge, Card } from '@/components/ui';
import { recordingModeLabel } from '@/lib/labels';
import { api } from '@/lib/server/api';
import { StartTracker } from './start-tracker';

export default async function TemplatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await api<TemplateSnapshot>(`/templates/${encodeURIComponent(code)}`);
  return (
    <div className="stack">
      <nav className="crumbs">
        <Link href="/catalog">Catalog</Link> <span>›</span> {t.name}
      </nav>
      <div className="hero">
        <div className="row between wrap gap">
          <div>
            <h1>{t.name}</h1>
            {t.description && <p className="hero-sub">{t.description}</p>}
            <p className="hero-meta">
              {t.activities.length} activities · you can add, hide or rename anything after you start
            </p>
          </div>
          <StartTracker templateCode={t.code} name={t.name} />
        </div>
      </div>
      {t.activities.map((a) => (
        <Card key={a.code} title={a.name} actions={<Badge tone="brand">{recordingModeLabel(a.recordingMode)}</Badge>}>
          {a.description && <p className="card-intro">{a.description}</p>}
          <ParameterTable params={a.parameters} />
          {a.metrics.length > 0 && (
            <div className="metric-chips">
              <span className="muted small">You will see:</span>
              {a.metrics.map((m) => (
                <span key={m.key} className="tag">
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
