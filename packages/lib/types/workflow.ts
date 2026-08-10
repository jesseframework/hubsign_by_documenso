import { z } from 'zod';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic Workflow Manager — JSON definition language
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A workflow is a single JSON document with two parts:
 *
 *   1. `trigger`  — what starts the workflow (a system event, a manual run, or a
 *                   cron schedule), optionally gated by a JSONLogic `condition`.
 *   2. `steps`    — a graph of steps (the "processing stream"). Execution starts
 *                   at `startStepId` and follows each step's `next` / `else`
 *                   pointers until there are no more steps.
 *
 * Logic is injected two ways:
 *   • Declaratively, as JSONLogic rules (see ./workflow-logic-spec or
 *     packages/lib/server-only/workflow/logic) inside CONDITION / BRANCH /
 *     SET_VARIABLE steps and the trigger `condition`.
 *   • At the code level, via the action registry (SEND_EMAIL, HTTP_REQUEST,
 *     NOTIFY, ...) — see packages/lib/server-only/workflow/actions.
 *
 * String fields inside action configs support `{{ path.to.value }}` templating
 * resolved against the run context (trigger payload, document, org, vars, ...).
 */

// ─── Trigger event catalogue ─────────────────────────────────────────────────

/**
 * Events that can start an EVENT-triggered workflow. eSign events mirror the
 * existing WebhookTriggerEvents; DMS events are emitted from the DMS module.
 * Keep this list in sync with the dispatch sites that call `triggerWorkflows`.
 */
export const WORKFLOW_EVENTS = [
  // eSign document lifecycle
  { key: 'DOCUMENT_CREATED', label: 'Document created', group: 'eSign' },
  { key: 'DOCUMENT_SENT', label: 'Document sent for signing', group: 'eSign' },
  { key: 'DOCUMENT_OPENED', label: 'Document opened by recipient', group: 'eSign' },
  { key: 'DOCUMENT_SIGNED', label: 'Recipient signed', group: 'eSign' },
  { key: 'DOCUMENT_COMPLETED', label: 'Document completed', group: 'eSign' },
  { key: 'DOCUMENT_REJECTED', label: 'Document rejected', group: 'eSign' },
  { key: 'DOCUMENT_CANCELLED', label: 'Document cancelled', group: 'eSign' },
  // DMS lifecycle
  { key: 'DMS_DOCUMENT_FILED', label: 'DMS document filed', group: 'DMS' },
  { key: 'DMS_DOCUMENT_CLASSIFIED', label: 'DMS document classified', group: 'DMS' },
  { key: 'DMS_RETRIEVAL_REQUESTED', label: 'DMS retrieval requested', group: 'DMS' },
  // Signature inbox (email-to-sign)
  { key: 'INBOX_EMAIL_RECEIVED', label: 'Inbox email received', group: 'Inbox' },
  { key: 'INBOX_OCR_COMPLETED', label: 'Inbox OCR completed', group: 'Inbox' },
  {
    key: 'INBOX_DUPLICATE_DETECTED',
    label: 'Inbox duplicate invoice detected',
    group: 'Inbox',
  },
] as const;

export type WorkflowEventKey = (typeof WORKFLOW_EVENTS)[number]['key'];

export const WORKFLOW_EVENT_KEYS = WORKFLOW_EVENTS.map((e) => e.key) as [
  WorkflowEventKey,
  ...WorkflowEventKey[],
];

export const ZWorkflowEventKeySchema = z.enum(WORKFLOW_EVENT_KEYS);

// ─── JSONLogic ───────────────────────────────────────────────────────────────

/**
 * A JSONLogic rule (https://jsonlogic.com). Kept permissive on purpose: rules
 * are arbitrary JSON validated/evaluated by the dependency-free evaluator in
 * packages/lib/server-only/workflow/logic. `true`/`undefined` mean "always".
 */
export const ZJsonLogicSchema = z.unknown();
export type TJsonLogic = unknown;

// ─── Triggers ────────────────────────────────────────────────────────────────

export const ZWorkflowTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('EVENT'),
    event: ZWorkflowEventKeySchema,
    /** Optional JSONLogic gate evaluated against the event payload. */
    condition: ZJsonLogicSchema.optional(),
  }),
  z.object({
    type: z.literal('MANUAL'),
    condition: ZJsonLogicSchema.optional(),
  }),
  z.object({
    type: z.literal('SCHEDULE'),
    /** Standard 5-field cron expression, e.g. "0 9 * * 1-5". */
    cron: z.string().min(1),
    timezone: z.string().optional(),
    condition: ZJsonLogicSchema.optional(),
  }),
]);

