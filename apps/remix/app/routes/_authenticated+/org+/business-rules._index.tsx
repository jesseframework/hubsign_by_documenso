import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { AlertTriangleIcon, PencilIcon, PlusIcon, ScaleIcon, Trash2Icon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { OrgAdminGuard } from '~/components/general/org-admin-guard';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Business Rules');
}

const label = 'mb-1 block text-[11px] font-medium text-muted-foreground';
const control =
  'w-full rounded-[var(--r-sm)] border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary';

/**
 * Gates that are offered by the catalogue but have no enforcement call site.
 *
 * `INBOX_READY` is declared in `RULE_GATES` and appears in the dropdown, but
 * nothing evaluates it — a rule saved against it is silently inert, which is
 * worse than not offering it at all. Disabled here rather than removed from the
 * catalogue, because the gate is a real intention that just isn't wired up;
 * delete this entry when it is.
 */
const UNENFORCED_GATES = new Set(['INBOX_READY']);

/**
 * Starting points, so nobody has to write JSONLogic from a blank box.
 *
 * Every OCR-based preset is guarded by `ocr.hasData`. Without it the rule fires
 * on documents that never came from the inbox: the OCR provider reports no data
 * for those, a missing value reads as absent, and a "PO number is missing" rule
 * then refuses signing on contracts and NDAs that never had a PO to begin with.
 * The same trap catches numeric comparisons, where a null confidence coerces to
 * 0 and satisfies `< 0.7`.
 */
const PRESETS = [
  {
    name: 'PO number required',
    gate: 'DOCUMENT_SIGN' as const,
    // Written for the person who will actually read it — an external signer,
    // not somebody with access to the Signature Inbox.
    message:
      'A PO number is required. Attach the purchase order under "Supporting documents" below and it will be read automatically, then press Sign again.',
    // Satisfied by any of the three routes a PO number can arrive by, so the
    // block is something the person in front of it can actually clear.
    condition: {
      and: [
        { var: 'ocr.hasData' },
        { '!': [{ var: 'ocr.has_plausible_po' }] },
        { '!': [{ var: 'fields.po_number' }] },
        { '!': [{ var: 'attachedPo.po_number' }] },
      ],
    },
  },
  {
    name: 'Attached PO must match the invoice',
    gate: 'DOCUMENT_SIGN' as const,
    message:
      'The PO number on the attached purchase order does not match the one on the invoice. Check you have attached the right purchase order.',
    // One fact, because it already carries the whole answer: true only when
    // both numbers exist and differ once case, spacing and punctuation are
    // ignored. Writing this as `!(a == b)` would flag MER-PO-5023 against
    // "mer po 5023", and would also fire when nothing was attached at all.
    condition: { var: 'attachedPo.po_differs_from_invoice' },
  },
  {
    name: 'Attached PO amount must match the invoice',
    gate: 'DOCUMENT_SIGN' as const,
    message:
      'The total on the attached purchase order differs from the invoice total by more than the allowed tolerance.',
    // The tolerance is the number in this condition — edit it to suit. Guarded
    // by `total_comparable` so an unreadable total is never read as agreement.
    condition: {
      and: [
        { var: 'attachedPo.total_comparable' },
        { '>': [{ var: 'attachedPo.total_difference' }, 1] },
      ],
    },
  },
  {
    name: 'High-value invoice needs a second approver',
    gate: 'DOCUMENT_SIGN' as const,
    message: 'Invoices over 300,000 require a second approver before signing.',
    condition: { '>': [{ var: 'ocr.total_amount' }, 300000] },
  },
  {
    name: 'Low OCR confidence — review before signing',
    gate: 'DOCUMENT_SIGN' as const,
    message: 'The extracted data has low confidence. Check the figures before signing.',
    condition: { and: [{ var: 'ocr.hasData' }, { '<': [{ var: 'ocr.confidence' }, 0.7] }] },
  },
  {
    name: 'Supporting document required',
    gate: 'DOCUMENT_SIGN' as const,
    message: 'Attach the supporting paperwork before signing.',
    condition: { '==': [{ var: 'attachments.count' }, 0] },
  },
];

function BusinessRulesPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: catalogue } = trpc.businessRule.fieldCatalogue.useQuery();
  const { data: rules, isLoading } = trpc.businessRule.list.useQuery();

  /** `id` present means the form is editing an existing rule rather than creating one. */
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    gate: string;
    outcome: string;
    message: string;
    condition: string;
  } | null>(null);

  const [testDocumentId, setTestDocumentId] = useState('');

  const onSaved = async (title: string) => {
    await utils.businessRule.list.invalidate();
    setDraft(null);
    toast({ title });
  };

  const create = trpc.businessRule.create.useMutation({
    onSuccess: () => void onSaved(_(msg`Rule created`)),
    onError: (e) => toast({ title: e.message, variant: 'destructive' }),
  });

  // Two hooks over the same procedure: the on/off switch must not close the
  // editor, and saving the editor must.
  const toggle = trpc.businessRule.update.useMutation({
    onSuccess: async () => {
      await utils.businessRule.list.invalidate();
      toast({ title: _(msg`Rule updated`) });
    },
    onError: (e) => toast({ title: e.message, variant: 'destructive' }),
  });

  const save = trpc.businessRule.update.useMutation({
    onSuccess: () => void onSaved(_(msg`Rule updated`)),
    onError: (e) => toast({ title: e.message, variant: 'destructive' }),
  });

  const remove = trpc.businessRule.delete.useMutation({
    onSuccess: () => void onSaved(_(msg`Rule deleted`)),
    onError: (e) => toast({ title: e.message, variant: 'destructive' }),
  });

  const test = trpc.businessRule.test.useQuery(
    { gate: 'DOCUMENT_SIGN', documentId: Number(testDocumentId) },
    { enabled: Boolean(testDocumentId) && Number.isFinite(Number(testDocumentId)) },
  );

  const submitDraft = () => {
    if (!draft) return;

    let conditionConfig: unknown;

    try {
      conditionConfig = JSON.parse(draft.condition);
    } catch {
      toast({ title: _(msg`The condition isn't valid JSON`), variant: 'destructive' });
      return;
    }

    const payload = {
      name: draft.name,
      gate: draft.gate as 'DOCUMENT_SIGN',
      entityType: 'Document',
      outcome: draft.outcome as 'BLOCK',
      message: draft.message,
      conditionConfig,
      priority: 0,
    };

    if (draft.id) {
      // `isActive` is deliberately not sent: editing a rule shouldn't quietly
      // switch a rule that was turned off back on.
      save.mutate({ id: draft.id, ...payload });
      return;
    }

    create.mutate({ ...payload, isActive: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Business Rules</Trans>
          </h2>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
            <Trans>
              Conditions checked at a point in the document lifecycle. A rule's condition describes
              the problem — when it's true, the rule fires and its outcome applies.
            </Trans>
          </p>
        </div>

        {!draft && (
          <Button
            size="sm"
            onClick={() =>
              setDraft({
                name: '',
                gate: 'DOCUMENT_SIGN',
                outcome: 'BLOCK',
                message: '',
                condition: '{\n  "!": [{ "var": "ocr.po_number" }]\n}',
              })
            }
          >
            <PlusIcon className="mr-1.5 h-4 w-4" />
            <Trans>New rule</Trans>
          </Button>
        )}
      </div>

      {/*
        Stated up front because it changes how rules should be written: these
        values come from OCR, and this deployment has a real invoice whose
        po_number read as "Box". A presence check alone will accept that.
      */}
      <div className="flex gap-3 rounded-[var(--r)] border border-status-pending-text/30 bg-status-pending-bg p-3">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-pending-text" />
        <p className="text-[12px] text-status-pending-text">
          <Trans>
            Rules on OCR fields inherit OCR's error rate — a value can be present but misread. Pair
            presence checks with <code>ocr.confidence</code>, and use the tester below before
            switching a rule on.
          </Trans>
        </p>
      </div>

      {draft && (
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="mb-3 text-[13px] font-semibold">
            {draft.id ? <Trans>Edit rule</Trans> : <Trans>New rule</Trans>}
          </h3>

          {/* Presets replace every field, so they're only offered while creating. */}
          {!draft.id && (
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-muted"
                  onClick={() =>
                    setDraft({
                      name: preset.name,
                      gate: preset.gate,
                      outcome: 'BLOCK',
                      message: preset.message,
                      condition: JSON.stringify(preset.condition, null, 2),
                    })
                  }
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={label}>
                <Trans>Name</Trans>
              </label>
              <Input
                className="h-8 text-[13px]"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>
                  <Trans>When</Trans>
                </label>
                <select
                  className={control}
                  value={draft.gate}
                  onChange={(e) => setDraft({ ...draft, gate: e.target.value })}
                >
                  {(catalogue?.gates ?? []).map((g) => (
                    <option key={g.gate} value={g.gate} disabled={UNENFORCED_GATES.has(g.gate)}>
                      {g.label}
                      {UNENFORCED_GATES.has(g.gate) ? ' — not yet enforced' : ''}
                    </option>
                  ))}
                </select>
                {UNENFORCED_GATES.has(draft.gate) && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <Trans>
                      This gate has no enforcement point yet, so a rule saved against it will never
                      run.
                    </Trans>
                  </p>
                )}
              </div>
              <div>
                <label className={label}>
                  <Trans>Then</Trans>
                </label>
                <select
                  className={control}
                  value={draft.outcome}
                  onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
                >
                  <option value="BLOCK">Block the action</option>
                  <option value="WARN">Warn only</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <label className={label}>
              <Trans>Message shown when it fires</Trans>
            </label>
            <Input
              className="h-8 text-[13px]"
              placeholder="This invoice has no PO number. Add one before signing."
              value={draft.message}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <label className={label}>
                <Trans>Condition (JSONLogic) — true means the rule fires</Trans>
              </label>
              <textarea
                className={`${control} h-48 resize-y font-mono text-[12px]`}
                value={draft.condition}
                onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
                spellCheck={false}
              />
            </div>

            {/*
              Generated from the provider registry, so a new provider appears
              here with no change to this file.
            */}
            <div>
              <label className={label}>
                <Trans>Available fields</Trans>
              </label>
              <div className="h-48 overflow-y-auto rounded-[var(--r-sm)] border border-border p-2">
                {(catalogue?.namespaces ?? []).map((ns) => (
                  <div key={ns.namespace} className="mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {ns.label}
                    </p>
                    <ul>
                      {ns.fields.map((f) => (
                        <li key={f.path} className="flex items-baseline justify-between gap-2 py-0.5">
                          <code className="font-mono text-[11px]">{f.path}</code>
                          <span className="text-right text-[10px] text-muted-foreground">
                            {f.type}
                            {f.unreliable && ' · OCR'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              size="sm"
              loading={draft.id ? save.isPending : create.isPending}
              onClick={submitDraft}
            >
              {draft.id ? <Trans>Save changes</Trans> : <Trans>Create rule</Trans>}
            </Button>
          </div>
        </div>
      )}

      {/* Existing rules */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">
            <Trans>Loading...</Trans>
          </p>
        ) : !rules || rules.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ScaleIcon className="mb-3 h-9 w-9 text-muted-foreground opacity-40" />
            <p className="text-[14px] font-medium">
              <Trans>No business rules yet</Trans>
            </p>
            <p className="mt-1 max-w-md text-[12px] text-muted-foreground">
              <Trans>Nothing is enforced until you add one. Start from a preset above.</Trans>
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {rule.name}
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        rule.outcome === 'BLOCK'
                          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : 'bg-status-pending-bg text-status-pending-text'
                      }`}
                    >
                      {rule.outcome}
                    </span>
                    {!rule.isActive && (
                      <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Trans>off</Trans>
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{rule.message}</p>
                  <code className="mt-1 block overflow-x-auto font-mono text-[10px] text-muted-foreground">
                    {rule.gate} · {JSON.stringify(rule.conditionConfig)}
                  </code>
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      setDraft({
                        id: rule.id,
                        name: rule.name,
                        gate: rule.gate,
                        outcome: rule.outcome,
                        message: rule.message,
                        condition: JSON.stringify(rule.conditionConfig, null, 2),
                      })
                    }
                  >
                    <PencilIcon className="mr-1 h-3.5 w-3.5" />
                    <Trans>Edit</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => toggle.mutate({ id: rule.id, isActive: !rule.isActive })}
                  >
                    {rule.isActive ? <Trans>Turn off</Trans> : <Trans>Turn on</Trans>}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-destructive"
                    onClick={() => remove.mutate({ id: rule.id })}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dry run */}
      <div className="rounded-[var(--r)] border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">
          <Trans>Test against a document</Trans>
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          <Trans>
            Evaluates every signing rule against a real document without enforcing anything, and
            shows the data the rules saw.
          </Trans>
        </p>

        <Input
          className="mt-2 h-8 max-w-[220px] text-[13px]"
          placeholder="Document ID"
          value={testDocumentId}
          onChange={(e) => setTestDocumentId(e.target.value.replace(/\D/g, ''))}
        />

        {test.error && <p className="mt-2 text-[12px] text-destructive">{test.error.message}</p>}

        {test.data && (
          <div className="mt-3 space-y-2">
            <p className="text-[12px]">
              <Trans>
                {test.data.document.title} — {test.data.verdict.evaluated} rule(s) evaluated,{' '}
                {test.data.verdict.allowed ? 'would be allowed' : 'would be blocked'}
              </Trans>
            </p>

            {[...test.data.verdict.blocks, ...test.data.verdict.warnings].map((hit) => (
              <p key={hit.ruleId} className="text-[12px]">
                <span className="font-medium">{hit.outcome}</span> · {hit.name}: {hit.message}
              </p>
            ))}

            <details>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                <Trans>Show the data the rules saw</Trans>
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[10px]">
                {JSON.stringify(test.data.context, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function BusinessRulesRoute() {
  return (
    <OrgAdminGuard>
      <BusinessRulesPage />
    </OrgAdminGuard>
  );
}
