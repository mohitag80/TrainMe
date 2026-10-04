'use client';
import { useEffect, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Card, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { useData } from '@/lib/client/use-data';
import type { Profile } from '@/lib/types';

const DIMENSIONS: { key: string; label: string; metric: string; imperial: string }[] = [
  { key: 'speed', label: 'Speed', metric: 'km/h', imperial: 'mph' },
  { key: 'mass', label: 'Weight', metric: 'kg, g', imperial: 'lb, oz' },
  { key: 'length', label: 'Distance / length', metric: 'km, m, cm', imperial: 'mi, yd, in' },
  { key: 'volume', label: 'Volume', metric: 'ml, l', imperial: 'fl oz, qt' },
  { key: 'pace', label: 'Pace', metric: 'min/km', imperial: 'min/mi' },
];

/** FR-PRF-01/06: profile and Metric/Imperial per dimension; stored measurements are never converted. */
export default function ProfilePage() {
  const profile = useData<Profile>('/profiles/me');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  useEffect(() => {
    if (profile.data) setForm(profile.data);
  }, [profile.data]);
  if (profile.error) return <ErrorBanner error={profile.error} />;
  if (!profile.data) return <Spinner />;
  const prefs = form.unitPreferences ?? {};

  async function save(extra: Record<string, unknown> = {}) {
    try {
      const updated = await api<Profile>('/profiles/me', {
        method: 'PUT',
        headers: { 'if-match': `"${profile.data!.rowVersion}"` },
        body: {
          displayName: form.displayName,
          timezone: form.timezone,
          heightCm: form.heightCm ?? null,
          weightKg: form.weightKg ?? null,
          unitPreferences: prefs,
          ...extra,
        },
      });
      profile.setData(updated);
      setMsg({ tone: 'ok', text: 'Saved. Charts and forms now use these units.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Profile" subtitle={profile.data.email ?? ''} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title="About you">
        <div className="form-grid">
          <label className="field">
            Display name
            <input value={form.displayName ?? ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label className="field">
            Time zone
            <input value={form.timezone ?? ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            <span className="field-hint">Your browser: {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          </label>
          <label className="field">
            Height (cm)
            <input
              type="number"
              value={form.heightCm ?? ''}
              onChange={(e) => setForm({ ...form, heightCm: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="field">
            Weight (kg)
            <input
              type="number"
              value={form.weightKg ?? ''}
              onChange={(e) => setForm({ ...form, weightKg: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
        </div>
      </Card>
      <Card
        title="Units"
        actions={
          <>
            <button className="btn btn-sm" onClick={() => save({ unitPreset: 'METRIC', unitPreferences: {} })}>
              All metric
            </button>
            <button className="btn btn-sm" onClick={() => save({ unitPreset: 'IMPERIAL', unitPreferences: {} })}>
              All imperial
            </button>
          </>
        }
      >
        <p className="small muted" style={{ marginBottom: 10 }}>
          Choose per measurement. A tracker can still show a specific parameter in another unit (e.g. grams or stone).
        </p>
        <table>
          <tbody>
            {DIMENSIONS.map((d) => (
              <tr key={d.key}>
                <td>
                  <strong>{d.label}</strong>
                </td>
                <td>
                  <div className="chips">
                    {(['METRIC', 'IMPERIAL'] as const).map((sys) => (
                      <button
                        key={sys}
                        className={`chip ${(prefs[d.key] ?? 'METRIC') === sys ? 'on' : ''}`}
                        onClick={() => setForm({ ...form, unitPreferences: { ...prefs, [d.key]: sys } })}
                      >
                        {sys === 'METRIC' ? `Metric (${d.metric})` : `Imperial (${d.imperial})`}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="row gap">
        <button className="btn btn-primary" onClick={() => save()}>
          Save profile
        </button>
        <button
          className="btn"
          onClick={async () => {
            await api('/profiles/me/export', { method: 'POST' });
            setMsg({ tone: 'ok', text: 'Export requested – you will get a download link (≤ 24 h).' });
          }}
        >
          Request data export
        </button>
      </div>
    </div>
  );
}
