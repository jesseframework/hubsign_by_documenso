import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Link } from 'react-router';

import { APPROVAL_SEVERITIES, APPROVAL_VALIDATION_TYPES } from '@documenso/lib/types/approval';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Approval Rules & Validations');
}

const labelCls = 'block text-[11px] font-medium text-muted-foreground mb-1';
const fieldCls =
  'block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';
const mono = `${fieldCls} font-mono text-[12px]`;
const sectionCls = 'rounded-[var(--r)] border border-border bg-card p-4';

const parseJson = (text: string): unknown | undefined => {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export default function ApprovalConfigPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const err = (e: { message: string }) =>
    toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' });

  const validations = trpc.approval.listValidationRules.useQuery();
  const ruleSets = trpc.approval.listRuleSets.useQuery();
  const mappings = trpc.approval.listRoleMappings.useQuery();
  const templates = trpc.approval.listTemplates.useQuery();
  const { data: membership } = trpc.org.getMyOrganization.useQuery();
  const members = membership?.organization?.members ?? [];

  // ── Validation rule form ──
  const [vName, setVName] = useState('');
  const [vType, setVType] = useState<string>('Conditional');
  const [vMsg, setVMsg] = useState('');
  const [vSeverity, setVSeverity] = useState('ERROR');
  const [vConfig, setVConfig] = useState('{\n  "field": "document.title"\n}');

  const upsertValidation = trpc.approval.upsertValidationRule.useMutation({
    onSuccess: () => {
      void utils.approval.listValidationRules.invalidate();
      setVName('');
      setVMsg('');
      toast({ title: _(msg`Validation rule saved`) });
    },
    onError: err,
  });
  const deleteValidation = trpc.approval.deleteValidationRule.useMutation({
    onSuccess: () => void utils.approval.listValidationRules.invalidate(),
    onError: err,
  });

  // ── Rule set + rule forms ──
  const [rsName, setRsName] = useState('');
  const createRuleSet = trpc.approval.createRuleSet.useMutation({
    onSuccess: () => {
      void utils.approval.listRuleSets.invalidate();
      setRsName('');
    },
    onError: err,
  });
  const deleteRuleSet = trpc.approval.deleteRuleSet.useMutation({
    onSuccess: () => void utils.approval.listRuleSets.invalidate(),
    onError: err,
  });
  const upsertRule = trpc.approval.upsertRule.useMutation({
    onSuccess: () => void utils.approval.listRuleSets.invalidate(),
    onError: err,
  });
  const deleteRule = trpc.approval.deleteRule.useMutation({
    onSuccess: () => void utils.approval.listRuleSets.invalidate(),
    onError: err,
  });

  // ── Role mapping form ──
  const [mType, setMType] = useState('Department');
  const [mKey, setMKey] = useState('');
  const [mPrimary, setMPrimary] = useState<string>('');
  const upsertMapping = trpc.approval.upsertRoleMapping.useMutation({
    onSuccess: () => {
      void utils.approval.listRoleMappings.invalidate();
      setMKey('');
      setMPrimary('');
    },
    onError: err,
  });
  const deleteMapping = trpc.approval.deleteRoleMapping.useMutation({
    onSuccess: () => void utils.approval.listRoleMappings.invalidate(),
    onError: err,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link to="/org/approval-templates" className="text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <h2 className="text-lg font-semibold">
          <Trans>Rules &amp; validations</Trans>
        </h2>
      </div>

      {/* Validation rules */}
      <section className={sectionCls}>
        <h3 className="mb-3 text-[14px] font-semibold">
          <Trans>Validation rules</Trans>
        </h3>
        <div className="mb-3 space-y-2">
          {(validations.data ?? []).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium">
                  {v.name}{' '}
                  <span className="text-[11px] text-muted-foreground">
                    · {v.validationType} · {v.severity.toLowerCase()}
                  </span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{v.errorMessage}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive"
                onClick={() => deleteValidation.mutate({ id: v.id })}
              >
                <Trash2Icon className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input className="h-8 text-[13px]" placeholder="Name" value={vName} onChange={(e) => setVName(e.target.value)} />
          <select className={fieldCls} value={vType} onChange={(e) => setVType(e.target.value)}>
            {APPROVAL_VALIDATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Input className="h-8 text-[13px]" placeholder="Error message" value={vMsg} onChange={(e) => setVMsg(e.target.value)} />
          <select className={fieldCls} value={vSeverity} onChange={(e) => setVSeverity(e.target.value)}>
            {APPROVAL_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="sm:col-span-2">
            <label className={labelCls}>
              <Trans>Config (JSON) — e.g. {`{ "field": "document.title" }`} or a JSONLogic rule</Trans>
            </label>
            <textarea className={mono} rows={4} value={vConfig} onChange={(e) => setVConfig(e.target.value)} spellCheck={false} />
          </div>
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={upsertValidation.isPending}
          onClick={() => {
            const cfg = parseJson(vConfig);
            if (cfg === undefined) return toast({ title: _(msg`Config is not valid JSON`), variant: 'destructive' });
            if (!vName.trim() || !vMsg.trim())
              return toast({ title: _(msg`Name and message required`), variant: 'destructive' });
            upsertValidation.mutate({
              name: vName.trim(),
              validationType: vType as never,
              errorMessage: vMsg.trim(),
              severity: vSeverity as never,
              conditionConfig: cfg,
              entityType: 'Document',
            });
          }}
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Add validation rule</Trans>
        </Button>
      </section>

      {/* Rule sets */}
      <section className={sectionCls}>
        <h3 className="mb-1 text-[14px] font-semibold">
          <Trans>Rule sets (pick a template by conditions)</Trans>
        </h3>
        <p className="mb-3 text-[11px] text-muted-foreground">
          <Trans>
            A rule matches with a JSONLogic condition and selects a template. First match (priority
            desc) wins.
          </Trans>
        </p>

        <div className="mb-3 flex gap-2">
          <Input
            className="h-8 flex-1 text-[13px]"
            placeholder="New rule set name"
            value={rsName}
            onChange={(e) => setRsName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!rsName.trim() || createRuleSet.isPending}
            onClick={() => createRuleSet.mutate({ name: rsName.trim(), entityType: 'Document', priority: 0 })}
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Add set</Trans>
          </Button>
        </div>

        <div className="space-y-3">
          {(ruleSets.data ?? []).map((rs) => (
            <div key={rs.id} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-medium">
                  {rs.name} <span className="text-[11px] text-muted-foreground">· {rs.entityType}</span>
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive"
                  onClick={() => deleteRuleSet.mutate({ id: rs.id })}
                >
                  <Trash2Icon className="h-3 w-3" />
                </Button>
              </div>
              {rs.rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 border-t border-border py-1.5">
                  <span className="text-[12px]">
                    {r.name}{' '}
                    <span className="text-[11px] text-muted-foreground">
                      → {templates.data?.find((t) => t.id === r.templateId)?.name ?? '—'}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-destructive"
                    onClick={() => deleteRule.mutate({ id: r.id })}
                  >
                    <Trash2Icon className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <RuleAdder ruleSetId={rs.id} templates={templates.data ?? []} onAdd={upsertRule.mutate} />
            </div>
          ))}
        </div>
      </section>

      {/* Role mappings */}
      <section className={sectionCls}>
        <h3 className="mb-3 text-[14px] font-semibold">
          <Trans>Role → approver mappings</Trans>
        </h3>
        <div className="mb-3 space-y-2">
          {(mappings.data ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="text-[12px]">
                {m.roleType} / <b>{m.roleKey}</b> (L{m.approvalLevel}) →{' '}
                {members.find((x) => x.user.id === m.primaryApproverId)?.user.name ??
                  `user ${m.primaryApproverId}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive"
                onClick={() => deleteMapping.mutate({ id: m.id })}
              >
                <Trash2Icon className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input className="h-8 text-[13px]" placeholder="Role type (e.g. Department)" value={mType} onChange={(e) => setMType(e.target.value)} />
          <Input className="h-8 text-[13px]" placeholder="Role key (e.g. Finance)" value={mKey} onChange={(e) => setMKey(e.target.value)} />
          <select className={fieldCls} value={mPrimary} onChange={(e) => setMPrimary(e.target.value)}>
            <option value="">— primary approver —</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name || m.user.email}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={upsertMapping.isPending}
          onClick={() => {
            if (!mKey.trim() || !mPrimary)
              return toast({ title: _(msg`Role key and approver required`), variant: 'destructive' });
            upsertMapping.mutate({
              roleType: mType.trim() || 'Department',
              roleKey: mKey.trim(),
              approvalLevel: 1,
              primaryApproverId: Number(mPrimary),
            });
          }}
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Add mapping</Trans>
        </Button>
      </section>
    </div>
  );
}

function RuleAdder({
  ruleSetId,
  templates,
  onAdd,
}: {
  ruleSetId: string;
  templates: Array<{ id: string; name: string }>;
  onAdd: (input: {
    ruleSetId: string;
    name: string;
    conditionConfig: unknown;
    templateId?: string;
    priority: number;
    isActive: boolean;
  }) => void;
}) {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [config, setConfig] = useState('{\n  "==": [{ "var": "document.status" }, "DRAFT"]\n}');

  return (
    <div className="mt-2 grid gap-2 border-t border-dashed border-border pt-2 sm:grid-cols-2">
      <Input className="h-8 text-[13px]" placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className={fieldCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        <option value="">— template to use —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="sm:col-span-2">
        <textarea className={mono} rows={3} value={config} onChange={(e) => setConfig(e.target.value)} spellCheck={false} />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          const cfg = parseJson(config);
          if (cfg === undefined) return toast({ title: _(msg`Condition is not valid JSON`), variant: 'destructive' });
          if (!name.trim() || !templateId)
            return toast({ title: _(msg`Name and template required`), variant: 'destructive' });
          onAdd({ ruleSetId, name: name.trim(), conditionConfig: cfg, templateId, priority: 0, isActive: true });
          setName('');
        }}
      >
        <PlusIcon className="mr-1 h-3.5 w-3.5" />
        <Trans>Add rule</Trans>
      </Button>
    </div>
  );
}
