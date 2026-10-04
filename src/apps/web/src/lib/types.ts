// API shapes used by the web app (see docs/03 §4 and each service's controller).
import type { EffectiveActivity } from '@trainme/schema';

export interface TrackerSummary {
  id: string;
  displayName: string;
  templateCode: string | null;
  templateVersion: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
  schemaVersion: number;
  rowVersion: number;
  createdAt: string;
  upgradeAvailable: { version: number; name: string } | null;
}

export interface TrackerDetail extends TrackerSummary {
  userId: string;
  displayUnits: Record<string, string>;
  overrides: {
    id: string;
    target: string;
    action: string;
    activityCode: string;
    itemKey: string | null;
    definition: Record<string, unknown>;
    createdAt: string;
  }[];
}

export interface TrackerSchema {
  trackerId: string;
  schemaVersion: number;
  activities: EffectiveActivity[];
}

export interface Session {
  id: string;
  trackerId: string;
  sessionDate: string;
  name: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'DISCARDED';
  startedAt: string;
  endedAt: string | null;
  timezone: string;
  schemaVersion: number;
  lastBatchSeq: number;
  entryCount: number;
  isAutoClosed: boolean;
  notes: string | null;
  tags: string[];
  rowVersion: number;
}

export interface SessionEntry {
  id?: string;
  clientEntryId: string;
  activityCode: string;
  seqNo: number;
  groupNo: number | null;
  recordedAt: string;
  values: Record<string, unknown>;
  rowVersion: number;
}

export interface Profile {
  id: string;
  email: string | null;
  displayName: string;
  unitPreferences: Partial<Record<string, 'METRIC' | 'IMPERIAL'>>;
  timezone: string;
  locale: string;
  heightCm: number | null;
  weightKg: number | null;
  interests: string[];
  isOnboarded: boolean;
  rowVersion: number;
}