export type TWorkflowTrigger = z.infer<typeof ZWorkflowTriggerSchema>;

// ─── Actions (side-effecting step bodies) ────────────────────────────────────

export const ZWorkflowActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SEND_EMAIL'),
    /** Recipient address(es). Supports {{templating}} and comma-separated lists. */
    to: z.union([z.string().min(1), z.array(z.string().min(1))]),
    /**
     * Key of a saved EmailTemplate to use for the body (see Organization →
     * Email Templates). When set, the template supplies subject/html/text and
     * the fields below become optional per-step overrides — set `subject` here
     * to reuse one body under a different heading, for example.
     *
     * Preferred over pasting HTML inline: the markup lives in a real editor
     * with a preview, and one wording change updates every workflow using it.
     */
    templateKey: z.string().min(1).optional(),
    subject: z.string().default(''),
    /** HTML body. Supports {{templating}}. Ignored if `templateKey` resolves. */
    html: z.string().default(''),
    /** Optional plaintext body; falls back to a stripped version of `html`. */
    text: z.string().optional(),
  }),
  z.object({
    action: z.literal('HTTP_REQUEST'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    /** Request body — object (sent as JSON) or string. Strings support {{templating}}. */
    body: z.union([z.record(z.unknown()), z.string()]).optional(),
    timeoutMs: z.number().int().positive().max(30_000).optional(),
    /** Store the parsed JSON response into this run variable. */
    saveResponseAs: z.string().optional(),
  }),
  z.object({
    action: z.literal('NOTIFY'),
    /** User id to notify; supports {{templating}} or the keyword "OWNER". */
    userId: z.string().min(1),
    title: z.string().default(''),
    message: z.string().default(''),
  }),
  z.object({
    action: z.literal('LOOKUP_METADATA'),
    /** Lookup grouping, e.g. "vendor" or "signee". */
    category: z.string().min(1),
    /**
     * EXACT-match mode: look up by normalized name. Supports {{templating}},
     * e.g. "{{payload.extractedData.vendor_name}}". Omit to use keyword mode.
     */
    key: z.string().min(1).optional(),
    /**
     * KEYWORD mode (when `key` is omitted): scan this text for each record's
     * keywords and return the first match. Supports {{templating}}. Defaults to
     * all of the event's OCR fields when left blank.
     */
    keywordText: z.string().optional(),
    /** Run variable to store the match in (use as {{vars.<saveAs>.email}}). */
    saveAs: z.string().min(1).default('lookup'),
  }),
  z.object({
    action: z.literal('SEND_FOR_SIGNATURE'),
    /**
     * Document to send. Defaults to the event's document (for INBOX_* events,
     * the inbox payload's `document.id`). Supports {{templating}}.
     */
    documentId: z.union([z.string().min(1), z.number()]).optional(),
    /** Signers to add before sending. All three fields support {{templating}}. */
    recipients: z
      .array(
        z.object({
          email: z.string().min(1),
          name: z.string().optional(),
          /**
           * SIGNER | APPROVER | CC | VIEWER, or a {{template}} resolving to one
           * — e.g. `{{vars.vendor.signerRole}}` to take the role from the
           * matched metadata record.
           *
           * Typed as a string rather than an enum precisely so a placeholder
           * can be stored here; the rendered value is validated against
           * `RECIPIENT_ROLES` at run time and falls back to SIGNER.
           */
          role: z.string().default('SIGNER'),
        }),
      )
      .min(1),
  }),
]);

export type TWorkflowAction = z.infer<typeof ZWorkflowActionSchema>;

export const WORKFLOW_ACTION_TYPES = [
  'SEND_EMAIL',
  'HTTP_REQUEST',
  'NOTIFY',
  'SEND_FOR_SIGNATURE',
  'LOOKUP_METADATA',
] as const;

// ─── Steps ───────────────────────────────────────────────────────────────────

const ZStepBase = {
  id: z.string().min(1),
  name: z.string().optional(),
  /**
   * What to do if this step throws:
   *   - "FAIL" (default): mark the run failed and stop.
   *   - "CONTINUE": log the error and follow `next`.
   *   - a stepId: jump to that step.
   */
  onError: z.string().optional(),
};

