/**
 * AI workflow generator — turn a natural-language prompt into a valid workflow
 * definition so end users don't hand-write JSON.
 *
 * Provider-flexible: prefers OpenAI/GPT-4 (`NEXT_PRIVATE_OPENAI_API_KEY`, model
 * `NEXT_PRIVATE_OPENAI_MODEL`, default gpt-4o) and falls back to Anthropic/Claude
 * (`NEXT_PRIVATE_ANTHROPIC_API_KEY`) if OpenAI errors (e.g. out of quota). Force
 * a single provider with `NEXT_PRIVATE_WORKFLOW_AI_PROVIDER` = openai | anthropic.
 *
 * Structured output is enforced via a forced tool/function call; the result is
 * validated against `ZWorkflowDefinitionSchema` and retried once with the
 * validation errors fed back.
 */

import { AppError, AppErrorCode } from '../../errors/app-error';
import type { TWorkflowDefinition } from '../../types/workflow';
import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_EVENTS,
  ZWorkflowDefinitionSchema,
} from '../../types/workflow';
import { env } from '../../utils/env';

export const isWorkflowAiConfigured = (): boolean =>
  Boolean(env('NEXT_PRIVATE_OPENAI_API_KEY') || env('NEXT_PRIVATE_ANTHROPIC_API_KEY'));

const OPENAI_MODEL = env('NEXT_PRIVATE_OPENAI_MODEL') || 'gpt-4o';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

const eventLines = WORKFLOW_EVENTS.map((e) => `  - ${e.key} (${e.group}): ${e.label}`).join('\n');

