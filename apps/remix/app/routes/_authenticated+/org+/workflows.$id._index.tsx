import { useEffect, useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, SaveIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { WORKFLOW_EVENTS, ZWorkflowDefinitionSchema } from '@documenso/lib/types/workflow';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Edit Workflow');
}

type TriggerType = 'EVENT' | 'MANUAL' | 'SCHEDULE';

const STARTER_STEPS = JSON.stringify(
  {
    notify: {
      id: 'notify',
      type: 'ACTION',
      name: 'Send email',
      config: {
        action: 'SEND_EMAIL',
        to: '{{document.user.email}}',
        subject: 'Document {{document.title}} completed',
        html: '<p>Your document <b>{{document.title}}</b> is complete.</p>',
      },
    },
  },
  null,
  2,
);

const labelCls = 'block text-[11px] font-medium text-muted-foreground mb-1';
const fieldCls =
  'block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';
const monoCls = `${fieldCls} font-mono text-[12px]`;

const snippetFor = (id: string, kind: string): Record<string, unknown> => {
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
    case 'DELAY':
      return { id, type: 'DELAY', name: 'Wait', config: { hours: 1 } };
    case 'SET_VARIABLE':
      return {
        id,
        type: 'SET_VARIABLE',
        name: 'Set variable',
        config: { assignments: { myVar: { var: 'document.title' } } },
      };
    default:
      return { id, type: kind };
  }
};

