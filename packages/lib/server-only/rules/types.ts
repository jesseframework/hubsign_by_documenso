/**
 * Types for the business-rule fact registry.
 *
 * The rule *language* already existed (JSONLogic, shared with the workflow
 * engine). What was missing was the data: `buildApprovalContext` hand-assembled
 * a handful of document columns, so a rule about a PO number or an invoice total
 * could not be written at all — the facts were never in scope.
 *
 * A provider owns one namespace of the context and declares the fields it
 * contributes. Declaring them is not documentation: the rule-builder UI reads
 * the catalogue to offer real paths, so "make the engine application aware"
 * reduces to "add a provider".
 */

/** Where a rule set is evaluated. Each gate has one enforcement call site. */
export const RULE_GATES = ['DOCUMENT_SEND', 'DOCUMENT_SIGN', 'INBOX_READY'] as const;

export type RuleGate = (typeof RULE_GATES)[number];

export const RULE_GATE_LABELS: Record<RuleGate, string> = {
  DOCUMENT_SEND: 'Before a document is sent for signature',
  DOCUMENT_SIGN: 'Before a recipient signs',
  INBOX_READY: 'Before an inbox item is marked ready',
};

export type RuleFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array';

export type RuleField = {
  /** Dotted path a rule references, e.g. `ocr.total_amount`. */
  path: string;
  label: string;
  type: RuleFieldType;
  /** Shown as help text in the rule builder. */
  description?: string;
  /**
   * Flags a field whose value is only as good as the OCR that produced it.
   * The builder warns on these — see the note in the OCR provider.
   */
  unreliable?: boolean;
};

/** Everything a provider is allowed to resolve against. */
export type RuleSubject = {
  organizationId: number;
  /** Currently always 'Document'; the shape is here so gates can widen later. */
  entityType: string;
  entityId: string;
  /** The signed-in user driving the action, when there is one. */
  actorUserId?: number | null;
  /** The recipient about to sign, for the DOCUMENT_SIGN gate. */
  recipientId?: number | null;
};

export type RuleFactProvider = {
  /** Top-level key this provider owns in the context. */
  namespace: string;
  label: string;
  fields: RuleField[];
  /**
   * Returns this namespace's data, or undefined to omit it.
   *
   * Must never throw: a provider that can't resolve (no inbox item, no
   * organization row) contributes nothing rather than failing the whole
   * evaluation and, by extension, blocking a signature.
   */
  resolve: (subject: RuleSubject) => Promise<unknown>;
};

export type RuleContext = Record<string, unknown>;

export const RULE_OUTCOMES = ['BLOCK', 'WARN'] as const;

export type RuleOutcome = (typeof RULE_OUTCOMES)[number];

/** One rule that fired. */
export type RuleHit = {
  ruleId: string;
  name: string;
  outcome: RuleOutcome;
  message: string;
};

export type GateVerdict = {
  /** False when at least one BLOCK rule fired and was not waived. */
  allowed: boolean;
  blocks: RuleHit[];
  warnings: RuleHit[];
  /**
   * BLOCK rules that fired but were let through by an approved override.
   *
   * Kept separate from `warnings` rather than folded in, because the difference
   * matters when answering why a signature was allowed: a warning was never going
   * to stop anything, whereas one of these DID stop it until somebody with
   * authority signed off. Callers log these.
   */
  waived: RuleHit[];
  /** Rules evaluated, for logging and for the "why was this allowed" question. */
  evaluated: number;
};
