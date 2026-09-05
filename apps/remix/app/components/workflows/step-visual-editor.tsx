import { Fragment, useMemo } from 'react';

import { Trans } from '@lingui/react/macro';
import type { EmailTemplate } from '@prisma/client';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { Input } from '@documenso/ui/primitives/input';
import { RichTextEditor } from '@documenso/ui/primitives/rich-text-editor';

import {
  ConditionRuleBuilder,
  coerceValue,
  emptySimpleCondition,
  jsonLogicToSimpleCondition,
  simpleConditionToJsonLogic,
  valueToText,
} from './condition-rule-builder';
import { TEMPLATE_INPUT_BASE_CLS, TemplateField } from './template-field';
import type { TTemplateSuggestion } from './template-variables';
import { WORKFLOW_TEMPLATE_FIELDS, deriveVarSuggestions } from './template-variables';

/**
 * A visual, form-based editor for the workflow "processing stream" — the
 * `steps` map of a workflow definition (see packages/lib/types/workflow.ts).
 *
 * It understands CONDITION / ACTION (SEND_EMAIL, HTTP_REQUEST, NOTIFY,
 * SEND_FOR_SIGNATURE, LOOKUP_METADATA) / DELAY / SET_VARIABLE steps with
 * "simple" (JSONLogic-free) configs. BRANCH steps and any step whose config
 * can't be represented that simply fall outside what this editor can show —
 * use `canRepresentStepsVisually` to detect that and fall back to the raw
 * JSON editor.
 */

export type TStepKind =
  | 'CONDITION'
  | 'SEND_EMAIL'
  | 'HTTP_REQUEST'
  | 'NOTIFY'
  | 'SEND_FOR_SIGNATURE'
  | 'LOOKUP_METADATA'
  | 'DELAY'
  | 'SET_VARIABLE';

const STEP_KINDS: Array<{ kind: TStepKind; label: string; description: string }> = [
  {
    kind: 'CONDITION',
    label: 'Condition',
    description:
      'Branch the workflow: run the "then" step if a rule matches, otherwise the "else" step.',
  },
  {
    kind: 'SEND_EMAIL',
    label: 'Send email',
    description: 'Send an email — either a custom subject/body or a saved email template.',
  },
  {
    kind: 'HTTP_REQUEST',
    label: 'HTTP request',
    description: 'Call an external URL and optionally save the response for later steps.',
  },
  {
    kind: 'NOTIFY',
    label: 'Notify user',
    description: 'Send an in-app push notification to a specific user or the document owner.',
  },
  {
    kind: 'SEND_FOR_SIGNATURE',
    label: 'Send for signature',
    description: 'Add recipients to the document and send it out for signing.',
  },
  {
    kind: 'LOOKUP_METADATA',
    label: 'Look up metadata',
    description: 'Match a name or keyword against a metadata category and save the result.',
  },
  {
    kind: 'DELAY',
    label: 'Wait',
    description: 'Pause the workflow for a fixed amount of time before continuing.',
  },
  {
    kind: 'SET_VARIABLE',
    label: 'Set variable',
    description: 'Store a value so later steps can reference it as {{vars.name}}.',
  },
];

