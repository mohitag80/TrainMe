'use client';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Segmented } from '@/components/controls';
import { Card, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { units } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { Profile } from '@/lib/types';

type System = 'METRIC' | 'IMPERIAL';
const DIMENSIONS: { key: string; label: string; metric: string; imperial: string }[] = [
  { key: 'speed', label: 'Speed', metric: 'km/h', imperial: 'mph' },
  { key: 'mass', label: 'Weight', metric: 'kg · g', imperial: 'lb · oz' },
  { key: 'length', label: 'Distance & height', metric: 'km · m · cm', imperial: 'mi · yd · in' },
  { key: 'volume', label: 'Volume', metric: 'ml · l', imperial: 'fl oz · qt' },
  { key: 'pace', label: 'Running pace', metric: 'min/km', imperial: 'min/mi' },
];
const COMMON_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

/** FR-PRF-01/06: about you and units – plain choices; stored measurements are never converted. */
export default function ProfilePage() {
  const profile = useData<Profile>('/profiles/me');
  const [form, setForm] = useState<Partial<Profile>>({});
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const browserZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const prefs = (form.unitPreferences ?? {}) as Record<string, System>;
  const imperialLength = prefs.length === 'IMPERIAL';
  const imperialMass = prefs.mass === 'IMPERIAL';

  useEffect(() => {
    if (!profile.data) return;
    setForm(profile.data);
    const p = profile.data.unitPreferences as Record<string, System>;
    setHeight(
      profile.data.heightCm
        ? String(p.length === 'IMPERIAL' ? units.toDisplay(profile.data.heightCm, 'cm', 'in') : profile.data.heightCm)
        : '',
    );
    setWeight(
      profile.data.weightKg
        ? String(p.mass === 'IMPERIAL' ? units.toDisplay(profile.data.weightKg, 'kg', 'lb') : profile.data.weightKg)
        : '',
    );
  }, [profile.data]);
  const zones = useMemo(
    () => [...new Set([browserZone, ...(form.timezone ? [form.timezone] : []), ...COMMON_ZONES])],
    [browserZone, form.timezone],
  );

  if (profile.error) return <ErrorBanner error={profile.error} />;
  if (!profile.data) return <Spinner />;

  async function save(extra: Record<string, unknown> = {}) {
    try {
      const h = height ? Number(height) : null;
      const w = weight ? Number(weight) : null;
      const updated = await api<Profile>('/profiles/me', {
        method: 'PUT',
        headers: { 'if-match': `"${profile.data!.rowVersion}"` },
        body: {
          displayName: form.displayName,
          timezone: form.timezone,
          heightCm: h === null ? null : imperialLength ? Math.round(units.toCanonical(h, 'in', 'cm') * 10) / 10 : h,
          weightKg: w === null ? null : imperialMass ? Math.round(units.toCanonical(w, 'lb', 'kg') * 10) / 10 : w,
          unitPreferences: prefs,
          ...extra,
        },
      });
      profile.setData(updated);
      setMsg({ tone: 'ok', text: 'Saved. Forms and charts now use these settings.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Profile" subtitle={profile.data.email ?? ''} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid-2">
        <Card title="About you">
          <div className="form-grid">
            <label className="field">
              Name
              <input
                value={form.displayName ?? ''}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="field">
              Time zone
              <select value={form.timezone ?? 'UTC'} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll('_', ' ')}
                    {z === browserZone ? ' (this device)' : ''}
                  </option>
                ))}
              </select>
              <span className="field-hint">Decides which day a session belongs to</span>
            </label>
            <label className="field">
              Height
              <div className="input-unit">
                <input type="number" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
                <span className="unit">{imperialLength ? 'in' : 'cm'}</span>
              </div>
            </label>
            <label className="field">
              Body weight
              <div className="input-unit">
                <input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
                <span className="unit">{imperialMass ? 'lb' : 'kg'}</span>
              </div>
            </label>
          </div>
        </Card>

        <Card
          title="Units"
          actions={
            <>
              <button
                className="btn btn-sm"
                onClick={() =>
                  setForm({ ...form, unitPreferences: Object.fromEntries(DIMENSIONS.map((d) => [d.key, 'METRIC'])) })
                }
              >
                All metric
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  setForm({ ...form, unitPreferences: Object.fromEntries(DIMENSIONS.map((d) => [d.key, 'IMPERIAL'])) })
                }
              >
                All imperial
              </button>
            </>
          }
        >
          <dl className="kv">
            {DIMENSIONS.map((d) => (
              <div key={d.key} style={{ display: 'contents' }}>
                <dt>{d.label}</dt>
                <dd>
                  <Segmented
                    size="sm"
                    value={prefs[d.key] ?? 'METRIC'}
                    onChange={(v) => setForm({ ...form, unitPreferences: { ...prefs, [d.key]: v ?? 'METRIC' } })}
                    options={[
                      { value: 'METRIC' as System, label: `Metric · ${d.metric}` },
                      { value: 'IMPERIAL' as System, label: `Imperial · ${d.imperial}` },
                    ]}
                  />
                </dd>
              </div>
            ))}
          </dl>
          <p className="small muted" style={{ marginTop: 14 }}>
            A tracker can still show one field in another unit – e.g. bat weight in grams or bowling speed in m/s.
          </p>
        </Card>
      </div>
      <div className="row gap">
        <button className="btn btn-primary btn-lg" onClick={() => save()}>
          Save changes
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await api('/profiles/me/export', { method: 'POST' });
            setMsg({ tone: 'ok', text: 'Export requested – you will get a download link within 24 hours.' });
          }}
        >
          Download my data
        </button>
      </div>
    </div>
  );
}
