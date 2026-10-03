import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely, Transaction } from '@trainme/db';
import {
  EVENT_TYPES,
  TOPICS,
  type NotificationSendPayload,
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
      topics: [TOPICS.user, TOPICS.analytics, TOPICS.subscription, TOPICS.notificationCommands],
      handlers: {
        [EVENT_TYPES.userRegistered]: (e, trx) => this.upsertContact(trx, e.data as UserProfilePayload),
        [EVENT_TYPES.userUpdated]: (e, trx) => this.upsertContact(trx, e.data as UserProfilePayload),
        [EVENT_TYPES.userDeleted]: (e, trx) => this.eraseUser(trx, (e.data as { userId: string }).userId),
        [EVENT_TYPES.prAchieved]: (e, trx) => this.personalBest(trx, e.data as PrAchievedPayload),
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
