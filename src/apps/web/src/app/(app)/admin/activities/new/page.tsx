'use client';
import { useSearchParams } from 'next/navigation';
import { ActivityEditor } from '../activity-editor';

export default function NewActivityPage() {
  const category = useSearchParams().get('category') ?? undefined;
  return <ActivityEditor categoryCode={category} />;
}
