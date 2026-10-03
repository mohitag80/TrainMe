import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stripe-style signature header for the MOCK provider: `t=<unix>,v1=<hex hmac(t.body)>`. */
export function signWebhook(secret: string, body: string, now = Math.floor(Date.now() / 1000)): string {
  return `t=${now},v1=${createHmac('sha256', secret).update(`${now}.${body}`).digest('hex')}`;
}

/** Verifies the signature against the raw body with a 5-minute tolerance (LLD §8). */
export function verifyWebhook(secret: string, body: string, header: string | undefined, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
