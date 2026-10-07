'use client';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Segmented } from '@/components/controls';
import { Card, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
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

/** FR-PRF-06 and time zone (moved off the Profile page in v1.5): plain choices; stored values are never converted. */
export default function SettingsPage() {
  const profile = useData<Profile>('/profiles/me');
  const [prefs, setPrefs] = useState<Record<string, System>>({});
  const [timezone, setTimezone] = useState('UTC');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const browserZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  useEffect(() => {
    if (!profile.data) return;
    setPrefs(profile.data.unitPreferences as Record<string, System>);
    setTimezone(profile.data.timezone);
  }, [profile.data]);
  const zones = useMemo(() => [...new Set([browserZone, timezone, ...COMMON_ZONES])], [browserZone, timezone]);

  if (profile.error) return <ErrorBanner error={profile.error} />;
  if (!profile.data) return <Spinner />;

  const all = (system: System) => setPrefs(Object.fromEntries(DIMENSIONS.map((d) => [d.key, system])));

  async function save() {
    try {
      const updated = await api<Profile>('/profiles/me', {
        method: 'PUT',
        headers: { 'if-match': `"${profile.data!.rowVersion}"` },
        body: { timezone, unitPreferences: prefs },
      });
      profile.setData({ ...profile.data!, ...updated });
      setMsg({ tone: 'ok', text: 'Saved. Forms and charts now use these settings.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="How TrainMe shows your numbers and dates" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid-2">
        <Card
          title="Units"
          actions={
            <>
              <button className="btn btn-sm" onClick={() => all('METRIC')}>
                All metric
              </button>
              <button className="btn btn-sm" onClick={() => all('IMPERIAL')}>
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
                    onChange={(v) => setPrefs({ ...prefs, [d.key]: v ?? 'METRIC' })}
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

        <Card title="Time zone">
          <label className="field">
            Time zone
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')}
                  {z === browserZone ? ' (this device)' : ''}
                </option>
              ))}
            </select>
            <span className="field-hint">Decides which day a session belongs to</span>
          </label>
        </Card>
      </div>
      <div className="row gap">
        <button className="btn btn-primary btn-lg" onClick={() => void save()}>
          Save settings
        </button>
      </div>
    </div>
  );
}
