import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, UsersIcon, XIcon } from 'lucide-react';

import {
  type MetadataSigner,
  type MetadataSigningOrder,
  SIGNER_ROLES,
} from '@documenso/lib/universal/metadata-signers';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';

/**
 * The approval chain on a metadata record.
 *
 * A nested table rather than a set of numbered fields, because the number of
 * signers is a property of the vendor, not of the form: a utility needs one, a
 * capital purchase needs four. Position is the signing order, so moving a row is
 * the whole gesture — there is no separate order column to keep in step.
 *
 * The address field offers organization members as you type but does not
 * restrict to them. Both cases are ordinary: an internal approver is a colleague
 * with an account, while the vendor's own signatory is not a user here at all.
 */

const EMPTY_SIGNER: MetadataSigner = { email: '', role: 'SIGNER' };

type Props = {
  signers: MetadataSigner[];
  onChange: (signers: MetadataSigner[]) => void;
  signingOrder: MetadataSigningOrder;
  onSigningOrderChange: (order: MetadataSigningOrder) => void;
};

export function SignerChainEditor({
  signers,
  onChange,
  signingOrder,
  onSigningOrderChange,
}: Props) {
  // Only queried once someone starts typing an address, so opening the form does
  // not fetch the member list for a vendor whose signatory is external anyway.
  const [query, setQuery] = useState('');
  const { data: members } = trpc.org.searchMembers.useQuery(
    { query },
    { enabled: query.trim().length > 1 },
  );

  const update = (index: number, patch: Partial<MetadataSigner>) =>
    onChange(signers.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= signers.length) return;

    const next = [...signers];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const sequential = signingOrder === 'SEQUENTIAL';

  return (
    <div className="rounded-[var(--r-sm)] border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <Trans>Signers</Trans>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {sequential ? (
              <Trans>Asked one at a time, top to bottom. Drag order = signing order.</Trans>
            ) : (
              <Trans>Everyone is asked at the same time.</Trans>
            )}
          </p>
        </div>

        {signers.length > 1 && (
          <div className="flex overflow-hidden rounded-[var(--r-sm)] border border-border">
            {(['SEQUENTIAL', 'PARALLEL'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSigningOrderChange(mode)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  signingOrder === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-muted'
                }`}
              >
                {mode === 'SEQUENTIAL' ? <Trans>In order</Trans> : <Trans>All at once</Trans>}
              </button>
            ))}
          </div>
        )}
      </div>

      {signers.length === 0 ? (
        <p className="py-3 text-center text-[12px] text-muted-foreground">
          <Trans>
            No signers. This vendor gets the confirmation email only — nothing is sent to sign.
          </Trans>
        </p>
      ) : (
        <div className="space-y-1.5">
          {signers.map((signer, index) => (
            <div key={index} className="flex items-start gap-1.5">
              <span className="mt-2 w-4 flex-shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {sequential ? `${index + 1}.` : '•'}
              </span>

              <div className="grid flex-1 gap-1.5 sm:grid-cols-[1fr_1.4fr_auto]">
                <Input
                  className="h-8 text-[13px]"
                  placeholder="Name (optional)"
                  value={signer.name ?? ''}
                  onChange={(e) => update(index, { name: e.target.value })}
                />

                <div>
                  <Input
                    className="h-8 text-[13px]"
                    placeholder="signer@company.com"
                    // A shared datalist would offer one row's suggestions to
                    // every row, so each gets its own.
                    list={`signer-options-${index}`}
                    value={signer.email}
                    onChange={(e) => {
                      update(index, { email: e.target.value });
                      setQuery(e.target.value);
                    }}
                  />
                  <datalist id={`signer-options-${index}`}>
                    {(members ?? []).map((member) => (
                      <option key={member.email} value={member.email}>
                        {member.name ?? member.email}
                      </option>
                    ))}
                  </datalist>
                </div>

                <select
                  className="h-8 rounded-[var(--r-sm)] border border-border bg-background px-2 text-[12px]"
                  value={signer.role}
                  onChange={(e) => update(index, { role: e.target.value as MetadataSigner['role'] })}
                >
                  {SIGNER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-shrink-0 items-center">
                {sequential && (
                  <>
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Move earlier"
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === signers.length - 1}
                      title="Move later"
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onChange(signers.filter((_, i) => i !== index))}
                  title="Remove signer"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[12px]"
          onClick={() => onChange([...signers, { ...EMPTY_SIGNER }])}
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          <Trans>Add signer</Trans>
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <UsersIcon className="h-3 w-3" />
          <Trans>Type to search your organization, or enter any address</Trans>
        </span>
      </div>
    </div>
  );
}
