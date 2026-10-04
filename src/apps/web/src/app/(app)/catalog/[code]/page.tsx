import type { TemplateSnapshot } from '@trainme/schema';
import { Badge, Card, PageHeader } from '@/components/ui';
import { api } from '@/lib/server/api';
import { StartTracker } from './start-tracker';

export default async function TemplatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await api<TemplateSnapshot>(`/templates/${encodeURIComponent(code)}`);
  return (
    <div className="stack">
      <PageHeader
        title={t.name}
        subtitle={t.description}
        actions={<StartTracker templateCode={t.code} name={t.name} />}
      />
      {t.activities.map((a) => (
        <Card
          key={a.code}
          title={a.name}
          actions={<Badge tone="brand">{a.recordingMode.replace('PER_', 'per ').toLowerCase()}</Badge>}
        >
          {a.description && (
            <p className="small muted" style={{ marginBottom: 10 }}>
              {a.description}
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Type</th>
                  <th>Unit</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {a.parameters.map((p) => (
                  <tr key={p.key}>
                    <td>
                      {p.label}
                      {p.required && <span className="muted"> *</span>}
                    </td>
                    <td className="mono">
                      {p.type}
                      {p.constraints.options ? ` (${p.constraints.options.length})` : ''}
                    </td>
                    <td>{p.unit ?? ''}</td>
                    <td className="small muted">
                      {p.condition ? `when ${p.condition.when.key} = ${String(p.condition.when.eq)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Metrics: {a.metrics.map((m) => m.label).join(' · ')}
          </p>
        </Card>
      ))}
    </div>
  );
}