const ACTION_KINDS: TStepKind[] = [
  'SEND_EMAIL',
  'HTTP_REQUEST',
  'NOTIFY',
  'SEND_FOR_SIGNATURE',
  'LOOKUP_METADATA',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Default step body for a freshly added step of the given kind. */
export const snippetFor = (id: string, kind: TStepKind): Record<string, unknown> => {
  switch (kind) {
    case 'CONDITION':
      return {
        id,
        type: 'CONDITION',
        name: 'Check condition',
        config: { rule: { '==': [{ var: 'event' }, 'DOCUMENT_COMPLETED'] } },
      };
    case 'SEND_EMAIL':
      return {
        id,
        type: 'ACTION',
        name: 'Send email',
        config: {
          action: 'SEND_EMAIL',
          to: '{{document.user.email}}',
          subject: 'Subject here',
          html: '<p>Body here</p>',
        },
      };
    case 'HTTP_REQUEST':
      return {
        id,
        type: 'ACTION',
        name: 'HTTP request',
        config: {
          action: 'HTTP_REQUEST',
          method: 'POST',
          url: 'https://example.com/hook',
          headers: { 'content-type': 'application/json' },
          body: { documentId: '{{document.id}}' },
          saveResponseAs: 'apiResponse',
        },
      };
    case 'NOTIFY':
      return {
        id,
        type: 'ACTION',
        name: 'Notify user',
        config: {
          action: 'NOTIFY',
          userId: 'OWNER',
          title: 'Heads up',
          message: 'Something happened',
        },
      };
    case 'SEND_FOR_SIGNATURE':
      return {
        id,
        type: 'ACTION',
        name: 'Send for signature',
        config: {
          action: 'SEND_FOR_SIGNATURE',
          recipients: [{ email: '', name: '', role: 'SIGNER' }],
        },
      };
    case 'LOOKUP_METADATA':
      return {
        id,
        type: 'ACTION',
        name: 'Look up metadata',
        config: {
          action: 'LOOKUP_METADATA',
          category: 'vendor',
          keywordText: '',
          saveAs: 'lookup',
        },
      };
    case 'DELAY':
      return { id, type: 'DELAY', name: 'Wait', config: { hours: 1 } };
    case 'SET_VARIABLE':
      return {
        id,
        type: 'SET_VARIABLE',
        name: 'Set variable',
        config: { assignments: { myVar: 'value' } },
      };
    default:
      return { id, type: kind };
  }
};

/** What kind of card to render for a given step, or null if this editor can't represent it. */
const kindOfStep = (step: unknown): TStepKind | null => {
  if (!isRecord(step)) return null;

  if (step.type === 'CONDITION') return 'CONDITION';
  if (step.type === 'DELAY') return 'DELAY';
  if (step.type === 'SET_VARIABLE') return 'SET_VARIABLE';

  if (step.type === 'ACTION' && isRecord(step.config)) {
    const action = step.config.action;
    if (typeof action === 'string' && (ACTION_KINDS as string[]).includes(action)) {
      return action as TStepKind;
    }
  }

  return null;
};

/** True if every step in the map can be shown by this visual editor without losing information. */
export const canRepresentStepsVisually = (steps: Record<string, unknown>): boolean =>
  Object.values(steps).every((step) => {
    const kind = kindOfStep(step);
    if (!kind) return false;

    const config = isRecord(step) && isRecord(step.config) ? step.config : {};

    if (kind === 'CONDITION') {
      return jsonLogicToSimpleCondition(config.rule) !== null;
    }

    if (kind === 'SET_VARIABLE') {
      const assignments = config.assignments;
      if (!isRecord(assignments)) return false;
      return Object.values(assignments).every(
        (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
      );
    }

    return true;
  });

/** Rename a step id everywhere it's referenced (next/else/onError/branches). No-op if `newId` is taken. */
export const renameStepId = (
  steps: Record<string, unknown>,
  oldId: string,
  newId: string,
): Record<string, unknown> => {
  const trimmed = newId.trim();
  if (!trimmed || trimmed === oldId || steps[trimmed]) return steps;

  const remap = (v: unknown) => (v === oldId ? trimmed : v);
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(steps)) {
    if (!isRecord(value)) {
      next[key === oldId ? trimmed : key] = value;
      continue;
    }

    const updated: Record<string, unknown> = {
      ...value,
      id: value.id === oldId ? trimmed : value.id,
      next: remap(value.next),
      else: remap(value.else),
      onError: remap(value.onError),
    };

    if (value.type === 'BRANCH' && isRecord(value.config) && Array.isArray(value.config.branches)) {
      updated.config = {
        ...value.config,
        branches: value.config.branches.map((b: unknown) =>
          isRecord(b) ? { ...b, next: remap(b.next) } : b,
        ),
      };
    }

    next[key === oldId ? trimmed : key] = updated;
  }

  return next;
};

const reorderSteps = (steps: Record<string, unknown>, order: string[]): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const id of order) {
    if (id in steps) next[id] = steps[id];
  }
  return next;
};

const labelCls = 'block text-[11px] font-medium text-muted-foreground mb-1';
const fieldCls =
  'block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';

