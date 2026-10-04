'use client';
import { useParams } from 'next/navigation';
import { ProfileEditor } from '../../profile-editor';

export default function ProfileVersionPage() {
  const { code, version } = useParams<{ code: string; version: string }>();
  return <ProfileEditor key={`${code}/${version}`} code={decodeURIComponent(code)} version={Number(version)} />;
}
