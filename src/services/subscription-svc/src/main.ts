import 'reflect-metadata';
import { bootstrapService } from '@trainme/service-kit';
import { AppModule } from './app.module.js';
import { loadSubscriptionConfig } from './config/subscription.config.js';

const config = loadSubscriptionConfig();
await bootstrapService(AppModule.register(config), {
  name: config.SERVICE_NAME,
  port: config.PORT,
  logLevel: config.LOG_LEVEL,
  auth: { issuer: config.OIDC_ISSUER_URL, jwksUrl: config.OIDC_JWKS_URL, audience: config.OIDC_AUDIENCE },
});
