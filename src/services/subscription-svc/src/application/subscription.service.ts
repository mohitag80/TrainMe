import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { isUniqueViolation, newId, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { EVENT_TYPES, TOPICS, type SubscriptionPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, OUTBOX, SERVICE_CONFIG } from '@trainme/service-kit';
import type { SubscriptionConfig } from '../config/subscription.config.js';
import { signWebhook } from '../domain/mock-signature.js';
import type { BillingDatabase, SubscriptionTable } from '../infrastructure/billing.database.js';
import { KeycloakAdminClient } from '../infrastructure/keycloak-admin.client.js';

type Trx = Transaction<BillingDatabase>;

export interface WebhookEvent {
  id: string;
  type: 'checkout.completed' | 'subscription.canceled';
  data: { checkoutId?: string; subscriptionId?: string; userId: string; planCode: string };
}

const SUB_COLUMNS = [
  'id',
  'userId',
  'planCode',
  'status',
  'provider',
  'currentPeriodStart',
  'currentPeriodEnd',
  'cancelAtPeriodEnd',
  'rowVersion',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<BillingDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(SERVICE_CONFIG) private readonly config: SubscriptionConfig,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly keycloak: KeycloakAdminClient,
  ) {}

  plans() {
    return this.db.selectFrom('plan').selectAll().where('isActive', '=', true).orderBy('sortOrder').execute();
  }

  /** Current subscription and effective entitlements (FREE when there is none). */
  async mine(user: AuthUser) {
    const sub = await this.live(this.db, user.id);
    const plan = await this.db
      .selectFrom('plan')
      .selectAll()
      .where('code', '=', sub?.planCode ?? 'FREE')
      .executeTakeFirstOrThrow();
    return { plan, subscription: sub ?? null, entitlements: plan.entitlements };
  }

  async payments(user: AuthUser) {
    return this.db
      .selectFrom('paymentEvent as p')
      .innerJoin('subscription as s', 's.id', 'p.subscriptionId')
      .select(['p.id', 'p.type', 'p.provider', 'p.receivedAt', 's.planCode'])
      .where('s.userId', '=', user.id)
      .orderBy('p.receivedAt', 'desc')
      .limit(50)
      .execute();
  }

  /** FR-SUB-02/03: opens a checkout; the MOCK provider returns its own hosted page. */
  async checkout(user: AuthUser, planCode: string) {
    const plan = await this.db
      .selectFrom('plan')
      .select(['code', 'priceMinor', 'isActive'])
      .where('code', '=', planCode)
      .executeTakeFirst();
    if (!plan || !plan.isActive || plan.priceMinor === 0)
      throw ProblemError.badRequest('invalid-plan', `${planCode} cannot be purchased`);
    const current = await this.live(this.db, user.id);
    if (current?.planCode === planCode && current.status !== 'PAST_DUE')
      throw ProblemError.conflict('already-subscribed', `You are already on ${planCode}`);
    const id = newId();
    await this.db
      .insertInto('checkoutSession')
      .values({
        id,
        userId: user.id,
        planCode,
        provider: 'MOCK',
        status: 'OPEN',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .execute();
    this.log.info({ userId: user.id, planCode, checkoutId: id, provider: 'MOCK' }, 'checkout started');
    return {
      checkoutId: id,
      provider: 'MOCK',
      checkoutUrl: `${this.config.PUBLIC_URL}/api/v1/mock-payments/checkout/${id}`,
    };
  }

  async checkoutSession(id: string) {
    const c = await this.db
      .selectFrom('checkoutSession as c')
      .innerJoin('plan as p', 'p.code', 'c.planCode')
      .select([
        'c.id',
        'c.userId',
        'c.planCode',
        'c.status',
        'c.expiresAt',
        'p.name',
        'p.priceMinor',
        'p.currency',
        'p.billingInterval',
      ])
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c) throw ProblemError.notFound('Checkout');
    return c;
  }

  /**
   * Mock provider "Pay" button: builds the provider event, signs it like a real provider and posts it to our
   * public webhook endpoint, so the test environment exercises the same code path as Stripe/Razorpay.
   */
  async completeMockCheckout(id: string, outcome: 'pay' | 'cancel') {
    const c = await this.checkoutSession(id);
    if (c.status !== 'OPEN' || c.expiresAt < new Date())
      throw ProblemError.conflict('checkout-closed', 'This checkout is no longer open');
    this.log.info({ checkoutId: id, userId: c.userId, planCode: c.planCode, outcome }, 'mock payment page answered');
    if (outcome === 'cancel') {
      await this.db.updateTable('checkoutSession').set({ status: 'CANCELED' }).where('id', '=', id).execute();
      return { status: 'CANCELED', returnUrl: `${this.config.PUBLIC_URL}/subscription?checkout=canceled` };
    }
    const event: WebhookEvent = {
      id: `evt_${newId()}`,
      type: 'checkout.completed',
      data: { checkoutId: id, userId: c.userId, planCode: c.planCode },
    };
    const body = JSON.stringify(event);
    const res = await fetch(`http://127.0.0.1:${this.config.PORT}/api/v1/webhooks/payments/mock`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': signWebhook(this.config.MOCK_PAYMENT_WEBHOOK_SECRET, body),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      this.log.error({ checkoutId: id, status: res.status }, 'mock webhook call failed');
      throw new ProblemError(502, 'payment-failed', 'Payment failed', `Webhook answered ${res.status}`);
    }
    return { status: 'COMPLETED', returnUrl: `${this.config.PUBLIC_URL}/subscription?checkout=success` };
  }

  /** FR-SUB-04: idempotent by provider event id; a duplicate delivery is acknowledged and ignored. */
  async handleWebhook(provider: 'MOCK', event: WebhookEvent): Promise<{ duplicate: boolean }> {
    this.log.info(
      { provider, providerEventId: event.id, type: event.type, userId: event.data.userId },
      'payment webhook received',
    );
    let planForKeycloak: { userId: string; plan: string } | undefined;
    try {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('paymentEvent')
          .values({
            id: newId(),
            provider,
            providerEventId: event.id,
            type: event.type,
            subscriptionId: null,
            payload: JSON.stringify(event),
          })
          .execute();
        if (event.type === 'checkout.completed') planForKeycloak = await this.activate(trx, event);
        else if (event.type === 'subscription.canceled') planForKeycloak = await this.cancelNow(trx, event.data.userId);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_payment_event__provider_event')) {
        this.log.info({ provider, providerEventId: event.id }, 'payment webhook already processed – ignored');
        return { duplicate: true };
      }
      throw err;
    }
    if (planForKeycloak) {
      await this.keycloak.setPlan(planForKeycloak.userId, planForKeycloak.plan);
      this.log.info(planForKeycloak, 'plan set on the login account');
    }
    return { duplicate: false };
  }

  /** Cancel at period end (default) or immediately (test convenience); data is never deleted (FR-SUB-07). */
  async cancel(user: AuthUser, immediate: boolean) {
    const sub = await this.live(this.db, user.id);
    if (!sub) throw ProblemError.notFound('Active subscription');
    this.log.info(
      { userId: user.id, subscriptionId: sub.id, planCode: sub.planCode, immediate },
      'cancellation requested',
    );
    if (immediate) {
      await this.db.transaction().execute((trx) => this.cancelNow(trx, user.id));
      await this.keycloak.setPlan(user.id, 'FREE');
    } else {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('subscription')
          .set({ cancelAtPeriodEnd: true, rowVersion: sub.rowVersion + 1, updatedAt: new Date() })
          .where('id', '=', sub.id)
          .execute();
        await this.emit(trx, EVENT_TYPES.subscriptionChanged, sub);
      });
    }
    return this.mine(user);
  }

  /** Erasure: cancel without contacting Keycloak (the identity is being deleted too). */
  async cancelForErasure(trx: Trx, userId: string): Promise<void> {
    await this.cancelNow(trx, userId);
  }

  private async activate(trx: Trx, event: WebhookEvent) {
    const { checkoutId, userId, planCode } = event.data;
    if (checkoutId) {
      const c = await trx
        .updateTable('checkoutSession')
        .set({ status: 'COMPLETED' })
        .where('id', '=', checkoutId)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();
      if (c.numUpdatedRows === 0n)
        throw ProblemError.conflict('checkout-closed', 'Checkout already completed or canceled');
    }
    const previous = await this.live(trx, userId);
    if (previous)
      await trx
        .updateTable('subscription')
        .set({ status: 'CANCELED', updatedAt: new Date(), rowVersion: previous.rowVersion + 1 })
        .where('id', '=', previous.id)
        .execute();
    const now = new Date();
    const end = new Date(now);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const id = newId();
    await trx
      .insertInto('subscription')
      .values({
        id,
        userId,
        planCode,
        status: 'ACTIVE',
        provider: 'MOCK',
        providerSubId: `mock_${id}`,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        rowVersion: 1,
      })
      .execute();
    await trx.updateTable('paymentEvent').set({ subscriptionId: id }).where('providerEventId', '=', event.id).execute();
    const sub = (await this.live(trx, userId))!;
    await this.emit(trx, previous ? EVENT_TYPES.subscriptionChanged : EVENT_TYPES.subscriptionActivated, sub);
    this.log.info({ userId, planCode }, 'subscription activated');
    return { userId, plan: planCode };
  }

  private async cancelNow(trx: Trx, userId: string) {
    const sub = await this.live(trx, userId);
    if (!sub) return undefined;
    await trx
      .updateTable('subscription')
      .set({
        status: 'CANCELED',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(),
        updatedAt: new Date(),
        rowVersion: sub.rowVersion + 1,
      })
      .where('id', '=', sub.id)
      .execute();
    await this.emit(trx, EVENT_TYPES.subscriptionCanceled, { ...sub, status: 'CANCELED' });
    return { userId, plan: 'FREE' };
  }

  private live(db: Kysely<BillingDatabase> | Trx, userId: string) {
    return db
      .selectFrom('subscription')
      .select([...SUB_COLUMNS])
      .where('userId', '=', userId)
      .where('status', '<>', 'CANCELED')
      .executeTakeFirst();
  }

  private async emit(
    trx: Trx,
    type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
    s: Pick<SubscriptionTable, 'id' | 'userId' | 'planCode' | 'status' | 'currentPeriodEnd'>,
  ) {
    const plan = s.status === 'CANCELED' ? 'FREE' : s.planCode;
    this.log.info(
      {
        event: type,
        userId: s.userId,
        subscriptionId: s.id,
        planCode: s.planCode,
        status: s.status,
        effectivePlan: plan,
      },
      type.replace('.', ' '),
    );
    const p = await trx.selectFrom('plan').select('entitlements').where('code', '=', plan).executeTakeFirstOrThrow();
    await this.outbox.enqueue<SubscriptionPayload>(trx, TOPICS.subscription, {
      type,
      userId: s.userId,
      subject: `subscription/${s.id}`,
      data: {
        userId: s.userId,
        subscriptionId: s.id,
        planCode: plan,
        status: s.status,
        entitlements: p.entitlements,
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      },
    });
  }
}
