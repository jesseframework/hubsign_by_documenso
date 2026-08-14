import { describe, expect, it } from 'vitest';

import {
  type AiBridgeErrorCode,
  AiBridgeError,
  serializeMessage,
  usableMessages,
  userMessageForBridgeError,
} from './bridge';

/**
 * No AI failure may reach a user in the vendor's own words.
 *
 * The wording is written for whoever owns the provider account, and its word
 * "credits" means the vendor billing balance — not the organization's HubSign
 * pool, which is what a user reading it will assume. This was a live bug: a user
 * who had just bought 500 HubSign credits was told they had none and pointed at
 * a third-party billing page.
 *
 * Now that all three AI call sites go through the bridge, this is the one place
 * that mapping has to hold.
 */
describe('userMessageForBridgeError', () => {
  const forbidden = ['openai', 'anthropic', 'workhub', 'platform.', 'http://', 'https://', 'whk_', 'x-api-key'];

  const assertSafe = (message: string) => {
    for (const needle of forbidden) {
      expect(message.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    expect(message.length).toBeGreaterThan(20);
  };

  it('distinguishes a dry platform AI account from the org credit pool', () => {
    const message = userMessageForBridgeError('upstream_ai_unavailable', 503);

    assertSafe(message);
    // The exact confusion this exists to prevent: a full pool reading empty.
    expect(message).toMatch(/credit pool/i);
    expect(message).toMatch(/not been touched/i);
    expect(message).toMatch(/administrator/i);
  });

  it('treats rate limiting as busy, never as being out of credit', () => {
    const message = userMessageForBridgeError('rate_limited', 429);

    assertSafe(message);
    expect(message).toMatch(/busy|try again/i);
    expect(message).not.toMatch(/credit/i);
  });

  it.each<AiBridgeErrorCode>(['invalid_api_key', 'forbidden'])(
    'points %s at configuration, not at the user',
    (code) => {
      const message = userMessageForBridgeError(code, 401);

      assertSafe(message);
      expect(message).toMatch(/administrator/i);
      expect(message).not.toMatch(/credit/i);
    },
  );

  it.each<AiBridgeErrorCode>(['not_configured', 'ai_not_configured'])(
    'tells the user %s is a setup gap, not their fault',
    (code) => {
      const message = userMessageForBridgeError(code, 503);

      assertSafe(message);
      expect(message).toMatch(/not configured|set(ting)? (it )?up/i);
    },
  );

  it.each<AiBridgeErrorCode>(['ai_invoke_failed', 'unreachable', 'timeout'])(
    'invites a retry for the transient case %s',
    (code) => {
      const message = userMessageForBridgeError(code, 502);

      assertSafe(message);
      expect(message).toMatch(/try again/i);
    },
  );

  it('falls back to something actionable for an unrecognised code', () => {
    const message = userMessageForBridgeError('bad_response', 418);

    assertSafe(message);
    expect(message).toMatch(/server log/i);
  });
});

describe('AiBridgeError', () => {
  const upstream =
    'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.';

  it('keeps the upstream text in `detail`, out of the user-facing message', () => {
    const error = new AiBridgeError(
      userMessageForBridgeError('upstream_ai_unavailable', 503),
      'upstream_ai_unavailable',
      503,
      upstream,
    );

    expect(error.message).not.toContain('openai.com');
    expect(error.userMessage).not.toContain('openai.com');
    expect(error.detail).toBe(upstream);
  });

  it('marks only the transient codes retryable', () => {
    const retryable = (code: AiBridgeErrorCode) =>
      new AiBridgeError('x', code, 500, 'd').isRetryable;

    expect(retryable('ai_invoke_failed')).toBe(true);
    expect(retryable('rate_limited')).toBe(true);

    // Retrying these burns latency to fail identically.
    expect(retryable('invalid_api_key')).toBe(false);
    expect(retryable('forbidden')).toBe(false);
    expect(retryable('invalid_input')).toBe(false);
    expect(retryable('upstream_ai_unavailable')).toBe(false);
  });

  it('flags the codes an administrator has to fix', () => {
    const operator = (code: AiBridgeErrorCode) =>
      new AiBridgeError('x', code, 500, 'd').isOperatorFault;

    expect(operator('upstream_ai_unavailable')).toBe(true);
    expect(operator('invalid_api_key')).toBe(true);
    expect(operator('forbidden')).toBe(true);
    expect(operator('ai_not_configured')).toBe(true);
    expect(operator('not_configured')).toBe(true);

    // A user can just try these again; no admin action would help.
    expect(operator('rate_limited')).toBe(false);
    expect(operator('ai_invoke_failed')).toBe(false);
  });
});

/**
 * The bridge's contract is asymmetric, and this is the regression guard.
 *
 * It RETURNS tool calls flat (`{id, name, arguments}`) but only ACCEPTS them
 * back nested in OpenAI's wire format. Echoing back what it handed us earns a
 * `400 invalid_tool_call` — which presents as "the first question works, and
 * every follow-up needing a tool fails". Verified against the live endpoint.
 */
describe('serializeMessage', () => {
  it('re-nests tool calls into the shape the bridge accepts', () => {
    const wire = serializeMessage({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', name: 'get_overview', arguments: '{}' }],
    });

    expect(wire.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_overview', arguments: '{}' } },
    ]);

    // The flat shape is what earns the 400: `name` and `arguments` must live
    // under `function`, never on the tool call itself.
    const [call] = wire.tool_calls as Array<Record<string, unknown>>;
    expect('name' in call).toBe(false);
    expect('arguments' in call).toBe(false);
  });

  it('carries tool_call_id on a tool result and adds no tool_calls key', () => {
    const wire = serializeMessage({ role: 'tool', content: '{"documents":47}', tool_call_id: 'call_1' });

    expect(wire.tool_call_id).toBe('call_1');
    expect('tool_calls' in wire).toBe(false);
  });

  it('leaves an ordinary message alone', () => {
    expect(serializeMessage({ role: 'user', content: 'hi' })).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('usableMessages', () => {
  it('drops an assistant turn carrying neither text nor tool calls', () => {
    // Replaying one of these made the next request fail upstream, and it holds
    // no information to begin with.
    const kept = usableMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'again' },
    ]);

    expect(kept.map((m) => m.content)).toEqual(['hi', 'again']);
  });

  it('keeps an assistant turn that is only tool calls', () => {
    const kept = usableMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 'x', arguments: '{}' }] },
    ]);

    expect(kept).toHaveLength(1);
  });

  it('never drops a user, system or tool message, even when empty', () => {
    const kept = usableMessages([
      { role: 'system', content: '' },
      { role: 'user', content: '' },
      { role: 'tool', content: '', tool_call_id: 'c1' },
    ]);

    expect(kept).toHaveLength(3);
  });
});