const SYSTEM_PROMPT = `You are a workflow builder for HubSign (an e-signature + document app). You convert a plain-English request into ONE valid workflow definition and return it by calling the build_workflow tool/function. Output nothing else.

A workflow definition is JSON:
{
  "version": 1,
  "trigger": <trigger>,
  "startStepId": "<first step id>",
  "steps": { "<id>": <step>, ... }
}

TRIGGERS (pick one):
- { "type": "EVENT", "event": "<EVENT_KEY>", "condition"?: <jsonlogic> }
- { "type": "SCHEDULE", "cron": "<5-field cron>", "timezone"?: "UTC", "condition"?: <jsonlogic> }
- { "type": "MANUAL", "condition"?: <jsonlogic> }

EVENT KEYS:
${eventLines}

STEP TYPES (each step has "id", "type", optional "name", optional "onError"):
- ACTION:       { "type":"ACTION", "config": <action>, "next"?: "<id>" }
- CONDITION:    { "type":"CONDITION", "config": { "rule": <jsonlogic> }, "next": "<id if true>", "else"?: "<id if false>" }
- BRANCH:       { "type":"BRANCH", "config": { "branches": [ { "when": <jsonlogic>, "next": "<id>" } ] }, "else"?: "<id>" }
- DELAY:        { "type":"DELAY", "config": { "seconds"?:n, "minutes"?:n, "hours"?:n, "days"?:n }, "next"?: "<id>" }
- SET_VARIABLE: { "type":"SET_VARIABLE", "config": { "assignments": { "name": <jsonlogic> } }, "next"?: "<id>" }

ACTIONS (the "config" of an ACTION step; allowed action values: ${WORKFLOW_ACTION_TYPES.join(', ')}):
- SEND_EMAIL:          { "action":"SEND_EMAIL", "to": "a@b.com" | ["x","y"], "subject": "...", "html": "...", "text"?: "..." }
- HTTP_REQUEST:        { "action":"HTTP_REQUEST", "method"?: "POST", "url": "https://...", "headers"?: {...}, "body"?: {...}|"...", "timeoutMs"?: n, "saveResponseAs"?: "var" }
- NOTIFY:              { "action":"NOTIFY", "userId": "OWNER" | "<id>", "title": "...", "message": "..." }
- SEND_FOR_SIGNATURE:  { "action":"SEND_FOR_SIGNATURE", "documentId"?: "<defaults to the event's document>", "recipients": [ { "email": "a@b.com", "name"?: "...", "role"?: "SIGNER" } ] }
  (roles: SIGNER, APPROVER, CC, VIEWER. Use this to send a document out for signing.)
- LOOKUP_METADATA:      { "action":"LOOKUP_METADATA", "category":"vendor", "key":"{{payload.extractedData.vendor_name}}", "saveAs":"vendor" }
  (Looks up an org metadata record and stores the match in a run variable. Two modes:
   • EXACT: pass "key" (a template) to match a record's name, e.g. the vendor name.
   • KEYWORD: OMIT "key" to match records by their keywords against the invoice's OCR fields — best for "trigger a sign request by keyword", e.g. { "action":"LOOKUP_METADATA", "category":"signee", "saveAs":"signer" } finds the signee whose keyword appears anywhere in the OCR data. Optionally pass "keywordText" to scan specific text.
   After it runs, later steps read {{vars.<saveAs>.found}}, {{vars.<saveAs>.email}}, {{vars.<saveAs>.contactName}}, {{vars.<saveAs>.role}}, {{vars.<saveAs>.matchedKeyword}}. Typical flow: LOOKUP_METADATA(signee, keyword) → CONDITION on {{vars.signer.found}} → SEND_FOR_SIGNATURE to {{vars.signer.email}}. Chain steps with "next".)

JSONLOGIC (for conditions/branches/assignments) — examples:
  { "==": [ { "var": "PATH" }, "value" ] }              equals
  { "!=": [...] }  { ">": [...] }  { ">=": [...] }       comparisons
  { "and": [ <rule>, <rule> ] }   { "or": [...] }  { "!": <rule> }
  { "in": [ "needle", { "var": "PATH" } ] }              substring/array contains (null-safe)
Reference values with { "var": "dotted.path" }.

VARIABLE PATHS available to conditions and {{templates}} (root has: event, trigger, payload, document(=payload alias), organization, now, vars):
- Inbox events (INBOX_EMAIL_RECEIVED, INBOX_OCR_COMPLETED):
    payload.ocrProcessed (bool), payload.documentType (e.g. "invoice"), payload.ocrConfidence (a 0..1 FLOAT, e.g. 0.85 — NEVER compare it to 80; use >= 0.8 for "80%"), payload.needsReview, payload.sender
    payload.extractedData.<field>   e.g. vendor_name, vendor_email, invoice_number, total_amount, subtotal, currency, invoice_date, due_date, po_number (fields vary by what OCR extracted)
    payload.document.id, payload.document.title, payload.document.status, payload.document.userId
- eSign document events (DOCUMENT_*): document.id, document.title, document.status (and other document fields)
Templates in action config strings use {{ path }}, e.g. "Document {{payload.document.title}} is ready".

RULES:
- Produce the MINIMUM steps needed. A single ACTION step is fine; set its "next" to null or omit it to end.
- "startStepId" must be a key in "steps".
- Every "next"/"else"/branch "next" must point to an existing step id.
- Put gating logic (e.g. "only when vendor is X") in the trigger "condition" when it decides whether the whole workflow runs.
- For "send for signature / send to sign" requests, use the SEND_FOR_SIGNATURE action (it defaults to the triggering document). Pair it with a NOTIFY or SEND_EMAIL step if the user also wants a notification.
- NEVER hardcode a recipient email address. If the recipient comes from the directory, add a LOOKUP_METADATA step first and reference the result: SEND_FOR_SIGNATURE recipient email = "{{vars.<saveAs>.email}}", name = "{{vars.<saveAs>.contactName}}" (or "{{vars.<saveAs>.label}}"), role = "{{vars.<saveAs>.role}}"; SEND_EMAIL "to" = "{{vars.<saveAs>.email}}". Gate the send with a CONDITION on {{vars.<saveAs>.found}}. Only use a literal email if the user explicitly gives one.
- Always also return a short "name" and one-line "description".`;

const TOOL_NAME = 'build_workflow';
const TOOL_DESCRIPTION = 'Return the workflow to create.';
const TOOL_PARAMETERS = {
  type: 'object' as const,
  required: ['name', 'definition'],
  properties: {
    name: { type: 'string', description: 'Short workflow name (under 200 chars).' },
    description: { type: 'string', description: 'One-line description of what it does.' },
    definition: {
      type: 'object',
      description: 'The full workflow definition JSON (version, trigger, startStepId, steps).',
    },
  },
};

type ToolResult = { name?: unknown; description?: unknown; definition?: unknown };

const fail = (provider: string, status: number, text: string): never => {
  console.error(`[ai-workflow] ${provider} API failed:`, status, text);
  let detail = '';
  try {
    detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    // ignore
  }
  throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
    message: detail || `AI generation failed (${status}). Please try again.`,
  });
};

