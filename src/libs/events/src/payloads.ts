// Payload contracts per event type. Additive changes only (schema registry mode BACKWARD).

export type UnitSystemChoice = 'METRIC' | 'IMPERIAL';

export interface UserProfilePayload {
  userId: string;
  displayName: string;
  email: string | null;
  timezone: string;
  locale: string;
  unitPreferences: Record<string, UnitSystemChoice>;
}

/** user.connection.*: trainer ↔ trainee link (FR-COA-02..04). Names let notifications avoid a lookup. */
export interface ConnectionPayload {
  connectionId: string;
  trainerId: string;
  trainerName: string;
  traineeId: string;
  traineeName: string;
  status: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'ENDED';
  /** Who acted (requested, accepted, declined or ended). */
  actorId: string;
}

export interface TrainerPayload {
  userId: string;
  isTrainer: boolean;
}

/** record.feedback.added: a trainer's note on a session or one entry (FR-COA-09). */
export interface FeedbackPayload {
  feedbackId: string;
  sessionId: string;
  sessionName: string;
  sessionDate: string;
  traineeId: string;
  authorId: string;
  clientEntryId: string | null;
  excerpt: string;
}

export interface UserDeletedPayload {
  userId: string;
  requestedAt: string;
}

export interface SubscriptionPayload {
  userId: string;
  subscriptionId: string;
  planCode: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  entitlements: Record<string, unknown>;
  currentPeriodEnd: string | null;
}

export interface TemplatePublishedPayload {
  templateCode: string;
  version: number;
  name: string;
}

export interface TrackerPayload {
  trackerId: string;
  userId: string;
  displayName: string;
  templateCode: string | null;
  schemaVersion: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface SessionEntryPayload {
  id: string;
  clientEntryId: string;
  activity: string;
  seq: number;
  group: number | null;
  recordedAt: string;
  values: Record<string, unknown>;
}

/** Full snapshot sent on completed/updated; entries omitted (entriesOmitted=true) above 512 KB. */
export interface SessionSnapshotPayload {
  sessionId: string;
  userId: string;
  trackerId: string;
  name: string;
  sessionDate: string;
  timezone: string;
  schemaVersion: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'DISCARDED';
  /** Optional trainer assigned at start (v1.4). */
  trainerId?: string | null;
  isAutoClosed: boolean;
  startedAt: string;
  endedAt: string | null;
  entryCount: number;
  entriesOmitted?: boolean;
  entries: SessionEntryPayload[];
}

export interface SessionRefPayload {
  sessionId: string;
  userId: string;
  trackerId: string;
  name: string;
  sessionDate: string;
  trainerId?: string | null;
}

export interface PrAchievedPayload {
  userId: string;
  trackerId: string;
  activityCode: string;
  metricKey: string;
  label: string;
  value: number;
  unit: string | null;
  previousValue: number | null;
  sessionId: string;
}

export interface StreakAtRiskPayload {
  userId: string;
  trackerId: string;
  currentDays: number;
}

export interface NotificationSendPayload {
  userId: string;
  channel: 'PUSH' | 'EMAIL' | 'IN_APP';
  template: string;
  params: Record<string, unknown>;
}
