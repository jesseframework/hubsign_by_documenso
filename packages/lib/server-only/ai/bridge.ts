/**
 * The WorkHub AI bridge — the ONLY outbound AI call in HubSign.
 *
 * HubSign holds no model key. Every AI call leaves as one request to
 * `POST {WORKHUB_API_URL}/v1/integrations/ai/invoke`, authenticated with a
 * `whk_…` API key carrying the `ai.invoke` scope; WorkHub decrypts the shared
 * provider key server-side and calls OpenAI/Anthropic. The operator rotates one
 * key on the platform and never edits a HubSign deployment.
 *
 * We keep the tool loop. WorkHub runs exactly one turn per call and never
 * dispatches a tool — `chat` takes `messages[]` + `tools[]` and returns
 * `{ content, toolCalls, usage }`, normalised across vendors. So Aubrey's
 * function-calling loop is unchanged; only the transport moved.
 *
 * Metering: HubSign stays the meter of record. WorkHub's platform-side meter is
 * passive — it records after the fact, holds no balance, and never refuses. A
 * platform balance therefore cannot block a HubSign org that has credits.
 *
 * Contract owner: WorkHub platform (api a83cb5d8). See
 * HUBSIGN_WORKHUB_AI_BRIDGE_REQUEST.md for the negotiated answers.
 */
import { env } from '../../utils/env';

/** A tool call, in the bridge's flattened shape (not OpenAI's nested one). */
export type AiToolCall = {
  id: string;
  name: string;
  /** JSON, as a string — parse at the call site so a bad parse is attributable. */
  arguments: string;
};

export type AiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /**
   * On an assistant turn, echoed back from the previous response so the model
   * can see what it asked for. Kept in the same flat shape the bridge returns;
   * `serializeMessage` re-nests it into the wire format on the way out, because
   * the bridge accepts a different shape than it emits.
   */
  tool_calls?: AiToolCall[];
  /** On a tool turn, which call this is the result of. */
  tool_call_id?: string;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
};

export type AiToolChoice = 'auto' | 'required' | 'none' | { name: string };

export type AiVendor = 'openai' | 'anthropic' | 'azure_openai' | 'ollama';

export type AiChatRequest = {
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  toolChoice?: AiToolChoice;
  /** Per-call model pin. Omit to run whatever shared provider WorkHub has active. */
  model?: string;
  /** Per-call vendor pin. Omit to run the active shared provider. */
  vendor?: AiVendor;
  maxTokens?: number;
  temperature?: number;
  /**
   * The organization's `ai.invoke` key, from `resolveAiApiKey`. Falls back to
   * `WORKHUB_AI_API_KEY` when absent, which only covers accounts with no org.
   */
  apiKey?: string | null;
  /** Abort the call after this long. WorkHub enforces no cap of its own. */
  timeoutMs?: number;
};

export type AiChatResponse = {
  content: string | null;
  toolCalls: AiToolCall[];
  usage: { input: number; output: number };
  model: string | null;
  vendor: string | null;
};

/**
 * Machine-readable failure codes, as published by WorkHub. `unreachable` and
 * `timeout` are ours — the request never got an answer to carry a code.
 */
export type AiBridgeErrorCode =
  | 'not_configured'
  | 'invalid_input'
  | 'invalid_api_key'
  | 'forbidden'
  | 'rate_limited'
  | 'ai_not_configured'
  | 'upstream_ai_unavailable'
  | 'ai_invoke_failed'
  | 'bad_response'
  | 'unreachable'
  | 'timeout';

/**
 * A bridge failure, carrying both a message safe to show a user and the
 * upstream detail for the log.
 *
 * The split matters. The vendor's own wording is written for whoever owns the
 * provider account, and passed through verbatim it once told a user who had
 * just bought 500 HubSign credits that they had "no credits remaining" and
 * pointed them at a third-party billing page. `userMessage` never repeats
 * provider text; `detail` goes to the log.
 */
export class AiBridgeError extends Error {
  constructor(
    /** Safe to show the person at the keyboard. */
    readonly userMessage: string,
    readonly code: AiBridgeErrorCode,
    readonly status: number,
    /** Upstream text. Log it; never render it. */
    readonly detail: string,
  ) {
    super(userMessage);
    this.name = 'AiBridgeError';
  }

  /** Worth trying again unchanged; anything else will fail identically. */
  get isRetryable(): boolean {
    return this.code === 'ai_invoke_failed' || this.code === 'rate_limited';
  }

  /**
   * A configuration or capacity problem an administrator must fix — as opposed
   * to something the user did. Drives whether the UI offers "try again".
   */
  get isOperatorFault(): boolean {
    return (
      this.code === 'not_configured' ||
      this.code === 'invalid_api_key' ||
      this.code === 'forbidden' ||
      this.code === 'ai_not_configured' ||
      this.code === 'upstream_ai_unavailable'
    );
  }
}

