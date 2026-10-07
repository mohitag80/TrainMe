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
  /** The trainee (owner). */
  userId?: string;
  /** Optional trainer assigned at start (v1.4). */
  trainerId?: string | null;
  /** The caller's role, returned by GET /sessions/{id}. */
  myRole?: 'OWNER' | 'TRAINER';
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
  /** Who logged it (trainee or trainer); absent on entries logged before v1.4. */
  recordedBy?: string | null;
}

export type CoachingRole = 'TRAINER' | 'TRAINEE' | 'NONE' | 'TECHNICAL';

export interface Profile {
  id: string;
  email: string | null;
  displayName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  mobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  dateOfBirth: string | null;
  gender: 'FEMALE' | 'MALE' | 'NON_BINARY' | 'UNDISCLOSED' | null;
  /** Set while a profile picture exists; also its cache-busting version. */
  avatarUpdatedAt: string | null;
  unitPreferences: Partial<Record<string, 'METRIC' | 'IMPERIAL'>>;
  timezone: string;
  locale: string;
  heightCm: number | null;
  weightKg: number | null;
  interests: string[];
  isOnboarded: boolean;
  isTrainer?: boolean;
  /** False for technical accounts (admin, curator, support): they never coach or train with a coach. */
  canCoach?: boolean;
  /** Coach or trainee, never both: decides which coaching screens appear. */
  coachingRole?: CoachingRole;
  trainerBio?: string | null;
  trainerSpecialties?: string[];
  rowVersion: number;
}

/** One trainer ↔ trainee link as seen by the caller (GET /profiles/connections). */
export interface Connection {
  id: string;
  status: 'PENDING' | 'ACTIVE';
  otherId: string;
  otherName: string;
  specialties: string[];
  requestedByMe: boolean;
  since: string;
}

export interface Connections {
  asTrainee: Connection[];
  asTrainer: Connection[];
}

export interface TrainerHit {
  id: string;
  displayName: string;
  bio: string | null;
  specialties: string[];
  connection: { id: string; status: 'PENDING' | 'ACTIVE'; requestedByMe: boolean } | null;
}

export interface Feedback {
  id: string;
  sessionId: string;
  authorId: string;
  clientEntryId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
}
