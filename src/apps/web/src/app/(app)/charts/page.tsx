import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Empty, PageHeader } from '@/components/ui';
import { api } from '@/lib/server/api';
import type { TrackerSummary } from '@/lib/types';

export const metadata = { title: 'Charts' };

/** Sidebar entry for charts: opens the first active tracker's charts (each has a tracker switcher). */
export default async function ChartsHome() {
  const trackers = await api<{ items: TrackerSummary[] }>('/trackers');
  const first = trackers.items.find((t) => t.status === 'ACTIVE');
  if (first) redirect(`/trackers/${first.id}/charts`);
  return (
    <div className="stack">
      <PageHeader title="Charts" subtitle="Daily, weekly and monthly progress for each tracker." />
      <Empty>
        No trackers yet. <Link href="/catalog">Pick a profile</Link> and record a session to see charts.
      </Empty>
    </div>
  );
}
