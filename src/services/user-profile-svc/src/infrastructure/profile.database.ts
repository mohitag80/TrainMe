import type { ColumnType } from 'kysely';
import type { OutboxEventTable } from '@trainme/kafka';

type Json<T> = ColumnType<T, string, string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export type UnitPreferences = Partial<
  Record<'speed' | 'mass' | 'length' | 'volume' | 'pace' | 'energy' | 'duration', 'METRIC' | 'IMPERIAL'>
>;

export interface UserProfileTable {
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
  avatarUpdatedAt: Date | null;
  dateOfBirth: string | null;
  gender: 'FEMALE' | 'MALE' | 'NON_BINARY' | 'UNDISCLOSED' | null;
  heightCm: number | null;
  weightKg: number | null;
  unitPreferences: Json<UnitPreferences>;
  timezone: string;
  locale: string;
  weekStart: 'MON' | 'SUN';
  interests: string[];
  isOnboarded: boolean;
  isTrainer: Defaulted<boolean>;
  trainerBio: string | null;
  trainerSpecialties: Defaulted<string[]>;
  rowVersion: number;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: Defaulted<Date>;
  deletedAt: Date | null;
}

export interface UserDeviceTable {
  id: string;
  userId: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  pushToken: string;
  appVersion: string | null;
  lastSeenAt: Defaulted<Date>;
  createdAt: ColumnType<Date, never, never>;
}

export interface DataRequestTable {
  id: string;
  userId: string;
  type: 'EXPORT' | 'ERASURE';
  status: 'REQUESTED' | 'PROCESSING' | 'READY' | 'DONE' | 'FAILED';
  requestedAt: ColumnType<Date, never, never>;
  completedAt: Date | null;
  details: Json<Record<string, unknown>>;
}

export interface UserAvatarTable {
  userId: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: Buffer;
  updatedAt: Defaulted<Date>;
}

export type ConnectionStatus = 'PENDING' | 'ACTIVE' | 'DECLINED' | 'ENDED';

export interface TrainerConnectionTable {
  id: string;
  trainerId: string;
  traineeId: string;
  status: ConnectionStatus;
  requestedBy: string;
  createdAt: ColumnType<Date, never, never>;
  respondedAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
}

export interface ProfileDatabase {
  userProfile: UserProfileTable;
  trainerConnection: TrainerConnectionTable;
  userAvatar: UserAvatarTable;
  userDevice: UserDeviceTable;
  dataRequest: DataRequestTable;
  outboxEvent: OutboxEventTable;
}
