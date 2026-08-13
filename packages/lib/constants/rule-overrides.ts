/**
 * The entity types an approval template can gate.
 *
 * Client-safe on purpose: the template editor needs these to offer a choice, and
 * importing the server-only rules module into a form would drag Prisma into the
 * browser bundle.
 *
 * `entityType` is a plain string on ApprovalTemplate so new gated things can be
 * added without a migration. The cost is that it must match what the caller asks
 * for EXACTLY — and it used to be typed into a free-text box, where "Rule
 * Override" or "ruleoverride" produced a template that silently never matched and
 * an override chain that appeared configured but never ran.
 */

/** Signing exceptions — see `server-only/rules/overrides`. */
export const RULE_OVERRIDE_ENTITY_TYPE = 'RuleOverride';

export const APPROVAL_ENTITY_TYPES = [
  {
    value: 'Document',
    label: 'Document — approve a document before it is sent',
  },
  {
    value: RULE_OVERRIDE_ENTITY_TYPE,
    label: 'Rule override — approve letting a signer past a blocking rule',
  },
] as const;
