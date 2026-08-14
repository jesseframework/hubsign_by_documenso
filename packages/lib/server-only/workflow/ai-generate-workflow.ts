/**
 * AI workflow generator — turn a natural-language prompt into a valid workflow
 * definition so end users don't hand-write JSON.
 *
 * Runs through the WorkHub AI bridge; HubSign holds no provider key. Pin the
 * model with `NEXT_PRIVATE_WORKFLOW_AI_MODEL` and the vendor with
 * `NEXT_PRIVATE_WORKFLOW_AI_PROVIDER` (openai | anthropic); unset, WorkHub routes
 * to whichever shared provider is active.
 *
 * This used to hand-roll both an OpenAI and an Anthropic call and fail over
 * between them, because a dry OpenAI account was HubSign's problem to survive.
 * The bridge normalises tool calls across vendors and owns provider health, so
 * both paths collapse into one request.
 *
 * Structured output is enforced via a forced tool call; the result is validated
 * against `ZWorkflowDefinitionSchema` and retried once with the validation
 * errors fed back.
 */

import { AppError, AppErrorCode } from '../../errors/app-error';
import type { TWorkflowDefinition } from '../../types/workflow';
import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_EVENTS,
  ZWorkflowDefinitionSchema,
} from '../../types/workflow';
import { env } from '../../utils/env';
import { type AiVendor, AiBridgeError, callAiBridge } from '../ai/bridge';
import { isAiConfiguredForOrg, resolveAiApiKey } from '../ai/resolve-ai-key';

/** The AI key is per-organization, configured on the AI Credits screen. */
export const isWorkflowAiConfigured = (organizationId: number | null): Promise<boolean> =>
  isAiConfiguredForOrg(organizationId);

/** Optional per-call pins. Unset means "whatever WorkHub has active". */
const workflowModel = (): string | undefined =>
  (env('NEXT_PRIVATE_WORKFLOW_AI_MODEL') || env('NEXT_PRIVATE_OPENAI_MODEL') || '').trim() ||
  undefined;

const workflowVendor = (): AiVendor | undefined => {
  const forced = (env('NEXT_PRIVATE_WORKFLOW_AI_PROVIDER') || '').trim().toLowerCase();
  return forced === 'openai' || forced === 'anthropic' || forced === 'azure_openai' || forced === 'ollama'
    ? (forced as AiVendor)
    : undefined;
};

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
- SEND_EMAIL:          { "action":"SEND_EMAIL", "to": "a@b.com" | ["x","y"], "templateKey"?: "<saved-template-key>", "subject"?: "...", "html"?: "...", "text"?: "..." }
  (PREFER "templateKey" when the org has a saved email template that fits the request — the body is then maintained in the app instead of inlined here, and one edit updates every workflow. Only use it with a key listed under AVAILABLE EMAIL TEMPLATES below; never invent one, because an unresolvable key makes the step skip rather than send. With no suitable template, write "subject" + "html" inline as before. Setting "subject" alongside "templateKey" overrides just the heading.)
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

/**
 * One forced tool call through the bridge — the model has no choice but to
 * answer as a `build_workflow` call, which is how structured output is enforced.
 */
const generateOnce = async (apiKey: string, userContent: string): Promise<ToolResult> => {
  let result;

  try {
    result = await callAiBridge({
      apiKey,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: TOOL_PARAMETERS }],
      toolChoice: { name: TOOL_NAME },
      model: workflowModel(),
      vendor: workflowVendor(),
      maxTokens: 4000,
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof AiBridgeError) {
      // `userMessage` is already written for a user and never repeats the
      // vendor's wording; the upstream text stayed in the bridge's log.
      throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: err.userMessage });
    }
    throw err;
  }

  const args = result.toolCalls.find((call) => call.name === TOOL_NAME)?.arguments;
  if (!args) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'AI did not return a workflow.' });
  }

  try {
    return JSON.parse(args) as ToolResult;
  } catch {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'AI returned a malformed workflow. Try rephrasing your request.',
    });
  }
};

export type GeneratedWorkflow = {
  name: string;
  description: string;
  definition: TWorkflowDefinition;
};

/** Generate, validate, and retry once with the validation errors fed back. */
const attempt = async (apiKey: string, base: string): Promise<GeneratedWorkflow> => {
  let result = await generateOnce(apiKey, base);
  let parsed = ZWorkflowDefinitionSchema.safeParse(result.definition);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    const retry =
      `${base}\n\nYour previous definition was INVALID:\n${JSON.stringify(result.definition)}\n\n` +
      `Validation errors:\n${issues}\n\nReturn a corrected workflow via ${TOOL_NAME}.`;
    result = await generateOnce(apiKey, retry);
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
  organizationId,
  prompt,
  organizationName,
  metadataContext,
  emailTemplateContext,
}: {
  /** Whose AI key to bill this against. */
  organizationId: number;
  prompt: string;
  organizationName?: string;
  /** Summary of the org's metadata directory so lookups target real categories/keywords. */
  metadataContext?: string;
  /** The org's saved email templates, so SEND_EMAIL steps reference real keys. */
  emailTemplateContext?: string;
}): Promise<GeneratedWorkflow> => {
  const apiKey = await resolveAiApiKey(organizationId);
  if (!apiKey) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        "AI workflow generation isn't set up — an organization admin needs to add an AI key on the AI Credits screen.",
    });
  }

  const base =
    `Create a workflow for this request:\n"${prompt}"` +
    (organizationName ? `\n\nOrganization: "${organizationName}".` : '') +
    (metadataContext ? `\n\n${metadataContext}` : '') +
    (emailTemplateContext ? `\n\n${emailTemplateContext}` : '');

  return attempt(apiKey, base);
};
