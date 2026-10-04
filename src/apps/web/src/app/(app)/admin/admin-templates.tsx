'use client';
import { useState } from 'react';
import { ErrorBanner, Notice, Spinner, Tabs } from '@/components/client-ui';
import { Badge, Card } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';

type Row = {
  code: string;
  version: number;
  name: string;
  status: string;
  source: string;
  publishedAt: string | null;
  categoryCode: string;
};

export function AdminTemplates() {
  const [status, setStatus] = useState<'PUBLISHED' | 'RETIRED' | 'DRAFT'>('PUBLISHED');
  const list = useData<{ items: Row[] }>(`/admin/catalog/templates?status=${status}`);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  async function act(r: Row, action: 'publish' | 'retire') {
    try {
      await api(`/admin/catalog/templates/${r.code}/versions/${r.version}/${action}`, { method: 'POST' });
      setMsg({ tone: 'ok', text: `${r.name} v${r.version} ${action === 'publish' ? 'published' : 'retired'}.` });
      await list.reload();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }
  return (
    <Card
      title="Templates"
      actions={
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'PUBLISHED', label: 'Published' },
            { value: 'RETIRED', label: 'Retired' },
            { value: 'DRAFT', label: 'Draft' },
          ]}
        />
      }
    >
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ErrorBanner error={list.error} />
      {list.loading ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Version</th>
                <th>Category</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((r) => (
                <tr key={`${r.code}${r.version}`}>
                  <td>
                    <strong>{r.name}</strong>
                    <div className="mono muted">{r.code}</div>
                  </td>
                  <td>v{r.version}</td>
                  <td className="small">{r.categoryCode}</td>
                  <td>
                    <Badge>{r.source.toLowerCase()}</Badge>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.status === 'PUBLISHED' ? (
                      <button className="btn btn-sm btn-danger" onClick={() => act(r, 'retire')}>
                        Retire
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => act(r, 'publish')}>
                        Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