/**
 * What to tell the person at the keyboard, per WorkHub's published code table.
 *
 * `upstream_ai_unavailable` is the one that earns its own sentence: it means the
 * WorkHub platform's vendor account is dry, which has nothing to do with the
 * organization's HubSign credit pool. Saying "you're out of credits" there is
 * exactly the confusion this whole migration was meant to end.
 */
export function userMessageForBridgeError(code: AiBridgeErrorCode, status: number): string {
  switch (code) {
    case 'upstream_ai_unavailable':
      return 'AI is unavailable because the platform AI account needs topping up. This is separate from your organization\'s credit pool, which has not been touched — an administrator needs to contact the platform operator.';
    case 'ai_not_configured':
    case 'not_configured':
      return 'AI is not configured for this deployment yet — an administrator needs to finish setting it up.';
    case 'invalid_api_key':
    case 'forbidden':
      // Deliberately vague about *which* credential. The person reading this is
      // in a chat window, not an ops console; naming the integration leaks
      // architecture at them without making the message any more actionable.
      // The specific cause is in the log, where the administrator will look.
      return 'AI is not configured correctly — an administrator needs to check the AI service credentials.';
    case 'rate_limited':
      return 'AI is busy right now. Wait a moment and try again.';
    case 'timeout':
      return 'The AI service took too long to respond. Try again.';
    case 'unreachable':
      return 'Could not reach the AI service. Try again shortly.';
    case 'ai_invoke_failed':
      return 'The AI service had a problem with that request. Try again shortly.';
    case 'invalid_input':
    case 'bad_response':
    default:
      return `AI could not complete that request${status ? ` (${status})` : ''}. An administrator can check the server log for details.`;
  }
}

/**
 * The platform base. Prefers a dedicated var, then the generic one, and finally
 * the license API base — it is the same WorkHub api root, already configured on
 * every deployment that redeems keys, so the common case needs no new config.
 */
function baseUrl(): string {
  const url = (
    env('WORKHUB_AI_API_URL') ??
    env('WORKHUB_API_URL') ??
    env('WORKHUB_LICENSE_API_URL') ??
    ''
  )
    .trim()
    .replace(/\/$/, '');

  if (!url) {
    throw new AiBridgeError(
      userMessageForBridgeError('not_configured', 0),
      'not_configured',
      500,
      'WORKHUB_AI_API_URL / WORKHUB_API_URL is not set on this HubSign deployment',
    );
  }

  return url;
}

/**
 * The credential, resolved by the caller.
 *
 * Callers pass the organization's key (see `./resolve-ai-key`); the environment
 * variable is only a fallback for accounts with no organization. Configuration
 * happens on the AI Credits screen, not here.
 */
function resolveKey(requestKey: string | null | undefined): string {
  const key = (requestKey ?? '').trim() || (env('WORKHUB_AI_API_KEY') ?? '').trim();

  if (!key) {
    throw new AiBridgeError(
      userMessageForBridgeError('not_configured', 0),
      'not_configured',
      500,
      'no WorkHub AI key for this organization (set one on the AI Credits screen)',
    );
  }

  return key;
}

/**
 * Whether the platform endpoint is known. Says nothing about credentials — the
 * key is per-organization and lives in the database, so use
 * `isAiConfiguredForOrg` from `./resolve-ai-key` for the real answer.
 */
export const isAiBridgeBaseConfigured = (): boolean =>
  Boolean(
    (env('WORKHUB_AI_API_URL') ?? env('WORKHUB_API_URL') ?? env('WORKHUB_LICENSE_API_URL'))?.trim(),
  );

const DEFAULT_TIMEOUT_MS = 90_000;

/** Codes WorkHub returns that we recognise; anything else falls back by status. */
const KNOWN_CODES = new Set<string>([
  'invalid_input',
  'invalid_api_key',
  'forbidden',
  'rate_limited',
  'ai_not_configured',
  'upstream_ai_unavailable',
  'ai_invoke_failed',
]);

function codeFromResponse(body: Record<string, unknown>, status: number): AiBridgeErrorCode {
  const raw = typeof body.error === 'string' ? body.error : '';
  if (KNOWN_CODES.has(raw)) return raw as AiBridgeErrorCode;

  // No recognised code — infer from the status so the user still gets sensible
  // wording rather than the generic fallback.
  if (status === 401) return 'invalid_api_key';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_input';
  if (status >= 500) return 'ai_invoke_failed';
  return 'bad_response';
}

/**
 * Put a message on the wire.
 *
 * The bridge's contract is asymmetric, verified against the live endpoint: it
 * RETURNS tool calls flat (`{id, name, arguments}`) but only ACCEPTS them back
 * in OpenAI's nested form. Echoing back what it gave us earns a
 * `400 invalid_tool_call`, which shows up as "the first question works and every
 * follow-up that needs a tool fails".
 *
 * Translating here rather than at the call sites is the whole point of having a
 * bridge: callers keep one flat shape and never learn a vendor's wire format.
 */
