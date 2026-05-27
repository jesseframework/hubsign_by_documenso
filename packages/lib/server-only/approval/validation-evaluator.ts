/**
 * Validation rules run before an approval step dispatches.
 *
 * Each ApprovalValidationRule (attached to a step via ApprovalStepValidation) is
 * evaluated against the entity context. Behaviour by severity:
 *   • CRITICAL — blocks; request stays paused until fixed.
 *   • ERROR    — blocks; all errors are collected and reported.
 *   • WARNING  — surfaced, does not block.
 *   • INFO     — logged only.
 *
 * Validation types: Conditional (JSONLogic / condition group), Required, Range,
 * Pattern, CrossField, Custom (skipped in v1).
 */

import { prisma } from '@documenso/prisma';

import type { TApprovalContext } from '../../types/approval';
import { getByPath } from '../workflow/logic';
import { renderTemplate } from '../workflow/template';
import { compare, evaluateConditionConfig } from './condition';

export type ValidationIssue = {
  rule: string;
  message: string;
  severity: string;
};

export type StepValidationResult = {
  isValid: boolean;
  blockedBySeverity: 'CRITICAL' | 'ERROR' | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type ValidationRuleRecord = {
  name: string;
  validationType: string;
  conditionConfig: unknown;
  errorMessage: string;
  severity: string;
};

/** Returns true when the rule PASSES (entity is valid for this rule). */
const passes = (rule: ValidationRuleRecord, context: TApprovalContext): boolean => {
  const config = (rule.conditionConfig ?? {}) as Record<string, unknown>;

  switch (rule.validationType) {
    case 'Required': {
      const value = getByPath(context, String(config.field ?? ''));
      return value !== null && value !== undefined && String(value) !== '';
    }
    case 'Range': {
      const value = Number(getByPath(context, String(config.field ?? '')));
      if (Number.isNaN(value)) return false;
      if (config.min !== undefined && value < Number(config.min)) return false;
      if (config.max !== undefined && value > Number(config.max)) return false;
      return true;
    }
    case 'Pattern': {
      const value = String(getByPath(context, String(config.field ?? '')) ?? '');
      try {
        return new RegExp(String(config.regex ?? '')).test(value);
      } catch {
        return false;
      }
    }
    case 'CrossField': {
      const left = getByPath(context, String(config.field1 ?? ''));
      const right = getByPath(context, String(config.field2 ?? ''));
      return compare(String(config.operator ?? 'Equals'), left, right);
    }
    case 'Conditional': {
      return evaluateConditionConfig(rule.conditionConfig, context);
    }
    case 'Custom':
    default:
      // Custom validators are not supported server-side in v1 — treat as pass.
      return true;
  }
};

const evaluateRules = (
  rules: ValidationRuleRecord[],
  context: TApprovalContext,
): StepValidationResult => {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let blockedBySeverity: 'CRITICAL' | 'ERROR' | null = null;

  for (const rule of rules) {
    if (passes(rule, context)) continue;

    const issue: ValidationIssue = {
      rule: rule.name,
      message: renderTemplate(rule.errorMessage, context),
      severity: rule.severity,
    };

    if (rule.severity === 'CRITICAL') {
      blockedBySeverity = 'CRITICAL';
      errors.push(issue);
    } else if (rule.severity === 'ERROR') {
      if (blockedBySeverity !== 'CRITICAL') blockedBySeverity = 'ERROR';
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  return { isValid: errors.length === 0, blockedBySeverity, errors, warnings };
};

/** Run all active validation rules attached to a step. */
export const runStepValidations = async (
  stepId: string,
  context: TApprovalContext,
): Promise<StepValidationResult> => {
  const links = await prisma.approvalStepValidation.findMany({
    where: { stepId, isActive: true },
    orderBy: { priority: 'desc' },
    include: { validationRule: true },
  });

  const rules: ValidationRuleRecord[] = links
    .filter((l) => l.validationRule && l.validationRule.isActive)
    .map((l) => ({
      name: l.validationRule.name,
      validationType: l.validationRule.validationType,
      conditionConfig: l.validationRule.conditionConfig,
      errorMessage: l.validationRule.errorMessage,
      severity: l.validationRule.severity,
    }));

  return evaluateRules(rules, context);
};
