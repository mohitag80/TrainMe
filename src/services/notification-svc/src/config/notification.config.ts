import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const notificationConfigSchema = platformConfigSchema.extend({
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  RUN_CONSUMERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

export const loadNotificationConfig = (): NotificationConfig => loadConfig(notificationConfigSchema);
