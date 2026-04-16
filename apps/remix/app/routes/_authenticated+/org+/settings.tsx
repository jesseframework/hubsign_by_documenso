import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { BuildingIcon, PlusIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Settings');
}

export default function OrgSettingsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');

  const createOrg = trpc.org.create.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Organization created`) });
    },
  });

  const updateOrg = trpc.org.update.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Organization updated`) });
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  }

  // No organization yet — show create form
  if (!membership) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--r)] border border-border bg-card p-6">
          <div className="mx-auto max-w-md text-center">
            <BuildingIcon className="mx-auto mb-4 h-12 w-12 text-primary/30" />
            <h2 className="text-xl font-semibold"><Trans>Create an Organization</Trans></h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Trans>Organizations let you share the Document Manager across your team with role-based permissions.</Trans>
            </p>

            <div className="mt-6 space-y-3 text-left">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Organization Name</label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Acme Corporation"
                  value={createName}
                  onChange={(e) => {
                    setCreateName(e.target.value);
                    setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
                  }}
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">URL Slug</label>
                <Input
                  className="mt-1"
                  placeholder="acme-corp"
                  value={createSlug}
                  onChange={(e) => setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">hubsign.io/org/{createSlug || '...'}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => void createOrg.mutateAsync({ name: createName, slug: createSlug })}
                disabled={!createName || !createSlug || createOrg.isPending}
                loading={createOrg.isPending}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                <Trans>Create Organization</Trans>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const org = membership.organization;
  const isAdmin = membership.role === 'ORG_ADMIN';

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <h2 className="text-[15px] font-semibold"><Trans>Organization Details</Trans></h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <Trans>Manage your organization settings.</Trans>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Name</label>
            <p className="mt-0.5 text-[14px] font-medium">{org.name}</p>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Slug</label>
            <p className="mt-0.5 font-mono text-[13px]">{org.slug}</p>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Your Role</label>
            <p className="mt-0.5 text-[13px] font-medium text-primary">{membership.role.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Domain</label>
            <p className="mt-0.5 text-[13px]">{org.domain || 'Not set'}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Members</span>
          <p className="mt-1 text-2xl font-semibold">{org.members.length}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">DMS Documents</span>
          <p className="mt-1 text-2xl font-semibold">{org._count.dmsDocuments}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Locations</span>
          <p className="mt-1 text-2xl font-semibold">{org._count.dmsLocations}</p>
        </div>
      </div>
    </div>
  );
}
