/**
 * Template selection — the deterministic precedence used to pick which approval
 * chain template applies to an entity:
 *
 *   1. An explicit `specificTemplateId`.
 *   2. Rule-based: active ApprovalRuleSets (priority desc), each rule (priority
 *      desc) evaluated via JSONLogic/condition groups → the first match's template.
 *   3. Status-based: an active template whose `triggerStatus` equals the entity's
 *      current status.
 *   4. The org's default (`isDefault = true`) active template for the entity type.
 *
 * Returns the template with its steps (ordered) or null.
 */

import { prisma } from '@documenso/prisma';

import type { TApprovalContext } from '../../types/approval';
import { evaluateConditionConfig } from './condition';

export type FindTemplateInput = {
  organizationId: number;
  entityType: string;
  context: TApprovalContext;
  specificTemplateId?: string | null;
  entityStatus?: string | null;
};

const withSteps = (templateId: string) =>
  prisma.approvalTemplate.findFirst({
    where: { id: templateId, isActive: true },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

/** Evaluate a rule set; returns the matched template id (or null). */
export const evaluateRuleSet = async (
  ruleSetId: string,
  context: TApprovalContext,
): Promise<string | null> => {
  const rules = await prisma.approvalRule.findMany({
    where: { ruleSetId, isActive: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    if (rule.templateId && evaluateConditionConfig(rule.conditionConfig, context)) {
      return rule.templateId;
    }
  }

  return null;
};

export const findApprovalTemplate = async (input: FindTemplateInput) => {
  const { organizationId, entityType, context, specificTemplateId, entityStatus } = input;

  // 1. Explicit template.
  if (specificTemplateId) {
    const explicit = await withSteps(specificTemplateId);
    if (explicit) return explicit;
  }

  // 2. Rule-based.
  const ruleSets = await prisma.approvalRuleSet.findMany({
    where: { organizationId, entityType, isActive: true },
    orderBy: { priority: 'desc' },
  });

  for (const ruleSet of ruleSets) {
    const templateId = await evaluateRuleSet(ruleSet.id, context);
    if (templateId) {
      const matched = await withSteps(templateId);
      if (matched) return matched;
    }
  }

  // 3. Status-based.
  if (entityStatus) {
    const byStatus = await prisma.approvalTemplate.findFirst({
      where: { organizationId, entityType, isActive: true, triggerStatus: entityStatus },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    if (byStatus) return byStatus;
  }

  // 4. Default.
  return prisma.approvalTemplate.findFirst({
    where: { organizationId, entityType, isActive: true, isDefault: true },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
};
