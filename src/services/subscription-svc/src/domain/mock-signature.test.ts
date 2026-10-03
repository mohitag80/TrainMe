import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './mock-signature.js';

describe('mock webhook signature', () => {
  it('accepts a valid signature and rejects tampering, wrong secrets and old timestamps', () => {
    const body = '{"type":"checkout.completed"}';
    const header = signWebhook('s3cret-s3cret-s3cret', body);
    expect(verifyWebhook('s3cret-s3cret-s3cret', body, header)).toBe(true);
    expect(verifyWebhook('s3cret-s3cret-s3cret', body + ' ', header)).toBe(false);
    expect(verifyWebhook('other-secret-other', body, header)).toBe(false);
    const old = signWebhook('s3cret-s3cret-s3cret', body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhook('s3cret-s3cret-s3cret', body, old)).toBe(false);
  });
});
