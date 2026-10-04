import type { ColumnType } from 'kysely';
import type { OutboxEventTable, ProcessedEventTable } from '@trainme/kafka';

type Json<T> = ColumnType<T, string, string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
export type Provider = 'MOCK' | 'STRIPE' | 'RAZORPAY' | 'APPLE' | 'GOOGLE';

export interface PlanTable {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingInterval: 'MONTH' | 'YEAR' | 'NONE';
  trialDays: number;
  entitlements: Json<Record<string, unknown>>;
  isActive: boolean;
  sortOrder: number;
}

export interface SubscriptionTable {
  id: string;
  userId: string;
  planCode: string;
  status: SubscriptionStatus;
  provider: Provider;
  providerSubId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  rowVersion: number;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: Defaulted<Date>;
}

export interface CheckoutSessionTable {
  id: string;
  userId: string;
  planCode: string;
  provider: Provider;
  status: 'OPEN' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
  createdAt: ColumnType<Date, never, never>;
  expiresAt: Date;
}

export interface PaymentEventTable {
  id: string;
  provider: Provider;
  providerEventId: string;
  type: string;
  subscriptionId: string | null;
  payload: Json<Record<string, unknown>>;
  receivedAt: ColumnType<Date, never, never>;
}

export interface BillingDatabase {
  plan: PlanTable;
  subscription: SubscriptionTable;
  checkoutSession: CheckoutSessionTable;
  paymentEvent: PaymentEventTable;
  outboxEvent: OutboxEventTable;
  processedEvent: ProcessedEventTable;
}
