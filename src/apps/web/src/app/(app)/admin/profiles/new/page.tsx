'use client';
import { useSearchParams } from 'next/navigation';
import { ProfileEditor } from '../profile-editor';

export default function NewProfilePage() {
  const category = useSearchParams().get('category') ?? undefined;
  return <ProfileEditor categoryCode={category} />;
}
