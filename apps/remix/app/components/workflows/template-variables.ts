/**
 * The `{{ path }}` variables available inside a workflow's text fields.
 *
 * Mirrors the run context built in `triggerWorkflows` (packages/lib/server-only/
 * workflow/trigger-workflows.ts) and the fact providers in
 * packages/lib/server-only/rules/providers/*.ts — kept as a plain client-side
 * list (rather than importing those server-only modules) so it can ship in the
 * browser bundle for autocomplete.
 */

export type TTemplateSuggestion = { path: string; description: string };

export const WORKFLOW_TEMPLATE_FIELDS: TTemplateSuggestion[] = [
  { path: 'event', description: 'The event key that triggered this workflow' },
  { path: 'now', description: 'Current time (ISO timestamp) when the run started' },

  { path: 'document.id', description: 'Document ID' },
  { path: 'document.title', description: 'Document title' },
  { path: 'document.status', description: 'Document status' },
  { path: 'document.source', description: 'How the document was created' },
  { path: 'document.recipientCount', description: 'Number of recipients' },
  { path: 'document.fieldCount', description: 'Number of fields' },
  { path: 'document.createdAt', description: 'When the document was created' },
  { path: 'document.fromInbox', description: 'Whether it arrived via the signature inbox' },
  { path: 'document.owner.email', description: "Document owner's email" },
  { path: 'document.owner.name', description: "Document owner's name" },

  { path: 'recipients.count', description: 'Total recipients' },
  { path: 'recipients.signedCount', description: 'How many recipients have signed' },
  { path: 'recipients.pendingCount', description: 'How many recipients are outstanding' },
  { path: 'recipients.approverCount', description: 'How many recipients are approvers' },
  { path: 'recipients.emails', description: 'All recipient emails' },
  {
    path: 'recipients.signer.email',
    description: 'Email of the recipient acting now (signing gate only)',
  },
  {
    path: 'recipients.signer.role',
    description: 'Role of the recipient acting now (signing gate only)',
  },

  { path: 'organization.id', description: 'Organization ID' },
  { path: 'organization.name', description: 'Organization name' },
  { path: 'organization.slug', description: 'Organization slug' },
  { path: 'organization.inboxEmail', description: "Organization's signature inbox address" },
  { path: 'organization.url', description: 'Link back into the app' },

  { path: 'actor.email', description: 'Email of the user who triggered this run' },
  { path: 'actor.isMember', description: 'Whether the actor is an organization member' },
  { path: 'actor.role', description: "Actor's organization role" },
  { path: 'actor.department', description: "Actor's department" },
  { path: 'actor.isDepartmentHead', description: 'Whether the actor is a department head' },

  { path: 'attachments.count', description: 'Number of supporting attachments' },
  { path: 'attachments.fileNames', description: 'Attachment file names' },
  { path: 'attachments.contentTypes', description: 'Attachment content types' },
  { path: 'attachments.hasPdf', description: 'Whether at least one attachment is a PDF' },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `vars.*` suggestions specific to this workflow — derived from its own steps
 * (SET_VARIABLE assignments, LOOKUP_METADATA's `saveAs`, HTTP_REQUEST's
 * `saveResponseAs`) so the list only offers variables this workflow actually sets.
 */
export const deriveVarSuggestions = (steps: Record<string, unknown>): TTemplateSuggestion[] => {
  const suggestions: TTemplateSuggestion[] = [];

  for (const [stepId, step] of Object.entries(steps)) {
    if (!isRecord(step)) continue;
    const stepLabel = typeof step.name === 'string' && step.name ? step.name : stepId;

    if (
      step.type === 'SET_VARIABLE' &&
      isRecord(step.config) &&
      isRecord(step.config.assignments)
    ) {
      for (const key of Object.keys(step.config.assignments)) {
        suggestions.push({ path: `vars.${key}`, description: `Set by "${stepLabel}"` });
      }
    }

    if (step.type === 'ACTION' && isRecord(step.config)) {
      if (
        step.config.action === 'LOOKUP_METADATA' &&
        typeof step.config.saveAs === 'string' &&
        step.config.saveAs
      ) {
        const saveAs = step.config.saveAs;
        suggestions.push(
          { path: `vars.${saveAs}.found`, description: `Whether "${stepLabel}" found a match` },
          { path: `vars.${saveAs}.label`, description: `Matched label from "${stepLabel}"` },
          { path: `vars.${saveAs}.email`, description: `Matched email from "${stepLabel}"` },
        );
      }

      if (
        step.config.action === 'HTTP_REQUEST' &&
        typeof step.config.saveResponseAs === 'string' &&
        step.config.saveResponseAs
      ) {
        suggestions.push({
          path: `vars.${step.config.saveResponseAs}`,
          description: `Response body from "${stepLabel}"`,
        });
      }
    }
  }

  return suggestions;
};
