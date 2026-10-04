import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/server/api';
import { AdminTemplates } from './admin-templates';

export const metadata = { title: 'Admin' };

/** FR-CAT-06: curators publish and retire template versions. */
export default async function AdminPage() {
  const s = await requireSession();
  if (!s.user.roles.some((r) => r === 'curator' || r === 'admin')) redirect('/dashboard');
  return (
    <div className="stack">
      <PageHeader
        title="Catalog admin"
        subtitle="Publishing a version retires the previous one; trackers keep the version they were created from."
      />
      <AdminTemplates />
    </div>
  );
}
