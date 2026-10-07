import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { isUniqueViolation, newId, sql, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type ConnectionPayload, type TrainerPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, OUTBOX } from '@trainme/service-kit';
import type { ConnectionStatus, ProfileDatabase } from '../infrastructure/profile.database.js';
import { ProfileService } from './profile.service.js';

type Trx = Transaction<ProfileDatabase>;
type Db = Kysely<ProfileDatabase> | Trx;

/**
 * Technical accounts run the application (admins, catalog curators, support). They are never trainers, and a
 * trainer is never one of them: coaching is for end users only (docs/12 §2).
 */
export const TECHNICAL_ROLES = ['admin', 'curator', 'support'] as const;
export const isTechnical = (user: AuthUser) =>
  user.roles.some((r) => (TECHNICAL_ROLES as readonly string[]).includes(r));

/**
 * A person is either a coach or a trainee, never both (v1.5): TRAINER = trainer status on; TRAINEE = has a pending
 * or active trainer; NONE = may still pick either; TECHNICAL = admin/curator/support, outside coaching.
 */
export type CoachingRole = 'TRAINER' | 'TRAINEE' | 'NONE' | 'TECHNICAL';

const OPEN: ConnectionStatus[] = ['PENDING', 'ACTIVE'];
const COACH_NOT_TRAINEE = 'Coaches cannot be trainees of another coach';

export interface TrainerInput {
  isTrainer: boolean;
  bio?: string | null;
  specialties?: string[];
}

/**
 * Trainers and trainer ↔ trainee connections (docs/12, FR-COA-01..04, 10). Every rule is checked here, never only
 * in the web app: who may invite whom, who answers, one open connection per pair.
 */