const callOpenAI = async (apiKey: string, userContent: string): Promise<ToolResult> => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [{ type: 'function', function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: TOOL_PARAMETERS } }],
      tool_choice: { type: 'function', function: { name: TOOL_NAME } },
    }),
  });

  if (!response.ok) fail('OpenAI', response.status, await response.text().catch(() => ''));

  const body = (await response.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const args = body.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === TOOL_NAME)
    ?.function?.arguments;
  if (!args) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'AI did not return a workflow.' });
  }
  return JSON.parse(args) as ToolResult;
};

const callAnthropic = async (apiKey: string, userContent: string): Promise<ToolResult> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: TOOL_PARAMETERS }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) fail('Anthropic', response.status, await response.text().catch(() => ''));

  const body = (await response.json()) as {
    content?: Array<{ type: string; name?: string; input?: ToolResult }>;
  };
  const input = body.content?.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME)?.input;
  if (!input) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'AI did not return a workflow.' });
  }
  return input;
};

type Provider = { name: string; call: (userContent: string) => Promise<ToolResult> };

/** Providers to try, in order, based on configured keys + optional override. */
const resolveProviders = (): Provider[] => {
  const openaiKey = env('NEXT_PRIVATE_OPENAI_API_KEY');
  const anthropicKey = env('NEXT_PRIVATE_ANTHROPIC_API_KEY');
  const forced = (env('NEXT_PRIVATE_WORKFLOW_AI_PROVIDER') || 'auto').toLowerCase();

  const openai: Provider | null = openaiKey
    ? { name: 'OpenAI', call: (c) => callOpenAI(openaiKey, c) }
    : null;
  const anthropic: Provider | null = anthropicKey
    ? { name: 'Anthropic', call: (c) => callAnthropic(anthropicKey, c) }
    : null;

  if (forced === 'openai') return [openai].filter(Boolean) as Provider[];
  if (forced === 'anthropic') return [anthropic].filter(Boolean) as Provider[];
  // auto: prefer OpenAI/GPT-4, fall back to Anthropic.
  return [openai, anthropic].filter(Boolean) as Provider[];
};

export type GeneratedWorkflow = {
  name: string;
  description: string;
  definition: TWorkflowDefinition;
};

/** Call one provider, validate, and retry once with the validation errors. */
const attempt = async (provider: Provider, base: string): Promise<GeneratedWorkflow> => {
  let result = await provider.call(base);
  let parsed = ZWorkflowDefinitionSchema.safeParse(result.definition);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    const retry =
      `${base}\n\nYour previous definition was INVALID:\n${JSON.stringify(result.definition)}\n\n` +
      `Validation errors:\n${issues}\n\nReturn a corrected workflow via ${TOOL_NAME}.`;
    result = await provider.call(retry);
    parsed = ZWorkflowDefinitionSchema.safeParse(result.definition);
  }

  if (!parsed.success) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'AI could not produce a valid workflow. Try rephrasing your request.',
    });
  }

  return {
    name: String(result.name ?? 'AI workflow').slice(0, 200),
    description: String(result.description ?? '').slice(0, 2000),
    definition: parsed.data,
  };
};

export const generateWorkflowFromPrompt = async ({
  prompt,
  organizationName,
  metadataContext,
}: {
  prompt: string;
  organizationName?: string;
  /** Summary of the org's metadata directory so lookups target real categories/keywords. */
  metadataContext?: string;
}): Promise<GeneratedWorkflow> => {
  const providers = resolveProviders();
  if (providers.length === 0) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        "AI workflow generation isn't configured (set NEXT_PRIVATE_OPENAI_API_KEY or NEXT_PRIVATE_ANTHROPIC_API_KEY).",
    });
  }

  const base =
    `Create a workflow for this request:\n"${prompt}"` +
    (organizationName ? `\n\nOrganization: "${organizationName}".` : '') +
    (metadataContext ? `\n\n${metadataContext}` : '');

  let lastError: unknown;
  for (const provider of providers) {
    try {
      return await attempt(provider, base);
    } catch (err) {
      lastError = err;
      console.error(`[ai-workflow] ${provider.name} attempt failed, trying next:`, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'AI generation failed.' });
};
