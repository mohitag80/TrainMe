import type { Logger } from '@trainme/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { isUniqueViolation, newId, sql, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type UserDeletedPayload, type UserProfilePayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import { DATABASE, LOGGER, OUTBOX } from '@trainme/service-kit';
import type { ProfileDatabase, UnitPreferences, UserProfileTable } from '../infrastructure/profile.database.js';

type Trx = Transaction<ProfileDatabase>;

export interface ProfileUpdate {
  displayName?: string;
  dateOfBirth?: string | null;
  gender?: UserProfileTable['gender'];
  heightCm?: number | null;
  weightKg?: number | null;
  unitPreferences?: UnitPreferences;
  /** METRIC/IMPERIAL preset fills every dimension, then unitPreferences overrides individual ones (FR-PRF-06). */
  unitPreset?: 'METRIC' | 'IMPERIAL';
  timezone?: string;
  locale?: string;
  weekStart?: 'MON' | 'SUN';
  interests?: string[];
  isOnboarded?: boolean;
}

const DIMENSIONS = ['speed', 'mass', 'length', 'volume', 'pace', 'energy', 'duration'] as const;
const PROFILE_COLUMNS = [
  'id',
  'email',
  'displayName',
  'dateOfBirth',
  'gender',
  'heightCm',
  'weightKg',
  'unitPreferences',
  'timezone',
  'locale',
  'weekStart',
  'interests',
  'isOnboarded',
  'isTrainer',
  'trainerBio',
  'trainerSpecialties',
  'rowVersion',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class ProfileService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<ProfileDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
  ) {}

  /** Returns the caller's profile, creating it from the token on first use (user.registered). */
  async me(user: AuthUser) {
    const existing = await this.find(this.db, user.id);
    if (existing) return existing;
    try {
      return await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('userProfile')
          .values({
            id: user.id,
            email: user.email ?? null,
            displayName: (user.name ?? user.email?.split('@')[0] ?? 'Athlete').slice(0, 80),
            dateOfBirth: null,
            gender: null,
            heightCm: null,
            weightKg: null,
            unitPreferences: '{}',
            timezone: 'UTC',
            locale: 'en',
            weekStart: 'MON',
            interests: [],
            isOnboarded: false,
            rowVersion: 1,
            deletedAt: null,
          })
          .execute();
        const created = (await this.find(trx, user.id))!;
        await this.emit(trx, EVENT_TYPES.userRegistered, created);
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return (await this.find(this.db, user.id))!; // created concurrently by another request
      throw err;
    }
  }

  /** FR-PRF-01/06 (If-Match). Units are preferences only: no stored measurement is ever converted. */
  async update(user: AuthUser, ifMatch: number | undefined, u: ProfileUpdate) {
    await this.me(user);
    if (u.timezone && !isTimeZone(u.timezone))
      throw ProblemError.validation([
        { pointer: '/body/timezone', code: 'invalid', message: 'Unknown IANA time zone' },
      ]);
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT 1 FROM user_profile WHERE id = ${user.id} FOR UPDATE`.execute(trx);
      const cur = (await this.find(trx, user.id))!;
      if (ifMatch !== undefined && ifMatch !== cur.rowVersion) throw ProblemError.preconditionFailed();
      let units: UnitPreferences | undefined;
      if (u.unitPreset || u.unitPreferences) {
        const preset = u.unitPreset
          ? Object.fromEntries(DIMENSIONS.map((d) => [d, u.unitPreset]))
          : cur.unitPreferences;
        units = { ...preset, ...u.unitPreferences };
      }
      await trx
        .updateTable('userProfile')
        .set({
          ...(u.displayName !== undefined ? { displayName: u.displayName } : {}),
          ...(u.dateOfBirth !== undefined ? { dateOfBirth: u.dateOfBirth } : {}),
          ...(u.gender !== undefined ? { gender: u.gender } : {}),
          ...(u.heightCm !== undefined ? { heightCm: u.heightCm } : {}),
          ...(u.weightKg !== undefined ? { weightKg: u.weightKg } : {}),
          ...(units ? { unitPreferences: JSON.stringify(units) } : {}),
          ...(u.timezone !== undefined ? { timezone: u.timezone } : {}),
          ...(u.locale !== undefined ? { locale: u.locale } : {}),
          ...(u.weekStart !== undefined ? { weekStart: u.weekStart } : {}),
          ...(u.interests !== undefined ? { interests: u.interests } : {}),
          ...(u.isOnboarded !== undefined ? { isOnboarded: u.isOnboarded } : {}),
          rowVersion: cur.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', user.id)
        .execute();
      const updated = (await this.find(trx, user.id))!;
      await this.emit(trx, EVENT_TYPES.userUpdated, updated);
      return updated;
    });
  }

  async devices(user: AuthUser) {
    return this.db
      .selectFrom('userDevice')
      .select(['id', 'platform', 'appVersion', 'lastSeenAt', 'createdAt'])
      .where('userId', '=', user.id)
      .orderBy('lastSeenAt', 'desc')
      .execute();
  }

  /** Registers (or refreshes) a push token for this user; the same token twice is an upsert. */
  async registerDevice(
    user: AuthUser,
    d: { platform: 'IOS' | 'ANDROID' | 'WEB'; pushToken: string; appVersion?: string },
  ) {
    await this.me(user);
    return this.db
      .insertInto('userDevice')
      .values({
        id: newId(),
        userId: user.id,
        platform: d.platform,
        pushToken: d.pushToken,
        appVersion: d.appVersion ?? null,
      })
      .onConflict((oc) =>
        oc
          .columns(['userId', 'pushToken'])
          .doUpdateSet({ platform: d.platform, appVersion: d.appVersion ?? null, lastSeenAt: new Date() }),
      )
      .returning(['id', 'platform', 'appVersion', 'lastSeenAt'])
      .executeTakeFirstOrThrow()
      .then((device) => {
        this.log.info({ userId: user.id, deviceId: device.id, platform: d.platform }, 'device registered');
        return device;
      });
  }

  async removeDevice(user: AuthUser, id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('userDevice')
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (r.numDeletedRows === 0n) throw ProblemError.notFound(`Device ${id}`);
    this.log.info({ userId: user.id, deviceId: id }, 'device removed');
  }

  /** FR-PRF-03: queued; the export job collects data from every service (asynchronous, ≤ 24 h). */
  async requestExport(user: AuthUser) {
    await this.me(user);
    return this.db
      .insertInto('dataRequest')
      .values({ id: newId(), userId: user.id, type: 'EXPORT', status: 'REQUESTED', completedAt: null, details: '{}' })
      .returning(['id', 'type', 'status', 'requestedAt'])
      .executeTakeFirstOrThrow()
      .then((r) => {
        this.log.info({ userId: user.id, requestId: r.id }, 'data export requested');
        return r;
      });
  }

  async requests(user: AuthUser) {
    return this.db
      .selectFrom('dataRequest')
      .select(['id', 'type', 'status', 'requestedAt', 'completedAt'])
      .where('userId', '=', user.id)
      .orderBy('requestedAt', 'desc')
      .limit(20)
      .execute();
  }

  /**
   * FR-PRF-04: soft-deletes the profile and announces user.deleted; every service erases or crypto-shreds
   * that user's rows (saga, LLD §6). Personal fields are blanked immediately.
   */
  async erase(user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.find(trx, user.id);
      if (!cur) throw ProblemError.notFound('Profile');
      const req = await trx
        .insertInto('dataRequest')
        .values({
          id: newId(),
          userId: user.id,
          type: 'ERASURE',
          status: 'PROCESSING',
          completedAt: null,
          details: '{}',
        })
        .returning(['id', 'type', 'status', 'requestedAt'])
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('userProfile')
        .set({
          email: null,
          displayName: 'Deleted user',
          dateOfBirth: null,
          gender: null,
          heightCm: null,
          weightKg: null,
          deletedAt: new Date(),
          rowVersion: cur.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', user.id)
        .execute();
      await trx.deleteFrom('userDevice').where('userId', '=', user.id).execute();
      // Erasure ends every trainer/trainee link (FR-COA-04); other users keep their history rows.
      await trx
        .updateTable('trainerConnection')
        .set({ status: 'ENDED', endedAt: new Date(), endedBy: user.id })
        .where((eb) => eb.or([eb('trainerId', '=', user.id), eb('traineeId', '=', user.id)]))
        .where('status', 'in', ['PENDING', 'ACTIVE'])
        .execute();
      await this.outbox.enqueue<UserDeletedPayload>(trx, TOPICS.user, {
        type: EVENT_TYPES.userDeleted,
        userId: user.id,
        subject: `user/${user.id}`,
        data: { userId: user.id, requestedAt: new Date().toISOString() },
      });
      this.log.info({ userId: user.id, requestId: req.id }, 'account erasure requested');
      return req;
    });
  }

  /** S9: support search by email or name (trigram), support/admin only. */
  async search(q: string, limit: number) {
    const term = q.toLowerCase();
    this.log.info({ queryLength: q.length, limit }, 'support user search'); // the query itself may be an email
    return this.db
      .selectFrom('userProfile')
      .select(['id', 'email', 'displayName', 'createdAt', 'deletedAt'])
      .where((eb) =>
        eb.or([eb(sql`email::text`, 'ilike', `%${term}%`), eb(sql`lower(display_name)`, 'like', `%${term}%`)]),
      )
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();
  }

  private async find(db: Kysely<ProfileDatabase> | Trx, id: string) {
    return db
      .selectFrom('userProfile')
      .select([...PROFILE_COLUMNS])
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private async emit(
    trx: Trx,
    type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
    p: {
      id: string;
      displayName: string;
      email: string | null;
      timezone: string;
      locale: string;
      unitPreferences: UnitPreferences;
    },
  ) {
    this.log.info(
      { event: type, userId: p.id, timezone: p.timezone, locale: p.locale },
      type.replace('user.', 'profile '),
    );
    await this.outbox.enqueue<UserProfilePayload>(trx, TOPICS.user, {
      type,
      userId: p.id,
      subject: `user/${p.id}`,
      data: {
        userId: p.id,
        displayName: p.displayName,
        email: p.email,
        timezone: p.timezone,
        locale: p.locale,
        unitPreferences: p.unitPreferences as UserProfilePayload['unitPreferences'],
      },
    });
  }
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
