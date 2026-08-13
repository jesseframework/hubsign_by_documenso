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
import { waivedRuleIdsForDocument } from './overrides';
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
  const allow: GateVerdict = {
    allowed: true,
    blocks: [],
    warnings: [],
    waived: [],
    evaluated: 0,
  };

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

    /*
      Rules an approved override lets this document past.

      Only looked up for a Document, and only when something could actually be
      waived — the overwhelmingly common case is no override at all, and this sits
      on the signing path.
    */
    const documentId = subject.entityType === 'Document' ? Number(subject.entityId) : NaN;
    const waivedRuleIds = Number.isInteger(documentId)
      ? await waivedRuleIdsForDocument(documentId).catch((err) => {
          // Failing to read waivers must not become an inability to sign for
          // everyone else, so this degrades to "no waivers" and logs.
          console.error('[rules] could not read rule overrides:', err);

          return new Set<string>();
        })
      : new Set<string>();

    const blocks: RuleHit[] = [];
    const warnings: RuleHit[] = [];
    const waived: RuleHit[] = [];

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

      if (rule.outcome !== 'BLOCK') {
        warnings.push(hit);
        continue;
      }

      // A waived block still fired — it is recorded as waived rather than
      // dropped, so "this was approved as an exception" and "this never applied"
      // stay distinguishable after the fact.
      if (waivedRuleIds.has(rule.id)) {
        waived.push(hit);
        continue;
      }

      blocks.push(hit);
    }

    if (warnings.length > 0) {
      console.log(
        `[rules] ${gate} warnings for ${subject.entityType} ${subject.entityId}: ` +
          warnings.map((w) => w.name).join(', '),
      );
    }

    if (waived.length > 0) {
      console.log(
        `[rules] ${gate} allowed ${subject.entityType} ${subject.entityId} past an approved ` +
          `override of: ${waived.map((w) => w.name).join(', ')}`,
      );
    }

    return {
      allowed: blocks.length === 0,
      blocks,
      warnings,
      waived,
      evaluated: rules.length,
    };
  } catch (err) {
    console.error(`[rules] gate ${gate} evaluation failed — allowing:`, err);

    return allow;
  }
};

/**
 * Why an action was refused, one rule per line.
 *
 * Newline-separated rather than space-joined: two rules firing together used to
 * arrive as a single run-on sentence of stacked policy text, which is hard to
 * read and impossible to act on one item at a time. Callers that render this to
 * a person should split on the newline and show a list; callers that log it get
 * a multi-line entry, which is also an improvement.
 */
export const describeBlocks = (verdict: GateVerdict): string =>
  verdict.blocks.map((b) => b.message).join('\n');
