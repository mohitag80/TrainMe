'use client';
import { useState } from 'react';
import { ErrorBanner, Notice, Spinner } from '@/components/client-ui';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, errorText } from '@/lib/client/api';
import { friendlyTime, timeZone } from '@/lib/client/format';
import { useData } from '@/lib/client/use-data';
import type { TrackerSummary } from '@/lib/types';

type Item = { id: string; template: string; title: string; body: string; readAt: string | null; createdAt: string };
type Reminder = {
  id: string;
  title: string;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  channel: string;
  isEnabled: boolean;
  nextFireAt: string;
};
type Prefs = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** FR-NTF-01..04, FR-PRF-05: inbox, reminders in local time, channels and quiet hours. */
export default function NotificationsPage() {
  const inbox = useData<{ items: Item[]; unread: number }>('/notifications?limit=30');
  const reminders = useData<{ items: Reminder[] }>('/reminders');
  const prefs = useData<Prefs>('/notifications/preferences');
  const trackers = useData<{ items: TrackerSummary[] }>('/trackers');
  const [form, setForm] = useState({
    title: 'Practice',
    days: [1, 3, 5],
    time: '06:00',
    channel: 'IN_APP',
    trackerId: '',
  });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();

  if (inbox.error) return <ErrorBanner error={inbox.error} />;
  if (!inbox.data) return <Spinner />;

  return (
    <div className="stack">
      <PageHeader
        title="Inbox"
        subtitle={`${inbox.data.unread} unread`}
        actions={
          inbox.data.unread > 0 && (
            <button
              className="btn"
              onClick={async () => {
                await api('/notifications/read-all', { method: 'POST' });
                await inbox.reload();
              }}
            >
              Mark all read
            </button>
          )
        }
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card title="Notifications">
        {inbox.data.items.length === 0 ? (
          <Empty>Nothing yet – personal bests, reminders and plan changes appear here.</Empty>
        ) : (
          <ul className="list">
            {inbox.data.items.map((n) => (
              <li key={n.id} style={{ opacity: n.readAt ? 0.6 : 1 }}>
                <div>
                  <strong>{n.title}</strong>
                  <div className="small muted">{n.body}</div>
                </div>
                <div className="row gap">
                  <span className="small muted">{friendlyTime(n.createdAt)}</span>
                  {!n.readAt && (
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        await api(`/notifications/${n.id}/read`, { method: 'POST' });
                        await inbox.reload();
                      }}
                    >
                      Read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid-2">
        <Card title="Reminders">
          {(reminders.data?.items.length ?? 0) === 0 ? (
            <Empty>No reminders.</Empty>
          ) : (
            <ul className="list">
              {reminders.data!.items.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.title}</strong> <Badge>{r.channel.toLowerCase()}</Badge>
                    <div className="small muted">
                      {r.daysOfWeek.map((d) => DAYS[d - 1]).join(', ')} at {r.timeOfDay.slice(0, 5)} · next{' '}
                      {friendlyTime(r.nextFireAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      await api(`/reminders/${r.id}`, { method: 'DELETE' });
                      await reminders.reload();
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="stack" style={{ marginTop: 14, gap: 10 }}>
            <div className="form-grid">
              <label className="field">
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </label>
              <label className="field">
                Time
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </label>
              <label className="field">
                Channel
                <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  <option value="IN_APP">In-app</option>
                  <option value="EMAIL">Email</option>
                  <option value="PUSH">Push</option>
                </select>
              </label>
              <label className="field">
                Tracker
                <select value={form.trackerId} onChange={(e) => setForm({ ...form, trackerId: e.target.value })}>
                  <option value="">–</option>
                  {trackers.data?.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="chips">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  className={`chip ${form.days.includes(i + 1) ? 'on' : ''}`}
                  onClick={() =>
                    setForm({
                      ...form,
                      days: form.days.includes(i + 1)
                        ? form.days.filter((x) => x !== i + 1)
                        : [...form.days, i + 1].sort(),
                    })
                  }
                >
                  {d}
                </button>
              ))}
            </div>
            <div>
              <button
                className="btn btn-primary btn-sm"
                disabled={form.days.length === 0}
                onClick={async () => {
                  try {
                    await api('/reminders', {
                      method: 'POST',
                      body: {
                        title: form.title,
                        daysOfWeek: form.days,
                        timeOfDay: form.time,
                        timezone: timeZone(),
                        channel: form.channel,
                        trackerId: form.trackerId || null,
                      },
                    });
                    setMsg({ tone: 'ok', text: 'Reminder saved.' });
                    await reminders.reload();
                  } catch (e) {
                    setMsg({ tone: 'bad', text: errorText(e) });
                  }
                }}
              >
                Add reminder
              </button>
            </div>
          </div>
        </Card>
        <Card title="Delivery">
          {prefs.data && (
            <PrefsForm
              prefs={prefs.data}
              onSave={async (p) => {
                try {
                  await api('/notifications/preferences', { method: 'PUT', body: p });
                  setMsg({ tone: 'ok', text: 'Preferences saved.' });
                  await prefs.reload();
                } catch (e) {
                  setMsg({ tone: 'bad', text: errorText(e) });
                }
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function PrefsForm({ prefs, onSave }: { prefs: Prefs; onSave: (p: Prefs) => Promise<void> }) {
  const [p, setP] = useState<Prefs>({
    ...prefs,
    quietStart: prefs.quietStart?.slice(0, 5) ?? null,
    quietEnd: prefs.quietEnd?.slice(0, 5) ?? null,
  });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {(['inAppEnabled', 'emailEnabled', 'pushEnabled'] as const).map((k) => (
        <label key={k} className="check">
          <input type="checkbox" checked={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.checked })} />
          {k === 'inAppEnabled' ? 'In-app' : k === 'emailEnabled' ? 'Email' : 'Push'}
        </label>
      ))}
      <div className="form-grid">
        <label className="field">
          Quiet from
          <input
            type="time"
            value={p.quietStart ?? ''}
            onChange={(e) => setP({ ...p, quietStart: e.target.value || null })}
          />
        </label>
        <label className="field">
          Quiet until
          <input
            type="time"
            value={p.quietEnd ?? ''}
            onChange={(e) => setP({ ...p, quietEnd: e.target.value || null })}
          />
        </label>
      </div>
      <div>
        <button className="btn btn-primary btn-sm" onClick={() => onSave(p)}>
          Save
        </button>
      </div>
    </div>
  );
}
