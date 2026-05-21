import { z } from 'zod';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Approval Chain — shared types & config schemas
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The approval module stores most structure in dedicated columns (see Prisma
 * models ApprovalTemplate/ApprovalStep/...). The JSON-driven parts are:
 *   • ApprovalRule.conditionConfig  — JSONLogic deciding which template applies.
 *   • ApprovalValidationRule.conditionConfig — per-validationType config.
 *   • ApprovalStep.config — optional multi-level approver chain.
 *
 * JSONLogic is evaluated by the dependency-free evaluator in
 * packages/lib/server-only/workflow/logic.ts (reused).
 */

// ─── Enumerations (kept as string unions so this file stays browser-safe) ─────

export const APPROVAL_DETERMINATIONS = [
  'FIXED_USER',
  'ORG_ROLE',
  'ROLE_MAPPING',
  'REPORTING_MANAGER',
  'DEPARTMENT_HEAD',
] as const;
export const ZApprovalDeterminationSchema = z.enum(APPROVAL_DETERMINATIONS);
export type TApprovalDetermination = z.infer<typeof ZApprovalDeterminationSchema>;

export const APPROVAL_ON_APPROVE_ACTIONS = [
  'NONE',
  'MARK_APPROVED',
  'SEND_FOR_SIGNATURE',
] as const;
export const ZApprovalOnApproveActionSchema = z.enum(APPROVAL_ON_APPROVE_ACTIONS);
export type TApprovalOnApproveAction = z.infer<typeof ZApprovalOnApproveActionSchema>;

export const APPROVAL_VALIDATION_TYPES = [
  'Conditional',
  'Required',
  'Range',
  'Pattern',
  'CrossField',
  'Custom',
] as const;
export const ZApprovalValidationTypeSchema = z.enum(APPROVAL_VALIDATION_TYPES);
export type TApprovalValidationType = z.infer<typeof ZApprovalValidationTypeSchema>;

export const APPROVAL_SEVERITIES = ['CRITICAL', 'ERROR', 'WARNING', 'INFO'] as const;
export const ZApprovalSeveritySchema = z.enum(APPROVAL_SEVERITIES);
export type TApprovalSeverity = z.infer<typeof ZApprovalSeveritySchema>;

export const ORGANIZATION_ROLES = [
  'ORG_ADMIN',
  'DMS_ADMIN',
  'TEAM_ADMIN',
  'MANAGER',
  'MEMBER',
] as const;
export const ZOrganizationRoleSchema = z.enum(ORGANIZATION_ROLES);

// ─── Step / template input schemas (used by tRPC create/update) ───────────────

export const ZApprovalStepInputSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    name: z.string().min(1).max(200),
    determination: ZApprovalDeterminationSchema.default('FIXED_USER'),
    approverRole: ZOrganizationRoleSchema.optional(),
    fixedUserId: z.number().int().optional(),
    roleMappingKey: z.string().optional(),
    department: z.string().optional(),
    isParallel: z.boolean().default(false),
    isOptional: z.boolean().default(false),
    isEnd: z.boolean().default(false),
    enableReminders: z.boolean().default(false),
    firstReminderAfterHours: z.number().int().positive().optional(),
    secondReminderAfterHours: z.number().int().positive().optional(),
    escalationAfterHours: z.number().int().positive().optional(),
    reminderIntervalHours: z.number().int().positive().optional(),
    escalationRecipients: z.string().optional(),
    validationRuleIds: z.array(z.string()).default([]),
    config: z.record(z.unknown()).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.determination === 'FIXED_USER' && step.fixedUserId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fixedUserId is required for FIXED_USER steps.',
        path: ['fixedUserId'],
      });
    }
    if (step.determination === 'ORG_ROLE' && !step.approverRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'approverRole is required for ORG_ROLE steps.',
        path: ['approverRole'],
      });
    }
    if (step.determination === 'ROLE_MAPPING' && !step.roleMappingKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'roleMappingKey is required for ROLE_MAPPING steps.',
        path: ['roleMappingKey'],
      });
    }
  });

export type TApprovalStepInput = z.infer<typeof ZApprovalStepInputSchema>;

export const ZApprovalTemplateInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  entityType: z.string().min(1).default('Document'),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  triggerStatus: z.string().optional(),
  onApproveAction: ZApprovalOnApproveActionSchema.default('MARK_APPROVED'),
  nextTemplateId: z.string().optional(),
  nextRuleSetId: z.string().optional(),
  rejectionTemplateId: z.string().optional(),
  steps: z.array(ZApprovalStepInputSchema).min(1),
});

export type TApprovalTemplateInput = z.infer<typeof ZApprovalTemplateInputSchema>;

// ─── Validation config (per validationType) ──────────────────────────────────

export const ZApprovalValidationConfigSchema = z.record(z.unknown());
export type TApprovalValidationConfig = z.infer<typeof ZApprovalValidationConfigSchema>;

// ─── Multi-level approver chain (optional, stored in ApprovalStep.config) ─────

export const ZApproverChainSchema = z.object({
  chain: z.array(
    z.object({
      level: z.number().int().positive(),
      method: ZApprovalDeterminationSchema,
      userId: z.number().int().optional(),
      roleName: ZOrganizationRoleSchema.optional(),
      department: z.string().optional(),
      roleKey: z.string().optional(),
    }),
  ),
});
export type TApproverChain = z.infer<typeof ZApproverChainSchema>;

/** Context object available to rule + validation JSONLogic/field-path evaluation. */
export type TApprovalContext = Record<string, unknown>;
