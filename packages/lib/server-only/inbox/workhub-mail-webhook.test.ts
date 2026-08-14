import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySvixSignature } from './workhub-mail-webhook';

/**
 * This is the whole security boundary for inbound mail notifications: anyone on
 * the internet can POST to the endpoint, and only a valid signature separates a
 * real delivery from a forged one. Implemented by hand rather than via the
 * `svix` package, so it needs to earn that.
 */

const SECRET = `whsec_${Buffer.from('a-test-signing-key-32-bytes-long').toString('base64')}`;
const ID = 'msg_2abc';
const BODY = JSON.stringify({ event: 'email.mail-received', mailboxId: 'mb_1' });

/** Sign exactly the way Svix does, so a passing case proves interoperability. */
const sign = (body: string, timestamp: string, secret = SECRET, id = ID) =>
  `v1,${createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`;

const nowSeconds = 1_800_000_000;
const now = nowSeconds * 1000;
const timestamp = String(nowSeconds);

const verify = (overrides: Partial<Parameters<typeof verifySvixSignature>[0]> = {}) =>
  verifySvixSignature({
    secret: SECRET,
    id: ID,
    timestamp,
    signatureHeader: sign(BODY, timestamp),
    body: BODY,
    now,
    ...overrides,
  });

describe('verifySvixSignature', () => {
  it('accepts a correctly signed delivery', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('accepts when the header carries several versions, as during a rotation', () => {
    const header = `v1,not-the-right-one ${sign(BODY, timestamp)}`;

    expect(verify({ signatureHeader: header })).toEqual({ ok: true });
  });

  it('rejects a body altered after signing', () => {
    // The attack this exists to stop: a valid signature replayed over a
    // different mailboxId to make us poll someone else's inbox.
    const tampered = JSON.stringify({ event: 'email.mail-received', mailboxId: 'mb_victim' });

    expect(verify({ body: tampered })).toMatchObject({ ok: false });
  });

  it('rejects a signature made with a different secret', () => {
    const other = `whsec_${Buffer.from('a-different-key-of-32-bytes-len!').toString('base64')}`;

    expect(verify({ signatureHeader: sign(BODY, timestamp, other) })).toMatchObject({
      ok: false,
      reason: 'signature mismatch',
    });
  });

  it('rejects a signature bound to a different message id', () => {
    expect(verify({ signatureHeader: sign(BODY, timestamp, SECRET, 'msg_other') })).toMatchObject({
      ok: false,
    });
  });

  it('rejects a stale delivery, so a captured one cannot be replayed later', () => {
    const old = String(nowSeconds - 6 * 60);

    expect(verify({ timestamp: old, signatureHeader: sign(BODY, old) })).toMatchObject({
      ok: false,
    });
  });

  it('rejects a delivery timestamped too far in the future', () => {
    const ahead = String(nowSeconds + 6 * 60);

    expect(verify({ timestamp: ahead, signatureHeader: sign(BODY, ahead) })).toMatchObject({
      ok: false,
    });
  });

  it('accepts a delivery inside the tolerance window', () => {
    const recent = String(nowSeconds - 4 * 60);

    expect(verify({ timestamp: recent, signatureHeader: sign(BODY, recent) })).toEqual({ ok: true });
  });

  it('refuses everything when no secret is configured', () => {
    // Registration without copying the secret out of the portal leaves this
    // empty. It must fail closed, never open.
    expect(verify({ secret: '' })).toMatchObject({ ok: false });
  });

  it.each([
    ['id', { id: null }],
    ['timestamp', { timestamp: null }],
    ['signature', { signatureHeader: null }],
  ])('refuses a delivery with no %s header', (_label, override) => {
    expect(verify(override)).toMatchObject({ ok: false, reason: 'missing svix headers' });
  });

  it('refuses a header with no v1 entry', () => {
    expect(verify({ signatureHeader: 'v0,something' })).toMatchObject({
      ok: false,
      reason: 'no v1 signature present',
    });
  });

  it('refuses an unparseable timestamp rather than treating it as zero', () => {
    expect(verify({ timestamp: 'not-a-number' })).toMatchObject({
      ok: false,
      reason: 'unparseable timestamp',
    });
  });
});