/** "Custom / Template" switch for a SEND_EMAIL step's body — mirrors the Simple/Advanced toggle elsewhere. */
const EmailBodyModeToggle = ({
  mode,
  onCustom,
  onTemplate,
}: {
  mode: 'custom' | 'template';
  onCustom: () => void;
  onTemplate: () => void;
}) => (
  <div className="border-border flex rounded-md border p-0.5 text-[11px]">
    <button
      type="button"
      className={`rounded px-2 py-0.5 ${mode === 'custom' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
      onClick={onCustom}
    >
      <Trans>Custom</Trans>
    </button>
    <button
      type="button"
      className={`rounded px-2 py-0.5 ${mode === 'template' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
      onClick={onTemplate}
    >
      <Trans>Template</Trans>
    </button>
  </div>
);

/** Dropdown of other step ids to jump to, plus a "(end of workflow)" option. */
const StepTargetSelect = ({
  stepIds,
  currentId,
  value,
  onChange,
  placeholder,
}: {
  stepIds: string[];
  currentId: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  placeholder: string;
}) => (
  <select
    className={fieldCls}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
  >
    <option value="">{placeholder}</option>
    {stepIds
      .filter((id) => id !== currentId)
      .map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
  </select>
);

const KeyValueRows = ({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  valueSuggestions,
}: {
  entries: Array<[string, string]>;
  onChange: (next: Array<[string, string]>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  /** When given, the value field offers `{{ }}` template autocomplete. */
  valueSuggestions?: TTemplateSuggestion[];
}) => (
  <div className="space-y-1.5">
    {entries.map(([key, val], index) => (
      // eslint-disable-next-line react/no-array-index-key
      <div key={index} className="flex items-center gap-1.5">
        <input
          className={`${fieldCls} sm:w-[40%]`}
          value={key}
          onChange={(e) => {
            const next = [...entries];
            next[index] = [e.target.value, val];
            onChange(next);
          }}
          placeholder={keyPlaceholder}
        />
        {valueSuggestions ? (
          <div className="sm:flex-1">
            <TemplateField
              className={fieldCls}
              value={val}
              onChange={(next) => {
                const nextEntries = [...entries];
                nextEntries[index] = [key, next];
                onChange(nextEntries);
              }}
              suggestions={valueSuggestions}
              placeholder={valuePlaceholder}
            />
          </div>
        ) : (
          <input
            className={`${fieldCls} sm:flex-1`}
            value={val}
            onChange={(e) => {
              const next = [...entries];
              next[index] = [key, e.target.value];
              onChange(next);
            }}
            placeholder={valuePlaceholder}
          />
        )}
        <button
          type="button"
          onClick={() => onChange(entries.filter((_, i) => i !== index))}
          className="text-muted-foreground hover:bg-accent hover:text-destructive shrink-0 rounded-md p-1.5"
          aria-label="Remove"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    ))}
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 text-[11px]"
      onClick={() => onChange([...entries, ['', '']])}
    >
      <PlusIcon className="mr-1 h-3 w-3" />
      {addLabel}
    </Button>
  </div>
);

type TRecipient = { email: string; name?: string; role: string };

const RecipientRows = ({
  recipients,
  onChange,
  suggestions,
}: {
  recipients: TRecipient[];
  onChange: (next: TRecipient[]) => void;
  suggestions: TTemplateSuggestion[];
}) => (
  <div className="space-y-1.5">
    {recipients.map((r, index) => (
      // eslint-disable-next-line react/no-array-index-key
      <div key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
        <div className="sm:w-[34%]">
          <TemplateField
            className={fieldCls}
            value={r.email}
            onChange={(next) => {
              const nextRecipients = [...recipients];
              nextRecipients[index] = { ...r, email: next };
              onChange(nextRecipients);
            }}
            suggestions={suggestions}
            placeholder="email@example.com"
            title="Supports {{ }} template fields"
          />
        </div>
        <div className="sm:w-[28%]">
          <TemplateField
            className={fieldCls}
            value={r.name ?? ''}
            onChange={(next) => {
              const nextRecipients = [...recipients];
              nextRecipients[index] = { ...r, name: next };
              onChange(nextRecipients);
            }}
            suggestions={suggestions}
            placeholder="Name (optional)"
            title="Supports {{ }} template fields"
          />
        </div>
        <select
          className={`${fieldCls} sm:w-auto`}
          title="This recipient's role on the document"
          value={r.role}
          onChange={(e) => {
            const next = [...recipients];
            next[index] = { ...r, role: e.target.value };
            onChange(next);
          }}
        >
          {['SIGNER', 'APPROVER', 'CC', 'VIEWER'].map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onChange(recipients.filter((_, i) => i !== index))}
          className="text-muted-foreground hover:bg-accent hover:text-destructive shrink-0 rounded-md p-1.5"
          aria-label="Remove recipient"
          title="Remove this recipient"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    ))}
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 text-[11px]"
      onClick={() => onChange([...recipients, { email: '', name: '', role: 'SIGNER' }])}
    >
      <PlusIcon className="mr-1 h-3 w-3" />
      <Trans>Add recipient</Trans>
    </Button>
  </div>
);

/** Circular "+" button that opens a menu of step kinds to insert at a specific position. */
const AddStepButton = ({ onAdd }: { onAdd: (kind: TStepKind) => void }) => (
  <div className="flex justify-center">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add step"
          title="Insert a new step here"
          className="border-border bg-background text-muted-foreground hover:border-primary hover:text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        {STEP_KINDS.map(({ kind, label, description }) => (
          <DropdownMenuItem key={kind} title={description} onSelect={() => onAdd(kind)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

const DELAY_UNITS = ['seconds', 'minutes', 'hours', 'days'] as const;

export const StepVisualEditor = ({
  steps,
  startStepId,
  onStepsChange,
  onStartStepIdChange,
}: {
  steps: Record<string, unknown>;
  startStepId: string;
  onStepsChange: (next: Record<string, unknown>) => void;
  onStartStepIdChange: (next: string) => void;
}) => {
  const stepIds = Object.keys(steps);
  const { data: emailTemplates } = trpc.emailTemplate.list.useQuery();

  /** `{{ path }}` suggestions offered by every template-aware field below: the fixed context fields plus this workflow's own `vars.*`. */
  const templateSuggestions = useMemo(
    () => [...WORKFLOW_TEMPLATE_FIELDS, ...deriveVarSuggestions(steps)],
    [steps],
  );

  /** Adds a new step of `kind`. If `afterId` is given, it's inserted right after that step; otherwise it's appended to the end. */
  const addStep = (kind: TStepKind, afterId?: string) => {
    const base = kind === 'CONDITION' ? 'condition' : kind.toLowerCase();
    let id = base;
    let n = 1;
    while (steps[id]) {
      n += 1;
      id = `${base}_${n}`;
    }

    const entries = Object.entries(steps);
    const insertAt = afterId ? entries.findIndex(([key]) => key === afterId) + 1 : entries.length;
    entries.splice(insertAt, 0, [id, snippetFor(id, kind)]);

    onStepsChange(Object.fromEntries(entries));
    if (!startStepId) onStartStepIdChange(id);
  };

  const updateStep = (id: string, patch: Record<string, unknown>) =>
    onStepsChange({ ...steps, [id]: { ...(steps[id] as Record<string, unknown>), ...patch } });

  const updateConfig = (id: string, patch: Record<string, unknown>) => {
    const step = steps[id] as Record<string, unknown>;
    const config = isRecord(step.config) ? step.config : {};
    onStepsChange({ ...steps, [id]: { ...step, config: { ...config, ...patch } } });
  };

  const changeKind = (id: string, kind: TStepKind) => {
    const step = steps[id] as Record<string, unknown>;
    const name = typeof step.name === 'string' && step.name ? step.name : undefined;
    onStepsChange({ ...steps, [id]: { ...snippetFor(id, kind), ...(name ? { name } : {}) } });
  };

  const removeStep = (id: string) => {
    const next = { ...steps };
    delete next[id];
    onStepsChange(next);
    if (startStepId === id) onStartStepIdChange(Object.keys(next)[0] ?? '');
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const order = [...stepIds];
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    onStepsChange(reorderSteps(steps, order));
  };

  const renameStep = (oldId: string, newId: string) => {
    const next = renameStepId(steps, oldId, newId);
    onStepsChange(next);
    if (startStepId === oldId && next !== steps) onStartStepIdChange(newId.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {STEP_KINDS.map(({ kind, label, description }) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            title={description}
            onClick={() => addStep(kind)}
          >
            <PlusIcon className="mr-1 h-3 w-3" />
            {label}
          </Button>
        ))}
      </div>

      {stepIds.length > 0 && (
        <div className="max-w-xs">
          <label className={labelCls} title="The step the workflow starts executing from">
            <Trans>Start step</Trans>
          </label>
          <select
            className={fieldCls}
            title="The step the workflow starts executing from"
            value={startStepId}
            onChange={(e) => onStartStepIdChange(e.target.value)}
          >
            {stepIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      )}

      {stepIds.length === 0 && (
        <p className="text-muted-foreground text-[12px]">
          <Trans>No steps yet — add one above to start building the workflow.</Trans>
        </p>
      )}

      <div className="space-y-3">
        {stepIds.map((id, index) => {
          const step = steps[id] as Record<string, unknown>;
          const kind = kindOfStep(step) ?? 'SEND_EMAIL';
          const config = isRecord(step.config) ? step.config : {};

          return (
            <Fragment key={id}>
              <div className="border-border bg-background/40 rounded-[var(--r)] border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold shadow-sm"
                    title={`Step ${index + 1} of ${stepIds.length}`}
                  >
                    {index + 1}
                  </span>

                  <select
                    className={`${fieldCls} w-auto`}
                    title="What this step does"
                    value={kind}
                    onChange={(e) => changeKind(id, e.target.value as TStepKind)}
                  >
                    {STEP_KINDS.map((k) => (
                      <option key={k.kind} value={k.kind} title={k.description}>
                        {k.label}
                      </option>
                    ))}
                  </select>

                  <Input
                    className="h-8 w-40 font-mono text-[12px]"
                    value={id}
                    onChange={(e) => renameStep(id, e.target.value)}
                    aria-label="Step id"
                    title="This step's unique id — referenced by other steps' 'Then go to' / 'Otherwise go to'"
                  />

                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      className="text-muted-foreground hover:bg-accent rounded-md p-1.5 disabled:opacity-30"
                      aria-label="Move up"
                      title="Move this step up"
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === stepIds.length - 1}
                      className="text-muted-foreground hover:bg-accent rounded-md p-1.5 disabled:opacity-30"
                      aria-label="Move down"
                      title="Move this step down"
                    >
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(id)}
                      className="text-muted-foreground hover:bg-accent hover:text-destructive rounded-md p-1.5"
                      aria-label="Delete step"
                      title="Delete this step"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mb-2">
                  <label
                    className={labelCls}
                    title="An optional human-readable name shown instead of the step id"
                  >
                    <Trans>Label (optional)</Trans>
                  </label>
                  <Input
                    className="h-8 text-[13px]"
                    value={typeof step.name === 'string' ? step.name : ''}
                    onChange={(e) => updateStep(id, { name: e.target.value })}
                    placeholder="e.g. Notify finance team"
                    title="An optional human-readable name shown instead of the step id"
                  />
                </div>

                {/* Kind-specific fields */}
                {kind === 'CONDITION' && (
                  <div className="mb-2">
                    <label
                      className={labelCls}
                      title="If this rule is true, the workflow continues to the 'Then go to' step below; otherwise it goes to 'Otherwise go to'"
                    >
                      <Trans>Run the "then" step if</Trans>
                    </label>
                    <ConditionRuleBuilder
                      datalistId={`workflow-step-condition-${id}`}
                      value={jsonLogicToSimpleCondition(config.rule) ?? emptySimpleCondition()}
                      onChange={(next) =>
                        updateConfig(id, { rule: simpleConditionToJsonLogic(next) })
                      }
                      emptyHint={
                        <Trans>No conditions set — add at least one to make this useful.</Trans>
                      }
                    />
                  </div>
                )}

                {kind === 'SEND_EMAIL' &&
                  (() => {
                    const emailMode =
                      typeof config.templateKey === 'string' ? 'template' : 'custom';

                    return (
                      <div className="grid gap-2">
                        <div>
                          <label
                            className={labelCls}
                            title="Recipient email address(es), comma-separated. Supports {{ }} template fields."
                          >
                            <Trans>To</Trans>
                          </label>
                          <TemplateField
                            className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                            value={typeof config.to === 'string' ? config.to : ''}
                            onChange={(next) => updateConfig(id, { to: next })}
                            suggestions={templateSuggestions}
                            placeholder="{{document.owner.email}}"
                            title="Recipient email address(es), comma-separated. Supports {{ }} template fields."
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <label
                            className={`${labelCls} mb-0`}
                            title="The email content, sent either as a custom subject/body or a saved template"
                          >
                            <Trans>Body</Trans>
                          </label>
                          <EmailBodyModeToggle
                            mode={emailMode}
                            onCustom={() =>
                              updateConfig(id, {
                                templateKey: undefined,
                                html:
                                  typeof config.html === 'string' && config.html
                                    ? config.html
                                    : '<p>Body here</p>',
                              })
                            }
                            onTemplate={() =>
                              updateConfig(id, {
                                templateKey: emailTemplates?.[0]?.key ?? '',
                                html: '',
                              })
                            }
                          />
                        </div>

                        {emailMode === 'custom' && (
                          <>
                            <div>
                              <label className={labelCls} title="Supports {{ }} template fields">
                                <Trans>Subject</Trans>
                              </label>
                              <TemplateField
                                className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 text-[13px]')}
                                value={typeof config.subject === 'string' ? config.subject : ''}
                                onChange={(next) => updateConfig(id, { subject: next })}
                                suggestions={templateSuggestions}
                                title="Supports {{ }} template fields"
                              />
                            </div>
                            <div title="Rich text email body. Supports {{ }} template fields.">
                              <RichTextEditor
                                value={typeof config.html === 'string' ? config.html : ''}
                                onChange={(html) => updateConfig(id, { html })}
                              />
                            </div>
                          </>
                        )}

                        {emailMode === 'template' && (
                          <>
                            <div>
                              <select
                                className={fieldCls}
                                title="Which saved email template to send"
                                value={
                                  typeof config.templateKey === 'string' ? config.templateKey : ''
                                }
                                onChange={(e) => updateConfig(id, { templateKey: e.target.value })}
                              >
                                <option value="" disabled>
                                  <Trans>Select a template…</Trans>
                                </option>
                                {emailTemplates?.map((template: EmailTemplate) => (
                                  <option key={template.key} value={template.key}>
                                    {template.name} ({template.key})
                                  </option>
                                ))}
                              </select>
                              {emailTemplates?.length === 0 && (
                                <p className="text-muted-foreground mt-1 text-[11px]">
                                  <Trans>No email templates yet — </Trans>
                                  <Link
                                    to="/org/email-templates/new"
                                    className="text-primary underline"
                                  >
                                    <Trans>create one</Trans>
                                  </Link>
                                </p>
                              )}
                            </div>
                            <div>
                              <label
                                className={labelCls}
                                title="Overrides the template's own subject. Supports {{ }} template fields."
                              >
                                <Trans>Subject override (optional)</Trans>
                              </label>
                              <TemplateField
                                className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 text-[13px]')}
                                value={typeof config.subject === 'string' ? config.subject : ''}
                                onChange={(next) => updateConfig(id, { subject: next })}
                                suggestions={templateSuggestions}
                                placeholder="Uses the template's subject if left blank"
                                title="Overrides the template's own subject. Supports {{ }} template fields."
                              />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                {kind === 'HTTP_REQUEST' && (
                  <div className="grid gap-2">
                    <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                      <div>
                        <label className={labelCls} title="The HTTP method to send">
                          <Trans>Method</Trans>
                        </label>
                        <select
                          className={fieldCls}
                          title="The HTTP method to send"
                          value={typeof config.method === 'string' ? config.method : 'POST'}
                          onChange={(e) => updateConfig(id, { method: e.target.value })}
                        >
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          className={labelCls}
                          title="The endpoint to call. Supports {{ }} template fields."
                        >
                          <Trans>URL</Trans>
                        </label>
                        <TemplateField
                          className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                          value={typeof config.url === 'string' ? config.url : ''}
                          onChange={(next) => updateConfig(id, { url: next })}
                          suggestions={templateSuggestions}
                          placeholder="https://example.com/hook"
                          title="The endpoint to call. Supports {{ }} template fields."
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Extra HTTP headers to send. Values support {{ }} template fields."
                      >
                        <Trans>Headers</Trans>
                      </label>
                      <KeyValueRows
                        entries={Object.entries(isRecord(config.headers) ? config.headers : {}).map(
                          ([k, v]) => [k, valueToText(v)],
                        )}
                        onChange={(entries) =>
                          updateConfig(id, { headers: Object.fromEntries(entries) })
                        }
                        keyPlaceholder="Header name"
                        valuePlaceholder="Value"
                        addLabel="Add header"
                        valueSuggestions={templateSuggestions}
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Request payload, sent for non-GET requests. Supports {{ }} template fields."
                      >
                        <Trans>Body (JSON or text, optional)</Trans>
                      </label>
                      <TemplateField
                        multiline
                        rows={3}
                        className={`${fieldCls} font-mono text-[12px]`}
                        suggestions={templateSuggestions}
                        title="Request payload, sent for non-GET requests. Supports {{ }} template fields."
                        value={
                          isRecord(config.body)
                            ? JSON.stringify(config.body, null, 2)
                            : typeof config.body === 'string'
                              ? config.body
                              : ''
                        }
                        onChange={(raw) => {
                          try {
                            const parsed: unknown = JSON.parse(raw);
                            updateConfig(id, { body: isRecord(parsed) ? parsed : raw });
                          } catch {
                            updateConfig(id, { body: raw });
                          }
                        }}
                      />
                    </div>
                    <div className="max-w-xs">
                      <label
                        className={labelCls}
                        title="Variable name to store the response body under, referenced later as {{vars.name}}"
                      >
                        <Trans>Save response as (optional)</Trans>
                      </label>
                      <Input
                        className="h-8 font-mono text-[12px]"
                        value={
                          typeof config.saveResponseAs === 'string' ? config.saveResponseAs : ''
                        }
                        onChange={(e) => updateConfig(id, { saveResponseAs: e.target.value })}
                        placeholder="apiResponse"
                        title="Variable name to store the response body under, referenced later as {{vars.name}}"
                      />
                    </div>
                  </div>
                )}

                {kind === 'NOTIFY' && (
                  <div className="grid gap-2">
                    <div className="max-w-xs">
                      <label
                        className={labelCls}
                        title='Who receives the notification — "OWNER", a user id, or a {{ }} template field'
                      >
                        <Trans>Notify user</Trans>
                      </label>
                      <TemplateField
                        className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                        value={typeof config.userId === 'string' ? config.userId : ''}
                        onChange={(next) => updateConfig(id, { userId: next })}
                        suggestions={templateSuggestions}
                        placeholder='"OWNER" or a user id'
                        title='Who receives the notification — "OWNER", a user id, or a {{ }} template field'
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Notification title. Supports {{ }} template fields."
                      >
                        <Trans>Title</Trans>
                      </label>
                      <TemplateField
                        className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 text-[13px]')}
                        value={typeof config.title === 'string' ? config.title : ''}
                        onChange={(next) => updateConfig(id, { title: next })}
                        suggestions={templateSuggestions}
                        title="Notification title. Supports {{ }} template fields."
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Notification body. Supports {{ }} template fields."
                      >
                        <Trans>Message</Trans>
                      </label>
                      <TemplateField
                        multiline
                        rows={2}
                        className={`${fieldCls} text-[13px]`}
                        value={typeof config.message === 'string' ? config.message : ''}
                        onChange={(next) => updateConfig(id, { message: next })}
                        suggestions={templateSuggestions}
                        title="Notification body. Supports {{ }} template fields."
                      />
                    </div>
                  </div>
                )}

                {kind === 'SEND_FOR_SIGNATURE' && (
                  <div className="grid gap-2">
                    <div className="max-w-xs">
                      <label
                        className={labelCls}
                        title="Which document to send. Leave blank to use the document that triggered this workflow. Supports {{ }} template fields."
                      >
                        <Trans>Document id (optional)</Trans>
                      </label>
                      <TemplateField
                        className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                        value={config.documentId !== undefined ? String(config.documentId) : ''}
                        onChange={(next) => updateConfig(id, { documentId: next || undefined })}
                        suggestions={templateSuggestions}
                        placeholder="Defaults to the triggering document"
                        title="Which document to send. Leave blank to use the document that triggered this workflow. Supports {{ }} template fields."
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Signers, approvers, CC and viewers to add to the document"
                      >
                        <Trans>Recipients</Trans>
                      </label>
                      <RecipientRows
                        recipients={
                          Array.isArray(config.recipients)
                            ? (config.recipients as TRecipient[])
                            : [{ email: '', name: '', role: 'SIGNER' }]
                        }
                        onChange={(recipients) => updateConfig(id, { recipients })}
                        suggestions={templateSuggestions}
                      />
                    </div>
                  </div>
                )}

                {kind === 'LOOKUP_METADATA' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label
                        className={labelCls}
                        title="Which metadata category to search (e.g. vendor, department)"
                      >
                        <Trans>Category</Trans>
                      </label>
                      <Input
                        className="h-8 text-[13px]"
                        value={typeof config.category === 'string' ? config.category : ''}
                        onChange={(e) => updateConfig(id, { category: e.target.value })}
                        placeholder="vendor"
                        title="Which metadata category to search (e.g. vendor, department)"
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Variable name to store the match under, referenced later as {{vars.name}}"
                      >
                        <Trans>Save result as</Trans>
                      </label>
                      <Input
                        className="h-8 font-mono text-[12px]"
                        value={typeof config.saveAs === 'string' ? config.saveAs : ''}
                        onChange={(e) => updateConfig(id, { saveAs: e.target.value })}
                        placeholder="lookup"
                        title="Variable name to store the match under, referenced later as {{vars.name}}"
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Match by an exact name/key instead of scanning for keywords. Supports {{ }} template fields."
                      >
                        <Trans>Exact key (optional)</Trans>
                      </label>
                      <TemplateField
                        className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                        value={typeof config.key === 'string' ? config.key : ''}
                        onChange={(next) => updateConfig(id, { key: next || undefined })}
                        suggestions={templateSuggestions}
                        title="Match by an exact name/key instead of scanning for keywords. Supports {{ }} template fields."
                      />
                    </div>
                    <div>
                      <label
                        className={labelCls}
                        title="Text to scan for a matching keyword. Defaults to the event's extracted data. Supports {{ }} template fields."
                      >
                        <Trans>Keyword text (optional)</Trans>
                      </label>
                      <TemplateField
                        className={cn(TEMPLATE_INPUT_BASE_CLS, 'h-8 font-mono text-[12px]')}
                        value={typeof config.keywordText === 'string' ? config.keywordText : ''}
                        onChange={(next) => updateConfig(id, { keywordText: next || undefined })}
                        suggestions={templateSuggestions}
                        title="Text to scan for a matching keyword. Defaults to the event's extracted data. Supports {{ }} template fields."
                      />
                    </div>
                  </div>
                )}

                {kind === 'DELAY' && (
                  <div className="flex items-end gap-2">
                    <div>
                      <label className={labelCls} title="How long to pause before continuing">
                        <Trans>Wait for</Trans>
                      </label>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-24 text-[13px]"
                        title="How long to pause before continuing"
                        value={
                          DELAY_UNITS.map((u) => config[u]).find((v) => typeof v === 'number') ?? 0
                        }
                        onChange={(e) => {
                          const unit =
                            DELAY_UNITS.find((u) => typeof config[u] === 'number') ?? 'hours';
                          updateConfig(id, { [unit]: Number(e.target.value) || 0 });
                        }}
                      />
                    </div>
                    <select
                      className={`${fieldCls} w-auto`}
                      title="Time unit for the wait"
                      value={DELAY_UNITS.find((u) => typeof config[u] === 'number') ?? 'hours'}
                      onChange={(e) => {
                        const currentUnit = DELAY_UNITS.find((u) => typeof config[u] === 'number');
                        const currentValue = currentUnit ? Number(config[currentUnit]) : 1;
                        const patch: Record<string, number | undefined> = {
                          ms: undefined,
                          seconds: undefined,
                          minutes: undefined,
                          hours: undefined,
                          days: undefined,
                        };
                        patch[e.target.value] = currentValue;
                        updateConfig(id, patch);
                      }}
                    >
                      {DELAY_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {kind === 'SET_VARIABLE' && (
                  <div>
                    <label
                      className={labelCls}
                      title="Literal values only (not {{ }} templates) — stored as {{vars.name}} for later steps"
                    >
                      <Trans>Set variables</Trans>
                    </label>
                    <KeyValueRows
                      entries={Object.entries(
                        isRecord(config.assignments) ? config.assignments : {},
                      ).map(([k, v]) => [k, valueToText(v)])}
                      onChange={(entries) =>
                        updateConfig(id, {
                          assignments: Object.fromEntries(
                            entries.map(([k, v]) => [k, coerceValue(v)]),
                          ),
                        })
                      }
                      keyPlaceholder="Variable name"
                      valuePlaceholder="Value"
                      addLabel="Add variable"
                    />
                  </div>
                )}

                {/* Flow control */}
                <div className="border-border mt-3 grid gap-2 border-t pt-2 sm:grid-cols-2">
                  <div>
                    <label
                      className={labelCls}
                      title="Which step runs next. Leave blank to end the workflow here."
                    >
                      <Trans>Then go to</Trans>
                    </label>
                    <StepTargetSelect
                      stepIds={stepIds}
                      currentId={id}
                      value={typeof step.next === 'string' ? step.next : undefined}
                      onChange={(next) => updateStep(id, { next })}
                      placeholder="— end of workflow —"
                    />
                  </div>
                  {kind === 'CONDITION' && (
                    <div>
                      <label
                        className={labelCls}
                        title="Which step runs when the condition above is false. Leave blank to end the workflow here."
                      >
                        <Trans>Otherwise go to</Trans>
                      </label>
                      <StepTargetSelect
                        stepIds={stepIds}
                        currentId={id}
                        value={typeof step.else === 'string' ? step.else : undefined}
                        onChange={(next) => updateStep(id, { else: next })}
                        placeholder="— end of workflow —"
                      />
                    </div>
                  )}
                </div>
              </div>

              <AddStepButton onAdd={(kind) => addStep(kind, id)} />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
