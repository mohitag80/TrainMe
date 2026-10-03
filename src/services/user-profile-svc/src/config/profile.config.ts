import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const profileConfigSchema = platformConfigSchema.extend({});

export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export const loadProfileConfig = (): ProfileConfig => loadConfig(profileConfigSchema);
