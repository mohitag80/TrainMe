import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireSession } from '@/lib/server/api';

/** Every Admin Console page is for curators and admins only. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  if (!s.user.roles.some((r) => r === 'curator' || r === 'admin')) redirect('/dashboard');
  return children;
}
