'use client';
import { useParams } from 'next/navigation';
import { ActivityEditor } from '../../activity-editor';

export default function ActivityVersionPage() {
  const { code, version } = useParams<{ code: string; version: string }>();
  return <ActivityEditor key={`${code}/${version}`} code={decodeURIComponent(code)} version={Number(version)} />;
}
