import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { ProblemError } from '@trainme/errors';
import { CurrentUser, Public, SERVICE_CONFIG, ZodPipe } from '@trainme/service-kit';
import { SubscriptionService, type WebhookEvent } from '../application/subscription.service.js';
import type { SubscriptionConfig } from '../config/subscription.config.js';
import { verifyWebhook } from '../domain/mock-signature.js';
import { renderMockCheckout } from './mock-checkout.page.js';

const checkoutBody = z.object({ planCode: z.string().min(2).max(16) });
const cancelQuery = z.object({
  immediate: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
const idParam = new ZodPipe(z.uuid(), '/path/id');
const outcomeBody = z.object({ outcome: z.enum(['pay', 'cancel']) });
const webhookBody = z.object({
  id: z.string().min(5).max(120),
  type: z.enum(['checkout.completed', 'subscription.canceled']),
  data: z.object({
    checkoutId: z.uuid().optional(),
    subscriptionId: z.uuid().optional(),
    userId: z.uuid(),
    planCode: z.string().max(16),
  }),
});

/** Plans, subscriptions and payment webhooks (LLD §4.2). */
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    @Inject(SERVICE_CONFIG) private readonly config: SubscriptionConfig,
  ) {}

  @Public()
  @Get('plans')
  async plans() {
    return { items: await this.subscriptions.plans() };
  }

  @Get('subscriptions/me')
  mine(@CurrentUser() user: AuthUser) {
    return this.subscriptions.mine(user);
  }

  @Get('subscriptions/me/payments')
  async payments(@CurrentUser() user: AuthUser) {
    return { items: await this.subscriptions.payments(user) };
  }

  @Post('subscriptions/checkout')
  checkout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(checkoutBody, '/body')) body: z.infer<typeof checkoutBody>,
  ) {
    return this.subscriptions.checkout(user, body.planCode);
  }

  @Post('subscriptions/me/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Query(new ZodPipe(cancelQuery, '/query')) q: z.infer<typeof cancelQuery>) {
    return this.subscriptions.cancel(user, q.immediate);
  }

  /** Signed provider webhooks (no JWT). Unsigned or stale requests are rejected with 401. */
  @Public()
  @Post('webhooks/payments/mock')
  @HttpCode(200)
  async webhook(@Body() body: unknown, @Headers('x-mock-signature') signature: string | undefined) {
    if (!verifyWebhook(this.config.MOCK_PAYMENT_WEBHOOK_SECRET, JSON.stringify(body), signature))
      throw new ProblemError(401, 'invalid-signature', 'Unauthorized', 'Webhook signature is invalid or too old');
    const event = webhookBody.parse(body) as WebhookEvent;
    return this.subscriptions.handleWebhook('MOCK', event);
  }

  // ---------------------------------------------------------------- MOCK provider hosted page (test only)

  @Public()
  @Get('mock-payments/checkout/:id')
  async mockPage(@Param('id', idParam) id: string, @Res() res: FastifyReply) {
    const c = await this.subscriptions.checkoutSession(id);
    void res.header('content-type', 'text/html; charset=utf-8').send(renderMockCheckout(c));
  }

  @Public()
  @Post('mock-payments/checkout/:id')
  @HttpCode(200)
  mockComplete(
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(outcomeBody, '/body')) body: z.infer<typeof outcomeBody>,
  ) {
    return this.subscriptions.completeMockCheckout(id, body.outcome);
  }
}
