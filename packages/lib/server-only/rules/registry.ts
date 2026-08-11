/**
 * The fact registry: the single list of providers that make up a rule's world.
 *
 * Every rule surface — gates, and in time the approval rule sets — evaluates
 * against the tree this builds, so there is one answer to "what can a rule see"
 * rather than one per feature. Adding an entity is appending to `PROVIDERS`.
 */

import {
  actorProvider,
  attachmentsProvider,
  documentProvider,
  organizationProvider,
  recipientsProvider,
} from './providers/entity';
import { attachmentOcrProvider } from './providers/attachment-ocr';
import { duplicateProvider } from './providers/duplicate';
import { fieldsProvider } from './providers/fields';
import { ocrProvider } from './providers/ocr';
import type { RuleContext, RuleField, RuleFactProvider, RuleSubject } from './types';

export const PROVIDERS: RuleFactProvider[] = [
  documentProvider,
  ocrProvider,
  duplicateProvider,
  recipientsProvider,
  organizationProvider,
  actorProvider,
  attachmentsProvider,
  // What the signer typed, and what OCR read out of what they attached — the
  // two routes by which a missing PO number can now reach a rule.
  fieldsProvider,
  attachmentOcrProvider,
];

/**
 * Flat list of every referenceable path, for the rule builder.
 *
 * This is what makes the engine self-describing: the UI never carries its own
 * copy of the field list, so a new provider shows up in the builder without any
 * front-end change.
 */
export const ruleFieldCatalogue = (): Array<{
  namespace: string;
  label: string;
  fields: RuleField[];
}> =>
  PROVIDERS.map((provider) => ({
    namespace: provider.namespace,
    label: provider.label,
    fields: provider.fields,
  }));

export const ruleFieldPaths = (): string[] =>
  PROVIDERS.flatMap((provider) => provider.fields.map((field) => field.path));

/**
 * Resolves every provider and assembles the evaluation context.
 *
 * Providers run in parallel and are individually fault-isolated: one that throws
 * contributes nothing instead of failing the build. That matters because this
 * runs on the signing path — a provider erroring must not become an unexplained
 * inability to sign.
 */
export const buildRuleContext = async (subject: RuleSubject): Promise<RuleContext> => {
  const resolved = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        return [provider.namespace, await provider.resolve(subject)] as const;
      } catch (err) {
        console.error(`[rules] provider "${provider.namespace}" failed:`, err);

        return [provider.namespace, undefined] as const;
      }
    }),
  );

  const context: RuleContext = {
    entityType: subject.entityType,
    entityId: subject.entityId,
    now: new Date().toISOString(),
  };

  for (const [namespace, value] of resolved) {
    if (value !== undefined) {
      context[namespace] = value;
    }
  }

  return context;
};