export default function WorkflowEditorPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? 'new';
  const isNew = id === 'new';
  const utils = trpc.useUtils();

  const { data: existing, isLoading } = trpc.workflow.get.useQuery(
    { id },
    { enabled: !isNew },
  );

  const [initialized, setInitialized] = useState(isNew);
  const [view, setView] = useState<'builder' | 'json'>('builder');

  // Top-level fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);

  // Trigger
  const [triggerType, setTriggerType] = useState<TriggerType>('EVENT');
  const [triggerEvent, setTriggerEvent] = useState<string>('DOCUMENT_COMPLETED');
  const [cron, setCron] = useState('0 9 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [conditionText, setConditionText] = useState('');

  // Steps (the processing stream, edited as JSON)
  const [startStepId, setStartStepId] = useState('notify');
  const [stepsText, setStepsText] = useState(STARTER_STEPS);

  // Raw full-definition JSON (import/export)
  const [rawText, setRawText] = useState('');

  // Hydrate from the loaded workflow once.
  useEffect(() => {
    if (initialized || !existing) return;

    setName(existing.name);
    setDescription(existing.description ?? '');
    setEnabled(existing.enabled);

    const def = existing.definition as {
      trigger?: { type?: TriggerType; event?: string; cron?: string; timezone?: string; condition?: unknown };
      startStepId?: string;
      steps?: Record<string, unknown>;
    };

    const trigger = def.trigger ?? { type: 'EVENT' };
    setTriggerType((trigger.type as TriggerType) ?? 'EVENT');
    if (trigger.event) setTriggerEvent(trigger.event);
    if (trigger.cron) setCron(trigger.cron);
    if (trigger.timezone) setTimezone(trigger.timezone);
    setConditionText(trigger.condition ? JSON.stringify(trigger.condition, null, 2) : '');
    setStartStepId(def.startStepId ?? Object.keys(def.steps ?? {})[0] ?? '');
    setStepsText(JSON.stringify(def.steps ?? {}, null, 2));
    setInitialized(true);
  }, [existing, initialized]);

  /** Assemble (and validate) the definition from the current builder state. */
  const buildDefinition = ():
    | { ok: true; definition: Record<string, unknown> }
    | { ok: false; error: string } => {
    let condition: unknown;
    if (conditionText.trim()) {
      try {
        condition = JSON.parse(conditionText);
      } catch {
        return { ok: false, error: 'Trigger condition is not valid JSON.' };
      }
    }

    let steps: Record<string, unknown>;
    try {
      steps = JSON.parse(stepsText);
    } catch {
      return { ok: false, error: 'Steps is not valid JSON.' };
    }

    const trigger =
      triggerType === 'EVENT'
        ? { type: 'EVENT', event: triggerEvent, ...(condition ? { condition } : {}) }
        : triggerType === 'SCHEDULE'
          ? { type: 'SCHEDULE', cron, timezone, ...(condition ? { condition } : {}) }
          : { type: 'MANUAL', ...(condition ? { condition } : {}) };

    const definition = {
      version: 1,
      trigger,
      ...(startStepId ? { startStepId } : {}),
      steps,
    };

    const parsed = ZWorkflowDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: `${first.path.join('.') || 'definition'}: ${first.message}` };
    }

    return { ok: true, definition: parsed.data as Record<string, unknown> };
  };

  const previewDefinition = useMemo(() => {
    const built = buildDefinition();
    return built.ok ? JSON.stringify(built.definition, null, 2) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerType, triggerEvent, cron, timezone, conditionText, startStepId, stepsText]);

  const create = trpc.workflow.create.useMutation();
  const update = trpc.workflow.update.useMutation();

  const onSave = async () => {
    if (!name.trim()) {
      toast({ title: _(msg`Name required`), variant: 'destructive' });
      return;
    }

    const built = buildDefinition();
    if (!built.ok) {
      toast({ title: _(msg`Invalid workflow`), description: built.error, variant: 'destructive' });
      return;
    }

    try {
      if (isNew) {
        const wf = await create.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          enabled,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          definition: built.definition as any,
        });
        toast({ title: _(msg`Workflow created`) });
        void utils.workflow.list.invalidate();
        navigate(`/org/workflows/${wf.id}`);
      } else {
        await update.mutateAsync({
          id,
          name: name.trim(),
          description: description.trim() || null,
          enabled,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          definition: built.definition as any,
        });
        toast({ title: _(msg`Workflow saved`) });
        void utils.workflow.list.invalidate();
        void utils.workflow.get.invalidate({ id });
      }
    } catch (err) {
      toast({
        title: _(msg`Error`),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const addStep = (kind: string) => {
    let steps: Record<string, unknown>;
    try {
      steps = JSON.parse(stepsText);
    } catch {
      toast({ title: _(msg`Fix the steps JSON first`), variant: 'destructive' });
      return;
    }
    const base = kind === 'CONDITION' ? 'condition' : kind.toLowerCase();
    let stepId = base;
    let n = 1;
    while (steps[stepId]) {
      n += 1;
      stepId = `${base}_${n}`;
    }
    steps[stepId] = snippetFor(stepId, kind);
    setStepsText(JSON.stringify(steps, null, 2));
    if (!startStepId) setStartStepId(stepId);
  };

  const applyRawJson = () => {
    let parsed: {
      trigger?: { type?: TriggerType; event?: string; cron?: string; timezone?: string; condition?: unknown };
      startStepId?: string;
      steps?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      toast({ title: _(msg`Invalid JSON`), variant: 'destructive' });
      return;
    }
    const trigger = parsed.trigger ?? { type: 'EVENT' };
    setTriggerType((trigger.type as TriggerType) ?? 'EVENT');
    if (trigger.event) setTriggerEvent(trigger.event);
    if (trigger.cron) setCron(trigger.cron);
    if (trigger.timezone) setTimezone(trigger.timezone);
    setConditionText(trigger.condition ? JSON.stringify(trigger.condition, null, 2) : '');
    setStartStepId(parsed.startStepId ?? Object.keys(parsed.steps ?? {})[0] ?? '');
    setStepsText(JSON.stringify(parsed.steps ?? {}, null, 2));
    setView('builder');
    toast({ title: _(msg`Applied to builder`) });
  };

  if (!isNew && isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/org/workflows" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-semibold">
            {isNew ? <Trans>New workflow</Trans> : <Trans>Edit workflow</Trans>}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5 text-[12px]">
            <button
              type="button"
              className={`rounded px-2 py-1 ${view === 'builder' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setView('builder')}
            >
              <Trans>Builder</Trans>
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${view === 'json' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => {
                setRawText(previewDefinition ?? rawText);
                setView('json');
              }}
            >
              <Trans>JSON</Trans>
            </button>
          </div>
          <Button size="sm" onClick={() => void onSave()} disabled={saving}>
            <SaveIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Save</Trans>
          </Button>
        </div>
      </div>

      {/* Common fields */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              <Trans>Name</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Notify on completion"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <Trans>Enabled</Trans>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>
              <Trans>Description</Trans>
            </label>
            <input
              className={fieldCls}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </div>

      {view === 'json' ? (
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">
              <Trans>Definition JSON</Trans>
            </h3>
            <Button size="sm" variant="outline" onClick={applyRawJson}>
              <Trans>Apply to builder</Trans>
            </Button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            <Trans>
              Paste or edit a complete workflow definition (trigger + steps), then apply it to the
              builder. Use this to import/export workflows.
            </Trans>
          </p>
          <textarea
            className={monoCls}
            rows={22}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          {/* Trigger */}
          <div className="rounded-[var(--r)] border border-border bg-card p-4">
            <h3 className="mb-3 text-[14px] font-semibold">
              <Trans>Trigger</Trans>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>
                  <Trans>Type</Trans>
                </label>
                <select
                  className={fieldCls}
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                >
                  <option value="EVENT">Event</option>
                  <option value="MANUAL">Manual</option>
                  <option value="SCHEDULE">Schedule (cron)</option>
                </select>
              </div>

              {triggerType === 'EVENT' && (
                <div>
                  <label className={labelCls}>
                    <Trans>Event</Trans>
                  </label>
                  <select
                    className={fieldCls}
                    value={triggerEvent}
                    onChange={(e) => setTriggerEvent(e.target.value)}
                  >
                    {['eSign', 'DMS', 'Inbox'].map((group) => (
                      <optgroup key={group} label={group}>
                        {WORKFLOW_EVENTS.filter((ev) => ev.group === group).map((ev) => (
                          <option key={ev.key} value={ev.key}>
                            {ev.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              {triggerType === 'SCHEDULE' && (
                <>
                  <div>
                    <label className={labelCls}>
                      <Trans>Cron expression</Trans>
                    </label>
                    <Input
                      className="h-8 font-mono text-[12px]"
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                      placeholder="0 9 * * 1-5"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <Trans>Timezone</Trans>
                    </label>
                    <Input
                      className="h-8 text-[13px]"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="UTC"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-3">
              <label className={labelCls}>
                <Trans>Condition (JSONLogic, optional)</Trans>
              </label>
              <textarea
                className={monoCls}
                rows={4}
                value={conditionText}
                onChange={(e) => setConditionText(e.target.value)}
                placeholder='{ "==": [ { "var": "document.status" }, "COMPLETED" ] }'
                spellCheck={false}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="rounded-[var(--r)] border border-border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">
                <Trans>Processing stream (steps)</Trans>
              </h3>
              <div className="flex flex-wrap gap-1">
                {['CONDITION', 'SEND_EMAIL', 'HTTP_REQUEST', 'NOTIFY', 'DELAY', 'SET_VARIABLE'].map(
                  (kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => addStep(kind)}
                    >
                      + {kind.replace(/_/g, ' ').toLowerCase()}
                    </Button>
                  ),
                )}
              </div>
            </div>

            <div className="mb-2 max-w-xs">
              <label className={labelCls}>
                <Trans>Start step id</Trans>
              </label>
              <Input
                className="h-8 font-mono text-[12px]"
                value={startStepId}
                onChange={(e) => setStartStepId(e.target.value)}
              />
            </div>

            <label className={labelCls}>
              <Trans>Steps (JSON object keyed by step id)</Trans>
            </label>
            <textarea
              className={monoCls}
              rows={18}
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {previewDefinition ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  <Trans>Definition is valid.</Trans>
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  <Trans>Definition has errors — fix before saving.</Trans>
                </span>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
