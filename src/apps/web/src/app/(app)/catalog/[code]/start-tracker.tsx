'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/lib/client/api';

/** FR-TRK-01: copy the template into a personal tracker. */
export function StartTracker({ templateCode, name }: { templateCode: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function start() {
    setBusy(true);
    try {
      const t = await api<{ id: string }>('/trackers', {
        method: 'POST',
        body: { templateCode, displayName: `My ${name}` },
      });
      router.push(`/trackers/${t.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <div className="row gap">
      {error && <span className="field-error">{error}</span>}
      <button className="btn btn-primary" onClick={start} disabled={busy}>
        {busy ? 'Creating…' : 'Start tracking'}
      </button>
    </div>
  );
}
