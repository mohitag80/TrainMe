import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely, Transaction } from '@trainme/db';
import {
  EVENT_TYPES,
  TOPICS,
  type ConnectionPayload,
  type FeedbackPayload,
  type NotificationSendPayload,
  type SessionRefPayload,
  type PrAchievedPayload,
  type SubscriptionPayload,
  type UserProfilePayload,
} from '@trainme/events';
import { EventConsumer, type Kafka } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, HealthRegistry, KAFKA, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { NotificationConfig } from '../config/notification.config.js';
import type { NotificationDatabase } from '../infrastructure/notification.database.js';
import { DispatcherService } from './dispatcher.service.js';

type Trx = Transaction<NotificationDatabase>;

/**
 * notification-svc reacts to: user.* (contact read model), analytics.pr.achieved (celebration),
 * subscription.* (receipt / change emails) and notification.send commands from any service.
 */
@Injectable()
export class NotificationEventConsumers implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer?: EventConsumer<NotificationDatabase>;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(DATABASE) private readonly db: Kysely<NotificationDatabase>,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(SERVICE_CONFIG) private readonly config: NotificationConfig,
    private readonly health: HealthRegistry,
    private readonly dispatcher: DispatcherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.RUN_CONSUMERS) return;
    this.consumer = new EventConsumer<NotificationDatabase>({
      kafka: this.kafka,
      db: this.db,
      log: this.log,
      groupId: 'notification-svc.delivery',
      topics: [TOPICS.user, TOPICS.analytics, TOPICS.subscription, TOPICS.notificationCommands, TOPICS.record],
      handlers: {
        [EVENT_TYPES.userRegistered]: (e, trx) => this.upsertContact(trx, e.data as UserProfilePayload),
        [EVENT_TYPES.userUpdated]: (e, trx) => this.upsertContact(trx, e.data as UserProfilePayload),
        [EVENT_TYPES.userDeleted]: (e, trx) => this.eraseUser(trx, (e.data as { userId: string }).userId),
        [EVENT_TYPES.prAchieved]: (e, trx) => this.personalBest(trx, e.data as PrAchievedPayload),
        [EVENT_TYPES.connectionRequested]: (e, trx) => this.connection(trx, e.data as ConnectionPayload, 'requested'),
        [EVENT_TYPES.connectionAccepted]: (e, trx) => this.connection(trx, e.data as ConnectionPayload, 'accepted'),
        [EVENT_TYPES.connectionDeclined]: (e, trx) => this.connection(trx, e.data as ConnectionPayload, 'declined'),
        [EVENT_TYPES.connectionEnded]: (e, trx) => this.connection(trx, e.data as ConnectionPayload, 'ended'),
        [EVENT_TYPES.sessionStarted]: (e, trx) => this.liveSession(trx, e.data as SessionRefPayload),
        [EVENT_TYPES.feedbackAdded]: (e, trx) => this.feedback(trx, e.data as FeedbackPayload),
        [EVENT_TYPES.subscriptionActivated]: (e, trx) =>
          this.subscription(trx, e.data as SubscriptionPayload, 'activated'),
        [EVENT_TYPES.subscriptionChanged]: (e, trx) => this.subscription(trx, e.data as SubscriptionPayload, 'changed'),
        [EVENT_TYPES.subscriptionCanceled]: (e, trx) =>
          this.subscription(trx, e.data as SubscriptionPayload, 'canceled'),
        [EVENT_TYPES.notificationSend]: (e, trx) => {
          const c = e.data as NotificationSendPayload;
          return this.dispatcher.dispatch(
            {
              userId: c.userId,
              template: c.template,
              title: String(c.params.title ?? c.template),
              body: String(c.params.body ?? ''),
              data: c.params,
              channels: [c.channel],
            },
            trx,
          );
        },
      },
    });
    await this.consumer.start();
    this.health.register('kafka-consumer', async () => {
      if (!this.consumer?.isConnected) throw new Error('consumer disconnected');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }

  private async upsertContact(trx: Trx, u: UserProfilePayload) {
    const row = {
      email: u.email,
      displayName: u.displayName,
      timezone: u.timezone,
      locale: u.locale,
      isDeleted: false,
    };
    await trx
      .insertInto('userContact')
      .values({ userId: u.userId, ...row })
      .onConflict((oc) => oc.column('userId').doUpdateSet({ ...row, updatedAt: new Date() }))
      .execute();
  }

  /** Erasure saga step: drop contact data, reminders and inbox for the user. */
  private async eraseUser(trx: Trx, userId: string) {
    await trx.deleteFrom('reminder').where('userId', '=', userId).execute();
    await trx.deleteFrom('notification').where('userId', '=', userId).execute();
    await trx.deleteFrom('notificationPreference').where('userId', '=', userId).execute();
    await trx
      .insertInto('userContact')
      .values({ userId, email: null, displayName: 'Deleted user', timezone: 'UTC', locale: 'en', isDeleted: true })
      .onConflict((oc) =>
        oc
          .column('userId')
          .doUpdateSet({ email: null, displayName: 'Deleted user', isDeleted: true, updatedAt: new Date() }),
      )
      .execute();
  }

  /** Trainer ↔ trainee connections (FR-COA-02..04): tell the person who did not act. */
  private async connection(trx: Trx, c: ConnectionPayload, what: 'requested' | 'accepted' | 'declined' | 'ended') {
    const actorIsTrainer = c.actorId === c.trainerId;
    const to = actorIsTrainer ? c.traineeId : c.trainerId;
    const actor = actorIsTrainer ? c.trainerName : c.traineeName;
    const text = {
      requested: actorIsTrainer
        ? [`${actor} invited you to train with them`, 'Open My trainers to accept or decline.']
        : [`${actor} wants you as their trainer`, 'Open Coaching to accept or decline.'],
      accepted: [
        `${actor} accepted`,
        actorIsTrainer ? `${actor} is now your trainer.` : `${actor} is now your trainee.`,
      ],
      declined: [`${actor} declined your request`, 'You can send a new request later.'],
      ended: [`${actor} ended your coaching connection`, 'Past sessions stay in your history.'],
    }[what];
    await this.dispatcher.dispatch(
      {
        userId: to,
        template: `connection-${what}`,
        title: text[0]!,
        body: text[1]!,
        data: { ...c },
        channels: ['PUSH'],
      },
      trx,
    );
  }

  /** A trainee started a session with a trainer (FR-COA-06): the trainer can join and record. */
  private async liveSession(trx: Trx, s: SessionRefPayload) {
    if (!s.trainerId) return;
    const trainee = await trx
      .selectFrom('userContact')
      .select('displayName')
      .where('userId', '=', s.userId)
      .executeTakeFirst();
    const who = trainee?.displayName ?? 'Your trainee';
    await this.dispatcher.dispatch(
      {
        userId: s.trainerId,
        template: 'coaching-live-session',
        title: `${who} started a live session with you`,
        body: `“${s.name}” – open Coaching to follow and record.`,
        data: { ...s },
        channels: ['PUSH'],
      },
      trx,
    );
  }

  /** Trainer feedback on a session or entry (FR-COA-09). */
  private async feedback(trx: Trx, f: FeedbackPayload) {
    const trainer = await trx
      .selectFrom('userContact')
      .select('displayName')
      .where('userId', '=', f.authorId)
      .executeTakeFirst();
    await this.dispatcher.dispatch(
      {
        userId: f.traineeId,
        template: 'coaching-feedback',
        title: `${trainer?.displayName ?? 'Your trainer'} left feedback on “${f.sessionName}”`,
        body: f.excerpt,
        data: { ...f },
        channels: ['PUSH', 'EMAIL'],
      },
      trx,
    );
  }

  private async personalBest(trx: Trx, p: PrAchievedPayload) {
    const value = `${Math.round(p.value * 100) / 100}${p.unit ? ` ${p.unit}` : ''}`;
    await this.dispatcher.dispatch(
      {
        userId: p.userId,
        template: 'personal-best',
        title: `New personal best: ${p.label}`,
        body: `${p.label}: ${value}${p.previousValue !== null ? ` (previous best ${Math.round(p.previousValue * 100) / 100})` : ''}.`,
        data: { ...p },
        channels: ['PUSH'],
      },
      trx,
    );
  }

  private async subscription(trx: Trx, s: SubscriptionPayload, what: 'activated' | 'changed' | 'canceled') {
    const title = what === 'canceled' ? 'Your subscription was canceled' : `Welcome to TrainMe ${s.planCode}`;
    const body =
      what === 'canceled'
        ? 'You are now on the Free plan. All your data is kept.'
        : `Your ${s.planCode} plan is ${s.status.toLowerCase()}${s.currentPeriodEnd ? ` until ${s.currentPeriodEnd.slice(0, 10)}` : ''}.`;
    await this.dispatcher.dispatch(
      {
        userId: s.userId,
        template: `subscription-${what}`,
        title,
        body,
        data: { planCode: s.planCode },
        channels: ['EMAIL'],
      },
      trx,
    );
  }
}