export const ZWorkflowStepSchema = z.discriminatedUnion('type', [
  // Evaluate a JSONLogic rule; go to `next` if truthy, else `else`.
  z.object({
    ...ZStepBase,
    type: z.literal('CONDITION'),
    config: z.object({ rule: ZJsonLogicSchema }),
    next: z.string().optional(),
    else: z.string().optional(),
  }),
  // First branch whose `when` is truthy wins; falls back to `else`.
  z.object({
    ...ZStepBase,
    type: z.literal('BRANCH'),
    config: z.object({
      branches: z.array(z.object({ when: ZJsonLogicSchema, next: z.string().min(1) })).min(1),
    }),
    else: z.string().optional(),
  }),
  // Run a registered action, then continue to `next`.
  z.object({
    ...ZStepBase,
    type: z.literal('ACTION'),
    config: ZWorkflowActionSchema,
    next: z.string().optional(),
  }),
  // Pause for a duration, then continue to `next`.
  z.object({
    ...ZStepBase,
    type: z.literal('DELAY'),
    config: z.object({
      ms: z.number().int().nonnegative().optional(),
      seconds: z.number().int().nonnegative().optional(),
      minutes: z.number().int().nonnegative().optional(),
      hours: z.number().int().nonnegative().optional(),
      days: z.number().int().nonnegative().optional(),
    }),
    next: z.string().optional(),
  }),
  // Compute values via JSONLogic and store them into the run variable bag.
  z.object({
    ...ZStepBase,
    type: z.literal('SET_VARIABLE'),
    config: z.object({ assignments: z.record(ZJsonLogicSchema) }),
    next: z.string().optional(),
  }),
]);

export type TWorkflowStep = z.infer<typeof ZWorkflowStepSchema>;
export type TWorkflowStepType = TWorkflowStep['type'];

export const WORKFLOW_STEP_TYPES = [
  'CONDITION',
  'BRANCH',
  'ACTION',
  'DELAY',
  'SET_VARIABLE',
] as const;

// ─── Definition (the whole JSON document) ────────────────────────────────────

export const ZWorkflowDefinitionSchema = z
  .object({
    version: z.literal(1).default(1),
    trigger: ZWorkflowTriggerSchema,
    /** Step to start at. Defaults to the first key of `steps` if omitted. */
    startStepId: z.string().optional(),
    /** Steps keyed by id. Each step's own `id` must match its key. */
    steps: z.record(ZWorkflowStepSchema).default({}),
  })
  .superRefine((def, ctx) => {
    const ids = Object.keys(def.steps);

    // Each step's id must match its key.
    for (const [key, step] of Object.entries(def.steps)) {
      if (step.id !== key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Step key "${key}" does not match its id "${step.id}".`,
          path: ['steps', key, 'id'],
        });
      }
    }

    const start = def.startStepId ?? ids[0];
    if (ids.length > 0 && start && !ids.includes(start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `startStepId "${start}" is not a defined step.`,
        path: ['startStepId'],
      });
    }

    // All referenced step pointers must resolve to a defined step (or a control
    // keyword for onError).
    const isPointerValid = (target: string | undefined, allowKeywords: boolean) => {
      if (target === undefined) return true;
      if (allowKeywords && (target === 'FAIL' || target === 'CONTINUE')) return true;
      return ids.includes(target);
    };

    for (const [key, step] of Object.entries(def.steps)) {
      const pointers: Array<[string | undefined, boolean]> = [[step.onError, true]];
      if ('next' in step) pointers.push([step.next, false]);
      if ('else' in step) pointers.push([step.else, false]);
      if (step.type === 'BRANCH') {
        for (const b of step.config.branches) pointers.push([b.next, false]);
      }
      for (const [target, allowKeywords] of pointers) {
        if (!isPointerValid(target, allowKeywords)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Step "${key}" points to unknown step "${target}".`,
            path: ['steps', key],
          });
        }
      }
    }
  });

export type TWorkflowDefinition = z.infer<typeof ZWorkflowDefinitionSchema>;

// ─── Run context & variables (typed Prisma.Json columns) ─────────────────────

/**
 * The immutable input made available to every step's logic and templates as the
 * root object: `{ trigger, event, document?, organization, now, ... }`.
 */
export type TWorkflowRunContext = Record<string, unknown>;

/** The mutable variable bag accumulated by SET_VARIABLE steps (`vars.*`). */
export type TWorkflowVariables = Record<string, unknown>;

export const ZWorkflowRunContextSchema = z.record(z.unknown());
export const ZWorkflowVariablesSchema = z.record(z.unknown());
