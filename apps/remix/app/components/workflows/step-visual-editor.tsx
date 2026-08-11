import type { EmailTemplate } from '@prisma/client';
import { Trans } from '@lingui/react/macro';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
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

const STEP_KINDS: Array<{ kind: TStepKind; label: string }> = [
  { kind: 'CONDITION', label: 'Condition' },
  { kind: 'SEND_EMAIL', label: 'Send email' },
  { kind: 'HTTP_REQUEST', label: 'HTTP request' },
  { kind: 'NOTIFY', label: 'Notify user' },
  { kind: 'SEND_FOR_SIGNATURE', label: 'Send for signature' },
  { kind: 'LOOKUP_METADATA', label: 'Look up metadata' },
  { kind: 'DELAY', label: 'Wait' },
  { kind: 'SET_VARIABLE', label: 'Set variable' },
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
        config: { action: 'NOTIFY', userId: 'OWNER', title: 'Heads up', message: 'Something happened' },
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
        config: { action: 'LOOKUP_METADATA', category: 'vendor', keywordText: '', saveAs: 'lookup' },
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
  <div className="flex rounded-md border border-border p-0.5 text-[11px]">
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
}: {
  entries: Array<[string, string]>;
  onChange: (next: Array<[string, string]>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
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
        <button
          type="button"
          onClick={() => onChange(entries.filter((_, i) => i !== index))}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
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
}: {
  recipients: TRecipient[];
  onChange: (next: TRecipient[]) => void;
}) => (
  <div className="space-y-1.5">
    {recipients.map((r, index) => (
      // eslint-disable-next-line react/no-array-index-key
      <div key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
        <input
          className={`${fieldCls} sm:w-[34%]`}
          value={r.email}
          onChange={(e) => {
            const next = [...recipients];
            next[index] = { ...r, email: e.target.value };
            onChange(next);
          }}
          placeholder="email@example.com"
        />
        <input
          className={`${fieldCls} sm:w-[28%]`}
          value={r.name ?? ''}
          onChange={(e) => {
            const next = [...recipients];
            next[index] = { ...r, name: e.target.value };
            onChange(next);
          }}
          placeholder="Name (optional)"
        />
        <select
          className={`${fieldCls} sm:w-auto`}
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
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
          aria-label="Remove recipient"
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

  const addStep = (kind: TStepKind) => {
    const base = kind === 'CONDITION' ? 'condition' : kind.toLowerCase();
    let id = base;
    let n = 1;
    while (steps[id]) {
      n += 1;
      id = `${base}_${n}`;
    }
    onStepsChange({ ...steps, [id]: snippetFor(id, kind) });
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
        {STEP_KINDS.map(({ kind, label }) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => addStep(kind)}
          >
            <PlusIcon className="mr-1 h-3 w-3" />
            {label}
          </Button>
        ))}
      </div>

      {stepIds.length > 0 && (
        <div className="max-w-xs">
          <label className={labelCls}>
            <Trans>Start step</Trans>
          </label>
          <select
            className={fieldCls}
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
        <p className="text-[12px] text-muted-foreground">
          <Trans>No steps yet — add one above to start building the workflow.</Trans>
        </p>
      )}

      <div className="space-y-3">
        {stepIds.map((id, index) => {
          const step = steps[id] as Record<string, unknown>;
          const kind = kindOfStep(step) ?? 'SEND_EMAIL';
          const config = isRecord(step.config) ? step.config : {};

          return (
            <div key={id} className="rounded-[var(--r)] border border-border bg-background/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                  {index + 1}
                </span>

                <select
                  className={`${fieldCls} w-auto`}
                  value={kind}
                  onChange={(e) => changeKind(id, e.target.value as TStepKind)}
                >
                  {STEP_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>

                <Input
                  className="h-8 w-40 font-mono text-[12px]"
                  value={id}
                  onChange={(e) => renameStep(id, e.target.value)}
                  aria-label="Step id"
                />

                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === stepIds.length - 1}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label="Delete step"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mb-2">
                <label className={labelCls}>
                  <Trans>Label (optional)</Trans>
                </label>
                <Input
                  className="h-8 text-[13px]"
                  value={typeof step.name === 'string' ? step.name : ''}
                  onChange={(e) => updateStep(id, { name: e.target.value })}
                  placeholder="e.g. Notify finance team"
                />
              </div>

              {/* Kind-specific fields */}
              {kind === 'CONDITION' && (
                <div className="mb-2">
                  <label className={labelCls}>
                    <Trans>Run the "then" step if</Trans>
                  </label>
                  <ConditionRuleBuilder
                    datalistId={`workflow-step-condition-${id}`}
                    value={jsonLogicToSimpleCondition(config.rule) ?? emptySimpleCondition()}
                    onChange={(next) => updateConfig(id, { rule: simpleConditionToJsonLogic(next) })}
                    emptyHint={<Trans>No conditions set — add at least one to make this useful.</Trans>}
                  />
                </div>
              )}

              {kind === 'SEND_EMAIL' &&
                (() => {
                  const emailMode = typeof config.templateKey === 'string' ? 'template' : 'custom';

                  return (
                    <div className="grid gap-2">
                      <div>
                        <label className={labelCls}>
                          <Trans>To</Trans>
                        </label>
                        <Input
                          className="h-8 font-mono text-[12px]"
                          value={typeof config.to === 'string' ? config.to : ''}
                          onChange={(e) => updateConfig(id, { to: e.target.value })}
                          placeholder="{{document.user.email}}"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`}>
                          <Trans>Body</Trans>
                        </label>
                        <EmailBodyModeToggle
                          mode={emailMode}
                          onCustom={() =>
                            updateConfig(id, {
                              templateKey: undefined,
                              html: typeof config.html === 'string' && config.html ? config.html : '<p>Body here</p>',
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
                            <label className={labelCls}>
                              <Trans>Subject</Trans>
                            </label>
                            <Input
                              className="h-8 text-[13px]"
                              value={typeof config.subject === 'string' ? config.subject : ''}
                              onChange={(e) => updateConfig(id, { subject: e.target.value })}
                            />
                          </div>
                          <RichTextEditor
                            value={typeof config.html === 'string' ? config.html : ''}
                            onChange={(html) => updateConfig(id, { html })}
                          />
                        </>
                      )}

                      {emailMode === 'template' && (
                        <>
                          <div>
                            <select
                              className={fieldCls}
                              value={typeof config.templateKey === 'string' ? config.templateKey : ''}
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
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                <Trans>No email templates yet — </Trans>
                                <Link to="/org/email-templates/new" className="text-primary underline">
                                  <Trans>create one</Trans>
                                </Link>
                              </p>
                            )}
                          </div>
                          <div>
                            <label className={labelCls}>
                              <Trans>Subject override (optional)</Trans>
                            </label>
                            <Input
                              className="h-8 text-[13px]"
                              value={typeof config.subject === 'string' ? config.subject : ''}
                              onChange={(e) => updateConfig(id, { subject: e.target.value })}
                              placeholder="Uses the template's subject if left blank"
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
                      <label className={labelCls}>
                        <Trans>Method</Trans>
                      </label>
                      <select
                        className={fieldCls}
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
                      <label className={labelCls}>
                        <Trans>URL</Trans>
                      </label>
                      <Input
                        className="h-8 font-mono text-[12px]"
                        value={typeof config.url === 'string' ? config.url : ''}
                        onChange={(e) => updateConfig(id, { url: e.target.value })}
                        placeholder="https://example.com/hook"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Headers</Trans>
                    </label>
                    <KeyValueRows
                      entries={Object.entries(isRecord(config.headers) ? config.headers : {}).map(
                        ([k, v]) => [k, valueToText(v)],
                      )}
                      onChange={(entries) => updateConfig(id, { headers: Object.fromEntries(entries) })}
                      keyPlaceholder="Header name"
                      valuePlaceholder="Value"
                      addLabel="Add header"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Body (JSON or text, optional)</Trans>
                    </label>
                    <textarea
                      className={`${fieldCls} font-mono text-[12px]`}
                      rows={3}
                      value={
                        isRecord(config.body)
                          ? JSON.stringify(config.body, null, 2)
                          : typeof config.body === 'string'
                            ? config.body
                            : ''
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
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
                    <label className={labelCls}>
                      <Trans>Save response as (optional)</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={typeof config.saveResponseAs === 'string' ? config.saveResponseAs : ''}
                      onChange={(e) => updateConfig(id, { saveResponseAs: e.target.value })}
                      placeholder="apiResponse"
                    />
                  </div>
                </div>
              )}

              {kind === 'NOTIFY' && (
                <div className="grid gap-2">
                  <div className="max-w-xs">
                    <label className={labelCls}>
                      <Trans>Notify user</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={typeof config.userId === 'string' ? config.userId : ''}
                      onChange={(e) => updateConfig(id, { userId: e.target.value })}
                      placeholder='"OWNER" or a user id'
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Title</Trans>
                    </label>
                    <Input
                      className="h-8 text-[13px]"
                      value={typeof config.title === 'string' ? config.title : ''}
                      onChange={(e) => updateConfig(id, { title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Message</Trans>
                    </label>
                    <textarea
                      className={`${fieldCls} text-[13px]`}
                      rows={2}
                      value={typeof config.message === 'string' ? config.message : ''}
                      onChange={(e) => updateConfig(id, { message: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {kind === 'SEND_FOR_SIGNATURE' && (
                <div className="grid gap-2">
                  <div className="max-w-xs">
                    <label className={labelCls}>
                      <Trans>Document id (optional)</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={config.documentId !== undefined ? String(config.documentId) : ''}
                      onChange={(e) => updateConfig(id, { documentId: e.target.value || undefined })}
                      placeholder="Defaults to the triggering document"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Recipients</Trans>
                    </label>
                    <RecipientRows
                      recipients={
                        Array.isArray(config.recipients)
                          ? (config.recipients as TRecipient[])
                          : [{ email: '', name: '', role: 'SIGNER' }]
                      }
                      onChange={(recipients) => updateConfig(id, { recipients })}
                    />
                  </div>
                </div>
              )}

              {kind === 'LOOKUP_METADATA' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>
                      <Trans>Category</Trans>
                    </label>
                    <Input
                      className="h-8 text-[13px]"
                      value={typeof config.category === 'string' ? config.category : ''}
                      onChange={(e) => updateConfig(id, { category: e.target.value })}
                      placeholder="vendor"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Save result as</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={typeof config.saveAs === 'string' ? config.saveAs : ''}
                      onChange={(e) => updateConfig(id, { saveAs: e.target.value })}
                      placeholder="lookup"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Exact key (optional)</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={typeof config.key === 'string' ? config.key : ''}
                      onChange={(e) => updateConfig(id, { key: e.target.value || undefined })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Keyword text (optional)</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={typeof config.keywordText === 'string' ? config.keywordText : ''}
                      onChange={(e) => updateConfig(id, { keywordText: e.target.value || undefined })}
                    />
                  </div>
                </div>
              )}

              {kind === 'DELAY' && (
                <div className="flex items-end gap-2">
                  <div>
                    <label className={labelCls}>
                      <Trans>Wait for</Trans>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-24 text-[13px]"
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
                  <label className={labelCls}>
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
              <div className="mt-3 grid gap-2 border-t border-border pt-2 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>
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
                    <label className={labelCls}>
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
          );
        })}
      </div>
    </div>
  );
};
