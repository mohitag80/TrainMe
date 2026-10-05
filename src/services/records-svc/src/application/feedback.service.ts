import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { newId, type Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type FeedbackPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, OUTBOX } from '@trainme/service-kit';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { ProfileClient } from '../infrastructure/profile.client.js';
import { SessionService } from './session.service.js';

const COLUMNS = ['id', 'sessionId', 'authorId', 'clientEntryId', 'body', 'createdAt', 'updatedAt'] as const;

/**
 * Trainer feedback (FR-COA-09): a note on the whole session or a comment on one entry. The trainee and the
 * assigned trainer read it; only the assigned trainer, while still connected, writes it; authors edit their own.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    private readonly sessions: SessionService,
    private readonly profiles: ProfileClient,
  ) {}

  async list(user: AuthUser, sessionId: string) {
    await this.sessions.loadAccessible(this.db, user, sessionId);
    const items = await this.db
      .selectFrom('sessionFeedback')
      .select([...COLUMNS])
      .where('sessionId', '=', sessionId)
      .orderBy('createdAt')
      .execute();
    return { items: items.map((f) => ({ ...f, mine: f.authorId === user.id })) };
  }

  async add(user: AuthUser, sessionId: string, input: { body: string; clientEntryId?: string | null }) {
    const { session, role } = await this.sessions.loadAccessible(this.db, user, sessionId);
    if (role !== 'TRAINER') throw ProblemError.forbidden('Only the session’s trainer can give feedback');
    if (!(await this.profiles.isConnected(user.id, session.userId)))
      throw ProblemError.forbidden('You are no longer connected with this trainee');
    if (input.clientEntryId) {
      const entry = await this.db
        .selectFrom('activityEntry')
        .select('id')
        .where('sessionId', '=', sessionId)
        .where('sessionDate', '=', session.sessionDate)
        .where('clientEntryId', '=', input.clientEntryId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      if (!entry) throw ProblemError.notFound('Entry');
    }
    const body = input.body.trim();
    return this.db.transaction().execute(async (trx) => {
      const id = newId();
      await trx
        .insertInto('sessionFeedback')
        .values({
          id,
          sessionId,
          sessionDate: session.sessionDate,
          traineeId: session.userId,
          authorId: user.id,
          clientEntryId: input.clientEntryId ?? null,
          body,
        })
        .execute();
      await this.outbox.enqueue<FeedbackPayload>(trx, TOPICS.record, {
        type: EVENT_TYPES.feedbackAdded,
        userId: session.userId,
        subject: `session/${sessionId}`,
        data: {
          feedbackId: id,
          sessionId,
          sessionName: session.name,
          sessionDate: session.sessionDate,
          traineeId: session.userId,
          authorId: user.id,
          clientEntryId: input.clientEntryId ?? null,
          excerpt: body.length > 140 ? `${body.slice(0, 137)}…` : body,
        },
      });
      this.log.info(
        { feedbackId: id, sessionId, traineeId: session.userId, authorId: user.id, onEntry: !!input.clientEntryId },
        'feedback added',
      );
      const row = await trx
        .selectFrom('sessionFeedback')
        .select([...COLUMNS])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return { ...row, mine: true };
    });
  }

  async update(user: AuthUser, sessionId: string, id: string, body: string) {
    await this.sessions.loadAccessible(this.db, user, sessionId);
    const r = await this.db
      .updateTable('sessionFeedback')
      .set({ body: body.trim(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('sessionId', '=', sessionId)
      .where('authorId', '=', user.id)
      .returning([...COLUMNS])
      .executeTakeFirst();
    if (!r) throw ProblemError.notFound('Feedback');
    this.log.info({ feedbackId: id, sessionId, authorId: user.id }, 'feedback edited');
    return { ...r, mine: true };
  }

  async remove(user: AuthUser, sessionId: string, id: string): Promise<void> {
    await this.sessions.loadAccessible(this.db, user, sessionId);
    const r = await this.db
      .deleteFrom('sessionFeedback')
      .where('id', '=', id)
      .where('sessionId', '=', sessionId)
      .where('authorId', '=', user.id)
      .executeTakeFirst();
    if (r.numDeletedRows === 0n) throw ProblemError.notFound('Feedback');
    this.log.info({ feedbackId: id, sessionId, authorId: user.id }, 'feedback removed');
  }
}
