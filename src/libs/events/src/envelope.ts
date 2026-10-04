/** CloudEvents 1.0 JSON envelope used on every topic (LLD §5). */
export interface CloudEvent<T = unknown> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  datacontenttype: 'application/json';
  traceparent?: string;
  /** Owner of the data; also the Kafka message key, so one user's events stay ordered. */
  userid: string;
  data: T;
}

export const TOPICS = {
  user: 'user.events',
  subscription: 'subscription.events',
  catalog: 'catalog.events',
  tracker: 'tracker.events',
  record: 'record.events',
  analytics: 'analytics.events',
  notificationCommands: 'notification.commands',
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const dlqTopic = (topic: string) => `${topic}.dlq`;

export const EVENT_TYPES = {
  userRegistered: 'user.registered',
  userUpdated: 'user.updated',
  userDeleted: 'user.deleted',
  subscriptionActivated: 'subscription.activated',
  subscriptionChanged: 'subscription.changed',
  subscriptionCanceled: 'subscription.canceled',
  subscriptionPastDue: 'subscription.past_due',
  templatePublished: 'catalog.template.published',
  templateRetired: 'catalog.template.retired',
  trackerCreated: 'tracker.created',
  trackerUpdated: 'tracker.updated',
  trackerSchemaChanged: 'tracker.schema.changed',
  trackerArchived: 'tracker.archived',
  trackerDeleted: 'tracker.deleted',
  sessionStarted: 'record.session.started',
  sessionCompleted: 'record.session.completed',
  sessionUpdated: 'record.session.updated',
  sessionDeleted: 'record.session.deleted',
  sessionDiscarded: 'record.session.discarded',
  sessionReopened: 'record.session.reopened',
  prAchieved: 'analytics.pr.achieved',
  streakAtRisk: 'analytics.streak.at_risk',
  notificationSend: 'notification.send',
} as const;
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