export function serializeMessage(message: AiMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };

  if (message.tool_call_id) {
    wire.tool_call_id = message.tool_call_id;
  }

  if (message.tool_calls?.length) {
    wire.tool_calls = message.tool_calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }

  return wire;
}

/**
 * Drop assistant turns that carry neither text nor tool calls.
 *
 * A model can return an empty turn; pushing that into the history and replaying
 * it makes the next request fail upstream (observed as a 502 from the edge
 * rather than a clean error). It carries no information either way.
 */
export function usableMessages(messages: AiMessage[]): AiMessage[] {
  return messages.filter(
    (message) =>
      message.role !== 'assistant' ||
      (message.content ?? '') !== '' ||
      Boolean(message.tool_calls?.length),
  );
}

/** One HTTP round trip. No retry — `callAiBridge` owns that policy. */
async function invokeOnce(request: AiChatRequest): Promise<AiChatResponse> {
  const url = `${baseUrl()}/v1/integrations/ai/invoke`;
  const key = resolveKey(request.apiKey);

  const input: Record<string, unknown> = {
    messages: usableMessages(request.messages).map(serializeMessage),
  };

  // Only send what was asked for: an empty `tools: []` is not the same as no
  // tools to every vendor, and an unpinned model must stay unpinned so WorkHub
  // can route to its active shared provider.
  if (request.tools?.length) input.tools = request.tools;
  if (request.toolChoice !== undefined) input.toolChoice = request.toolChoice;
  if (request.model) input.model = request.model;
  if (request.vendor) input.vendor = request.vendor;
  if (request.maxTokens !== undefined) input.maxTokens = request.maxTokens;
  if (request.temperature !== undefined) input.temperature = request.temperature;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify({ operation: 'chat', input }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    const code: AiBridgeErrorCode = aborted ? 'timeout' : 'unreachable';
    throw new AiBridgeError(
      userMessageForBridgeError(code, 0),
      code,
      504,
      aborted ? `aborted after ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : (err as Error).message,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new AiBridgeError(
      userMessageForBridgeError('bad_response', response.status),
      'bad_response',
      502,
      `WorkHub returned non-JSON (HTTP ${response.status}): ${text.slice(0, 500)}`,
    );
  }

  if (!response.ok || body.ok !== true) {
    const code = codeFromResponse(body, response.status);
    const detail =
      (typeof body.detail === 'string' && body.detail) ||
      (typeof body.error === 'string' && body.error) ||
      `HTTP ${response.status}`;

    // The upstream text is written for whoever owns the provider account, not
    // for the person typing. Logged here, mapped for the user.
    console.error(`[ai-bridge] invoke failed (${response.status} ${code}):`, detail);

    throw new AiBridgeError(
      userMessageForBridgeError(code, response.status),
      code,
      response.status,
      detail,
    );
  }

  const data = (body.data ?? {}) as {
    content?: unknown;
    toolCalls?: unknown;
    usage?: { input?: unknown; output?: unknown };
    model?: unknown;
    vendor?: unknown;
  };

  const toolCalls: AiToolCall[] = Array.isArray(data.toolCalls)
    ? data.toolCalls
        .map((call): AiToolCall | null => {
          const record = call as Record<string, unknown>;
          const id = typeof record.id === 'string' ? record.id : '';
          const name = typeof record.name === 'string' ? record.name : '';
          if (!id || !name) return null;
          return {
            id,
            name,
            arguments: typeof record.arguments === 'string' ? record.arguments : '{}',
          };
        })
        .filter((call): call is AiToolCall => call !== null)
    : [];

  return {
    content: typeof data.content === 'string' ? data.content : null,
    toolCalls,
    usage: {
      input: typeof data.usage?.input === 'number' ? data.usage.input : 0,
      output: typeof data.usage?.output === 'number' ? data.usage.output : 0,
    },
    model: typeof data.model === 'string' ? data.model : null,
    vendor: typeof data.vendor === 'string' ? data.vendor : null,
  };
}

/**
 * Run one AI turn through WorkHub.
 *
 * Retries once on the two codes WorkHub documents as transient
 * (`ai_invoke_failed`, `rate_limited`). Deliberately only once: Aubrey chains up
 * to seven of these in a single user turn, so a generous retry budget here
 * multiplies into a wait long enough that the user assumes the app has hung.
 */
export async function callAiBridge(request: AiChatRequest): Promise<AiChatResponse> {
  try {
    return await invokeOnce(request);
  } catch (err) {
    if (err instanceof AiBridgeError && err.isRetryable) {
      await new Promise((resolve) => setTimeout(resolve, err.code === 'rate_limited' ? 1500 : 400));
      return invokeOnce(request);
    }
    throw err;
  }
}