@Injectable()
export class CoachingService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<ProfileDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    private readonly profiles: ProfileService,
  ) {}

  /** The caller's side in coaching – drives which coaching screens the web app shows (FR-COA-01, v1.5). */
  async roleOf(user: AuthUser, isTrainer: boolean): Promise<CoachingRole> {
    if (isTechnical(user)) return 'TECHNICAL';
    if (isTrainer) return 'TRAINER';
    return (await this.openCount(this.db, 'traineeId', user.id)) > 0 ? 'TRAINEE' : 'NONE';
  }

  /**
   * FR-COA-01: self-service trainer status with a short bio and specialties. A trainee (pending or active trainer)
   * cannot become a coach, and a coach with trainees cannot stop being one until those connections end.
   */
  async setTrainer(user: AuthUser, input: TrainerInput) {
    if (input.isTrainer && isTechnical(user)) {
      this.log.warn({ userId: user.id, roles: user.roles }, 'technical account tried to become a trainer');
      throw ProblemError.forbidden('Admin, catalog and support accounts cannot be trainers – use a personal account');
    }
    await this.profiles.me(user); // creates the profile on first use
    const specialties = [...new Set((input.specialties ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, 10);
    return this.db.transaction().execute(async (trx) => {
      // Serialises with connect()/respond(), which lock the trainee's row before linking them to a trainer.
      await sql`SELECT 1 FROM user_profile WHERE id = ${user.id} FOR UPDATE`.execute(trx);
      if (input.isTrainer && (await this.openCount(trx, 'traineeId', user.id)) > 0) {
        this.log.info({ userId: user.id }, 'trainee tried to become a trainer');
        throw ProblemError.conflict(
          'trainee-cannot-coach',
          'You have a trainer, so you cannot coach others. Disconnect from your trainers first.',
        );
      }
      if (!input.isTrainer && (await this.openCount(trx, 'trainerId', user.id)) > 0)
        throw ProblemError.conflict(
          'coach-has-trainees',
          'You still have trainees. Disconnect from them on the Coaching page before you stop coaching.',
        );
      await trx
        .updateTable('userProfile')
        .set({
          isTrainer: input.isTrainer,
          trainerBio: input.bio?.trim() || null,
          trainerSpecialties: specialties,
          updatedAt: new Date(),
        })
        .where('id', '=', user.id)
        .execute();
      await this.outbox.enqueue<TrainerPayload>(trx, TOPICS.user, {
        type: EVENT_TYPES.trainerUpdated,
        userId: user.id,
        subject: `user/${user.id}`,
        data: { userId: user.id, isTrainer: input.isTrainer },
      });
      this.log.info({ userId: user.id, isTrainer: input.isTrainer, specialties }, 'trainer status changed');
      return { isTrainer: input.isTrainer, bio: input.bio?.trim() || null, specialties };
    });
  }

  /** FR-COA-02: trainers by name or specialty (the caller excluded), with the caller's connection status. */
  async searchTrainers(user: AuthUser, q: string | undefined, limit: number) {
    const term = q?.trim().toLowerCase() ?? '';
    let query = this.db
      .selectFrom('userProfile as p')
      .select(['p.id', 'p.displayName', 'p.trainerBio', 'p.trainerSpecialties'])
      .where('p.isTrainer', '=', true)
      .where('p.deletedAt', 'is', null)
      .where('p.id', '!=', user.id);
    if (term)
      query = query.where((eb) =>
        eb.or([
          eb(sql`lower(p.display_name)`, 'like', `%${term}%`),
          eb(sql`lower(array_to_string(p.trainer_specialties, ' '))`, 'like', `%${term}%`),
        ]),
      );
    const rows = await query.orderBy('p.displayName').limit(limit).execute();
    const links = rows.length
      ? await this.db
          .selectFrom('trainerConnection')
          .select(['id', 'trainerId', 'status', 'requestedBy'])
          .where('traineeId', '=', user.id)
          .where(
            'trainerId',
            'in',
            rows.map((r) => r.id),
          )
          .where('status', 'in', ['PENDING', 'ACTIVE'])
          .execute()
      : [];
    this.log.debug({ userId: user.id, q: term, hits: rows.length }, 'trainer search');
    return rows.map((r) => {
      const link = links.find((l) => l.trainerId === r.id);
      return {
        id: r.id,
        displayName: r.displayName,
        bio: r.trainerBio,
        specialties: r.trainerSpecialties,
        connection: link ? { id: link.id, status: link.status, requestedByMe: link.requestedBy === user.id } : null,
      };
    });
  }

  /** The caller's connections in both roles, newest first, with the other person's name. */
  async myConnections(user: AuthUser) {
    const rows = await this.db
      .selectFrom('trainerConnection as c')
      .innerJoin('userProfile as tr', 'tr.id', 'c.trainerId')
      .innerJoin('userProfile as te', 'te.id', 'c.traineeId')
      .select([
        'c.id',
        'c.trainerId',
        'c.traineeId',
        'c.status',
        'c.requestedBy',
        'c.createdAt',
        'c.respondedAt',
        'c.endedAt',
        'tr.displayName as trainerName',
        'tr.trainerSpecialties as trainerSpecialties',
        'te.displayName as traineeName',
      ])
      .where((eb) => eb.or([eb('c.trainerId', '=', user.id), eb('c.traineeId', '=', user.id)]))
      .where('c.status', 'in', ['PENDING', 'ACTIVE'])
      .orderBy('c.createdAt', 'desc')
      .execute();
    const view = (r: (typeof rows)[number], asTrainer: boolean) => ({
      id: r.id,
      status: r.status,
      otherId: asTrainer ? r.traineeId : r.trainerId,
      otherName: asTrainer ? r.traineeName : r.trainerName,
      specialties: asTrainer ? [] : r.trainerSpecialties,
      requestedByMe: r.requestedBy === user.id,
      since: r.respondedAt ?? r.createdAt,
    });
    return {
      asTrainee: rows.filter((r) => r.traineeId === user.id).map((r) => view(r, false)),
      asTrainer: rows.filter((r) => r.trainerId === user.id).map((r) => view(r, true)),
    };
  }

  /**
   * FR-COA-02/03: a trainee requests a trainer (`trainerId`), or a trainer invites a trainee by e-mail
   * (`traineeEmail`). The other side must accept. A pending request in the opposite direction is accepted instead.
   */
  async connect(user: AuthUser, input: { trainerId?: string; traineeEmail?: string }) {
    const me = await this.profiles.me(user);
    let trainerId: string;
    let traineeId: string;
    if (isTechnical(user))
      throw ProblemError.forbidden('Admin, catalog and support accounts do not take part in coaching');
    if (input.trainerId) {
      if (me.isTrainer) throw ProblemError.forbidden(COACH_NOT_TRAINEE);
      const trainer = await this.profileOf(this.db, input.trainerId);
      if (!trainer?.isTrainer) throw ProblemError.notFound('Trainer');
      [trainerId, traineeId] = [trainer.id, user.id];
    } else {
      if (!me.isTrainer)
        throw ProblemError.forbidden('Turn on “I coach or train others” in your profile before inviting trainees');
      const email = input.traineeEmail!.trim().toLowerCase();
      const trainee = await this.db
        .selectFrom('userProfile')
        .select(['id'])
        .where(sql`lower(email::text)`, '=', email)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      // Same answer for unknown and existing addresses would leak nothing more – but users need to know why.
      if (!trainee) throw ProblemError.notFound('A TrainMe user with that e-mail address');
      [trainerId, traineeId] = [user.id, trainee.id];
      if ((await this.profileOf(this.db, trainee.id))?.isTrainer)
        throw ProblemError.forbidden(`That person is a coach. ${COACH_NOT_TRAINEE}.`);
    }
    if (trainerId === traineeId) throw ProblemError.badRequest('self-connection', 'You cannot connect with yourself');

    const open = await this.db
      .selectFrom('trainerConnection')
      .select(['id', 'status', 'requestedBy'])
      .where('trainerId', '=', trainerId)
      .where('traineeId', '=', traineeId)
      .where('status', 'in', ['PENDING', 'ACTIVE'])
      .executeTakeFirst();
    if (open?.status === 'ACTIVE') throw ProblemError.conflict('already-connected', 'You are already connected');
    if (open && open.requestedBy !== user.id) {
      this.log.info({ connectionId: open.id, userId: user.id }, 'matching request found – accepting it');
      return this.respond(user, open.id, 'accept');
    }
    if (open) throw ProblemError.conflict('already-requested', 'A request is already waiting for an answer');

    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.assertNotCoach(trx, traineeId);
        const id = newId();
        await trx
          .insertInto('trainerConnection')
          .values({
            id,
            trainerId,
            traineeId,
            status: 'PENDING',
            requestedBy: user.id,
            respondedAt: null,
            endedAt: null,
            endedBy: null,
          })
          .execute();
        const row = await this.connection(trx, id);
        await this.emit(trx, EVENT_TYPES.connectionRequested, row, user.id);
        return this.toView(row, user.id);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw ProblemError.conflict('already-requested', 'A request is already waiting for an answer');
      throw err;
    }
  }

  /** FR-COA-04: only the side that did not send the request may accept or decline it. */
  async respond(user: AuthUser, id: string, answer: 'accept' | 'decline') {
    return this.db.transaction().execute(async (trx) => {
      const c = await this.lockMine(trx, user, id);
      if (c.status !== 'PENDING') throw ProblemError.conflict('not-pending', 'This request was already answered');
      if (c.requestedBy === user.id) throw ProblemError.forbidden('The other person has to answer your request');
      if (answer === 'accept' && isTechnical(user))
        throw ProblemError.forbidden('Admin, catalog and support accounts do not take part in coaching');
      if (answer === 'accept') await this.assertNotCoach(trx, c.traineeId);
      const status: ConnectionStatus = answer === 'accept' ? 'ACTIVE' : 'DECLINED';
      await trx
        .updateTable('trainerConnection')
        .set({ status, respondedAt: new Date() })
        .where('id', '=', id)
        .execute();
      const row = await this.connection(trx, id);
      await this.emit(
        trx,
        answer === 'accept' ? EVENT_TYPES.connectionAccepted : EVENT_TYPES.connectionDeclined,
        row,
        user.id,
      );
      return this.toView(row, user.id);
    });
  }

  /** FR-COA-04/10: either side ends a connection (or withdraws its own pending request). History stays. */
  async disconnect(user: AuthUser, id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const c = await this.lockMine(trx, user, id);
      if (c.status !== 'PENDING' && c.status !== 'ACTIVE') return;
      await trx
        .updateTable('trainerConnection')
        .set({ status: 'ENDED', endedAt: new Date(), endedBy: user.id })
        .where('id', '=', id)
        .execute();
      await this.emit(trx, EVENT_TYPES.connectionEnded, await this.connection(trx, id), user.id);
    });
  }

  /** Service check used by records-svc when a session names a trainer (and before a trainer records). */
  async isActive(trainerId: string, traineeId: string) {
    const row = await this.db
      .selectFrom('trainerConnection')
      .select('id')
      .where('trainerId', '=', trainerId)
      .where('traineeId', '=', traineeId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    this.log.debug({ trainerId, traineeId, active: !!row }, 'connection check');
    return { active: !!row };
  }

  /** Display names for ids (trainer dashboards show trainee names; ids the caller has no link to are omitted). */
  async names(user: AuthUser, ids: string[]) {
    if (!ids.length) return [];
    const linked = await this.db
      .selectFrom('trainerConnection')
      .select(['trainerId', 'traineeId'])
      .where((eb) => eb.or([eb('trainerId', '=', user.id), eb('traineeId', '=', user.id)]))
      .execute();
    const allowed = new Set([user.id, ...linked.flatMap((l) => [l.trainerId, l.traineeId])]);
    const wanted = ids.filter((i) => allowed.has(i));
    if (!wanted.length) return [];
    return this.db.selectFrom('userProfile').select(['id', 'displayName']).where('id', 'in', wanted).execute();
  }

  // ---------------------------------------------------------------- helpers

  private async openCount(db: Db, side: 'trainerId' | 'traineeId', userId: string) {
    const r = await db
      .selectFrom('trainerConnection')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where(side, '=', userId)
      .where('status', 'in', OPEN)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** Locks the trainee's profile row (see setTrainer) and refuses when they are a coach. */
  private async assertNotCoach(trx: Trx, traineeId: string) {
    const row = await sql<{
      is_trainer: boolean;
    }>`SELECT is_trainer FROM user_profile WHERE id = ${traineeId} FOR SHARE`.execute(trx);
    if (row.rows[0]?.is_trainer) throw ProblemError.forbidden(COACH_NOT_TRAINEE);
  }

  private profileOf(db: Db, id: string) {
    return db
      .selectFrom('userProfile')
      .select(['id', 'displayName', 'isTrainer'])
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private connection(db: Db, id: string) {
    return db
      .selectFrom('trainerConnection as c')
      .innerJoin('userProfile as tr', 'tr.id', 'c.trainerId')
      .innerJoin('userProfile as te', 'te.id', 'c.traineeId')
      .select([
        'c.id',
        'c.trainerId',
        'c.traineeId',
        'c.status',
        'c.requestedBy',
        'c.createdAt',
        'c.respondedAt',
        'tr.displayName as trainerName',
        'te.displayName as traineeName',
      ])
      .where('c.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  private async lockMine(trx: Trx, user: AuthUser, id: string) {
    const c = await trx
      .selectFrom('trainerConnection')
      .select(['id', 'trainerId', 'traineeId', 'status', 'requestedBy'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!c || (c.trainerId !== user.id && c.traineeId !== user.id)) throw ProblemError.notFound('Connection');
    return c;
  }

  private toView(r: Awaited<ReturnType<CoachingService['connection']>>, me: string) {
    const asTrainer = r.trainerId === me;
    return {
      id: r.id,
      status: r.status,
      role: asTrainer ? ('TRAINER' as const) : ('TRAINEE' as const),
      otherId: asTrainer ? r.traineeId : r.trainerId,
      otherName: asTrainer ? r.traineeName : r.trainerName,
      requestedByMe: r.requestedBy === me,
    };
  }

  private async emit(trx: Trx, type: string, r: Awaited<ReturnType<CoachingService['connection']>>, actorId: string) {
    this.log.info(
      { event: type, connectionId: r.id, trainerId: r.trainerId, traineeId: r.traineeId, status: r.status, actorId },
      type.replace('user.connection.', 'connection '),
    );
    await this.outbox.enqueue<ConnectionPayload>(trx, TOPICS.user, {
      type: type as (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
      // Keyed by the trainee so one pair's events stay in order.
      userId: r.traineeId,
      subject: `connection/${r.id}`,
      data: {
        connectionId: r.id,
        trainerId: r.trainerId,
        trainerName: r.trainerName,
        traineeId: r.traineeId,
        traineeName: r.traineeName,
        status: r.status,
        actorId,
      },
    });
  }
}
