import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  APPROVAL_DETERMINATIONS,
  APPROVAL_ON_APPROVE_ACTIONS,
  ORGANIZATION_ROLES,
} from '@documenso/lib/types/approval';
import { APPROVAL_ENTITY_TYPES } from '@documenso/lib/constants/rule-overrides';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Edit Approval Template');
}

type StepState = {
  name: string;
  determination: string;
  fixedUserId?: number;
  approverRole?: string;
  roleMappingKey?: string;
  department?: string;
  isParallel: boolean;
  isOptional: boolean;
  isEnd: boolean;
  enableReminders: boolean;
  firstReminderAfterHours?: number;
  secondReminderAfterHours?: number;
  escalationAfterHours?: number;
  reminderIntervalHours?: number;
  escalationRecipients?: string;
  validationRuleIds: string[];
};

const newStep = (n: number): StepState => ({
  name: `Step ${n}`,
  determination: 'FIXED_USER',
  isParallel: false,
  isOptional: false,
  isEnd: false,
  enableReminders: false,
  validationRuleIds: [],
});

const label = 'block text-[11px] font-medium text-muted-foreground mb-1';
const field =
  'block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';
const numOrU = (v: string) => (v === '' ? undefined : Number(v));

export default function ApprovalTemplateEditor() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? 'new';
  const isNew = id === 'new';
  const utils = trpc.useUtils();

  const { data: existing, isLoading } = trpc.approval.getTemplate.useQuery({ id }, { enabled: !isNew });
  const { data: membership } = trpc.org.getMyOrganization.useQuery();
  const { data: validations } = trpc.approval.listValidationRules.useQuery();
  const { data: templates } = trpc.approval.listTemplates.useQuery();
  const { data: ruleSets } = trpc.approval.listRuleSets.useQuery();

  const members = membership?.organization?.members ?? [];

  const [initialized, setInitialized] = useState(isNew);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entityType, setEntityType] = useState('Document');
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState('');
  const [onApproveAction, setOnApproveAction] = useState('MARK_APPROVED');
  const [nextTemplateId, setNextTemplateId] = useState('');
  const [nextRuleSetId, setNextRuleSetId] = useState('');
  const [rejectionTemplateId, setRejectionTemplateId] = useState('');
  const [steps, setSteps] = useState<StepState[]>([newStep(1)]);

  useEffect(() => {
    if (initialized || !existing) return;
    setName(existing.name);
    setDescription(existing.description ?? '');
    setEntityType(existing.entityType);
    setIsActive(existing.isActive);
    setIsDefault(existing.isDefault);
    setTriggerStatus(existing.triggerStatus ?? '');
    setOnApproveAction(existing.onApproveAction);
    setNextTemplateId(existing.nextTemplateId ?? '');
    setNextRuleSetId(existing.nextRuleSetId ?? '');
    setRejectionTemplateId(existing.rejectionTemplateId ?? '');
    setSteps(
      existing.steps.map((s) => ({
        name: s.name,
        determination: s.determination,
        fixedUserId: s.fixedUserId ?? undefined,
        approverRole: s.approverRole ?? undefined,
        roleMappingKey: s.roleMappingKey ?? undefined,
        department: s.department ?? undefined,
        isParallel: s.isParallel,
        isOptional: s.isOptional,
        isEnd: s.isEnd,
        enableReminders: s.enableReminders,
        firstReminderAfterHours: s.firstReminderAfterHours ?? undefined,
        secondReminderAfterHours: s.secondReminderAfterHours ?? undefined,
        escalationAfterHours: s.escalationAfterHours ?? undefined,
        reminderIntervalHours: s.reminderIntervalHours ?? undefined,
        escalationRecipients: s.escalationRecipients ?? undefined,
        validationRuleIds: s.validations.map((v) => v.validationRuleId),
      })),
    );
    setInitialized(true);
  }, [existing, initialized]);

  const create = trpc.approval.createTemplate.useMutation();
  const update = trpc.approval.updateTemplate.useMutation();

  const patchStep = (i: number, patch: Partial<StepState>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const onSave = async () => {
    if (!name.trim()) {
      toast({ title: _(msg`Name required`), variant: 'destructive' });
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      entityType: entityType.trim() || 'Document',
      isActive,
      isDefault,
      triggerStatus: triggerStatus.trim() || undefined,
      onApproveAction: onApproveAction as 'NONE' | 'MARK_APPROVED' | 'SEND_FOR_SIGNATURE',
      nextTemplateId: nextTemplateId || undefined,
      nextRuleSetId: nextRuleSetId || undefined,
      rejectionTemplateId: rejectionTemplateId || undefined,
      steps: steps.map((s, i) => ({
        stepNumber: i + 1,
        name: s.name,
        determination: s.determination as (typeof APPROVAL_DETERMINATIONS)[number],
        approverRole: s.determination === 'ORG_ROLE' ? (s.approverRole as never) : undefined,
        fixedUserId: s.determination === 'FIXED_USER' ? s.fixedUserId : undefined,
        roleMappingKey: s.determination === 'ROLE_MAPPING' ? s.roleMappingKey : undefined,
        department: s.determination === 'DEPARTMENT_HEAD' ? s.department : undefined,
        isParallel: s.isParallel,
        isOptional: s.isOptional,
        isEnd: s.isEnd,
        enableReminders: s.enableReminders,
        firstReminderAfterHours: s.firstReminderAfterHours,
        secondReminderAfterHours: s.secondReminderAfterHours,
        escalationAfterHours: s.escalationAfterHours,
        reminderIntervalHours: s.reminderIntervalHours,
        escalationRecipients: s.escalationRecipients || undefined,
        validationRuleIds: s.validationRuleIds,
      })),
    };

    try {
      if (isNew) {
        await create.mutateAsync(payload);
        toast({ title: _(msg`Template created`) });
      } else {
        await update.mutateAsync({ id, data: payload });
        toast({ title: _(msg`Template saved`) });
      }
      void utils.approval.listTemplates.invalidate();
      navigate('/org/approval-templates');
    } catch (err) {
      toast({
        title: _(msg`Error`),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  if (!isNew && isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/org/approval-templates" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-semibold">
            {isNew ? <Trans>New template</Trans> : <Trans>Edit template</Trans>}
          </h2>
        </div>
        <Button size="sm" onClick={() => void onSave()} disabled={saving}>
          <SaveIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Save</Trans>
        </Button>
      </div>

      {/* Template fields */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>
              <Trans>Name</Trans>
            </label>
            <Input className="h-8 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {/*
            A list, not a text box.

            The value has to match what the caller asks for exactly, so typing it
            by hand meant "Rule Override" or "ruleoverride" produced a template
            that silently never matched — an override chain that looked configured
            and never ran. Any value already saved is kept as an option so an
            existing template cannot be silently retyped by opening this page.
          */}
          <div>
            <label className={label}>
              <Trans>What this chain approves</Trans>
            </label>
            <select
              className={field}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              {APPROVAL_ENTITY_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {!APPROVAL_ENTITY_TYPES.some((option) => option.value === entityType) && (
                <option value={entityType}>{entityType}</option>
              )}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>
              <Trans>Description</Trans>
            </label>
            <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className={label}>
              <Trans>On full approval</Trans>
            </label>
            <select className={field} value={onApproveAction} onChange={(e) => setOnApproveAction(e.target.value)}>
              {APPROVAL_ON_APPROVE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>
              <Trans>Trigger on status (optional)</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              value={triggerStatus}
              onChange={(e) => setTriggerStatus(e.target.value)}
              placeholder="e.g. DRAFT"
            />
          </div>
          <div>
            <label className={label}>
              <Trans>Then chain to template (optional)</Trans>
            </label>
            <select className={field} value={nextTemplateId} onChange={(e) => setNextTemplateId(e.target.value)}>
              <option value="">— none —</option>
              {(templates ?? []).filter((t) => t.id !== id).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>
              <Trans>On rejection, run template (optional)</Trans>
            </label>
            <select
              className={field}
              value={rejectionTemplateId}
              onChange={(e) => setRejectionTemplateId(e.target.value)}
            >
              <option value="">— none —</option>
              {(templates ?? []).filter((t) => t.id !== id).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>
              <Trans>Chain via rule set (optional)</Trans>
            </label>
            <select className={field} value={nextRuleSetId} onChange={(e) => setNextRuleSetId(e.target.value)}>
              <option value="">— none —</option>
              {(ruleSets ?? []).map((rs) => (
                <option key={rs.id} value={rs.id}>
                  {rs.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4 pt-5">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Trans>Active</Trans>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              <Trans>Default for entity</Trans>
            </label>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-[var(--r)] border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-muted-foreground">
                <Trans>Step</Trans> {i + 1}
              </span>
              {steps.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] text-destructive"
                  onClick={() => setSteps((prev) => prev.filter((_x, idx) => idx !== i))}
                >
                  <Trash2Icon className="h-3 w-3" />
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>
                  <Trans>Step name</Trans>
                </label>
                <Input
                  className="h-8 text-[13px]"
                  value={s.name}
                  onChange={(e) => patchStep(i, { name: e.target.value })}
                />
              </div>
              <div>
                <label className={label}>
                  <Trans>Approver determination</Trans>
                </label>
                <select
                  className={field}
                  value={s.determination}
                  onChange={(e) => patchStep(i, { determination: e.target.value })}
                >
                  {APPROVAL_DETERMINATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              {s.determination === 'FIXED_USER' && (
                <div>
                  <label className={label}>
                    <Trans>User</Trans>
                  </label>
                  <select
                    className={field}
                    value={s.fixedUserId ?? ''}
                    onChange={(e) => patchStep(i, { fixedUserId: numOrU(e.target.value) })}
                  >
                    <option value="">— pick —</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.name || m.user.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {s.determination === 'ORG_ROLE' && (
                <div>
                  <label className={label}>
                    <Trans>Role</Trans>
                  </label>
                  <select
                    className={field}
                    value={s.approverRole ?? ''}
                    onChange={(e) => patchStep(i, { approverRole: e.target.value })}
                  >
                    <option value="">— pick —</option>
                    {ORGANIZATION_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {s.determination === 'ROLE_MAPPING' && (
                <div>
                  <label className={label}>
                    <Trans>Mapping key</Trans>
                  </label>
                  <Input
                    className="h-8 text-[13px]"
                    value={s.roleMappingKey ?? ''}
                    onChange={(e) => patchStep(i, { roleMappingKey: e.target.value })}
                    placeholder="e.g. Finance"
                  />
                </div>
              )}
              {s.determination === 'DEPARTMENT_HEAD' && (
                <div>
                  <label className={label}>
                    <Trans>Department (blank = requester's)</Trans>
                  </label>
                  <Input
                    className="h-8 text-[13px]"
                    value={s.department ?? ''}
                    onChange={(e) => patchStep(i, { department: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={s.isParallel}
                  onChange={(e) => patchStep(i, { isParallel: e.target.checked })}
                />
                <Trans>Parallel</Trans>
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={s.isOptional}
                  onChange={(e) => patchStep(i, { isOptional: e.target.checked })}
                />
                <Trans>Optional</Trans>
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={s.isEnd}
                  onChange={(e) => patchStep(i, { isEnd: e.target.checked })}
                />
                <Trans>Ends chain</Trans>
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={s.enableReminders}
                  onChange={(e) => patchStep(i, { enableReminders: e.target.checked })}
                />
                <Trans>Reminders</Trans>
              </label>
            </div>

            {s.enableReminders && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['firstReminderAfterHours', '1st (h)'],
                    ['secondReminderAfterHours', '2nd (h)'],
                    ['escalationAfterHours', 'Escalate (h)'],
                    ['reminderIntervalHours', 'Interval (h)'],
                  ] as const
                ).map(([key, lbl]) => (
                  <div key={key}>
                    <label className={label}>{lbl}</label>
                    <Input
                      type="number"
                      className="h-8 text-[13px]"
                      value={s[key] ?? ''}
                      onChange={(e) => patchStep(i, { [key]: numOrU(e.target.value) } as Partial<StepState>)}
                    />
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-4">
                  <label className={label}>
                    <Trans>Escalation recipients (comma-separated emails)</Trans>
                  </label>
                  <Input
                    className="h-8 text-[13px]"
                    value={s.escalationRecipients ?? ''}
                    onChange={(e) => patchStep(i, { escalationRecipients: e.target.value })}
                  />
                </div>
              </div>
            )}

            {validations && validations.length > 0 && (
              <div className="mt-3">
                <label className={label}>
                  <Trans>Validation rules (block/warn before this step)</Trans>
                </label>
                <div className="flex flex-wrap gap-2">
                  {validations.map((v) => {
                    const checked = s.validationRuleIds.includes(v.id);
                    return (
                      <label
                        key={v.id}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                          checked ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            patchStep(i, {
                              validationRuleIds: e.target.checked
                                ? [...s.validationRuleIds, v.id]
                                : s.validationRuleIds.filter((x) => x !== v.id),
                            })
                          }
                        />
                        {v.name} <span className="opacity-60">({v.severity.toLowerCase()})</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        <Button
          size="sm"
          variant="outline"
          onClick={() => setSteps((prev) => [...prev, newStep(prev.length + 1)])}
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Add step</Trans>
        </Button>
      </div>
    </div>
  );
}
