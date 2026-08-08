/**
 * Evaluates an organization's rules at one gate.
 *
 * FAIL-OPEN, DELIBERATELY
 *
 * If the context can't be built or a rule's JSONLogic is malformed, this allows
 * the action and logs. The alternative — fail closed — means a bug in rule
 * evaluation stops every signature in the organization, which is a worse outcome
 * than a rule silently not firing. A rule that must never be bypassed is not
 * something to express as a soft gate.
 *
 * Individual rule errors are isolated too: one bad condition doesn't stop the
 * others from being evaluated.
 */

import { prisma } from '@documenso/prisma';

import { evaluateCondition } from '../workflow/logic';
import { buildRuleContext } from './registry';
import type { GateVerdict, RuleContext, RuleGate, RuleHit, RuleSubject } from './types';

export const evaluateGate = async ({
  gate,
  subject,
  context: providedContext,
}: {
  gate: RuleGate;
  subject: RuleSubject;
  /** Pass a prebuilt context to avoid resolving providers twice in one request. */
  context?: RuleContext;
}): Promise<GateVerdict> => {
  const allow: GateVerdict = { allowed: true, blocks: [], warnings: [], evaluated: 0 };

  try {
    const rules = await prisma.businessRule.findMany({
      where: {
        organizationId: subject.organizationId,
        gate,
        entityType: subject.entityType,
        isActive: true,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        conditionConfig: true,
        outcome: true,
        message: true,
      },
    });

    // Skip the provider work entirely when nothing is configured — the common
    // case, and this sits on the signing path.
    if (rules.length === 0) {
      return allow;
    }

    const context = providedContext ?? (await buildRuleContext(subject));

    const blocks: RuleHit[] = [];
    const warnings: RuleHit[] = [];

    for (const rule of rules) {
      let fired = false;

      try {
        // TRUE means the rule fires: conditions are authored as the violation
        // ("PO is missing"), not the requirement.
        fired = evaluateCondition(rule.conditionConfig, context);
      } catch (err) {
        console.error(`[rules] rule "${rule.name}" (${rule.id}) failed to evaluate:`, err);
        continue;
      }

      if (!fired) continue;

      const hit: RuleHit = {
        ruleId: rule.id,
        name: rule.name,
        outcome: rule.outcome,
        message: rule.message,
      };

      if (rule.outcome === 'BLOCK') {
        blocks.push(hit);
      } else {
        warnings.push(hit);
      }
    }

    if (warnings.length > 0) {
      console.log(
        `[rules] ${gate} warnings for ${subject.entityType} ${subject.entityId}: ` +
          warnings.map((w) => w.name).join(', '),
      );
    }

    return {
      allowed: blocks.length === 0,
      blocks,
      warnings,
      evaluated: rules.length,
    };
  } catch (err) {
    console.error(`[rules] gate ${gate} evaluation failed — allowing:`, err);

    return allow;
  }
};

/** Single message summarising why an action was refused. */
export const describeBlocks = (verdict: GateVerdict): string =>
  verdict.blocks.map((b) => b.message).join(' ');
