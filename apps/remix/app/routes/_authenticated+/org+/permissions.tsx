import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CheckIcon, PlusIcon, ShieldIcon, XIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';
import { OrgAdminGuard } from '~/components/general/org-admin-guard';

export function meta() {
  return appMetaTags('DMS Permissions');
}

const ALL_ACTIONS = [
  { value: 'DMS_VIEW', label: 'View Documents' },
  { value: 'DMS_UPLOAD', label: 'Upload Documents' },
  { value: 'DMS_DOWNLOAD', label: 'Download Documents' },
  { value: 'DMS_EDIT', label: 'Edit Documents' },
  { value: 'DMS_DELETE', label: 'Delete Documents' },
  { value: 'DMS_MANAGE_FILING', label: 'Manage Filing Structure' },
  { value: 'DMS_MANAGE_TYPES', label: 'Manage Document Types' },
  { value: 'DMS_APPROVE_WORKFLOWS', label: 'Approve Workflows' },
  { value: 'DMS_APPROVE_RETRIEVALS', label: 'Approve Retrievals' },
  { value: 'DMS_MANAGE_RETENTION', label: 'Manage Retention' },
  { value: 'DMS_EXPORT', label: 'Export Data' },
  { value: 'DMS_VIEW_AUDIT_TRAIL', label: 'View Audit Trail' },
];

function OrgPermissionsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: membership } = trpc.org.getMyOrganization.useQuery();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const { data: permissions } = trpc.org.getMemberPermissions.useQuery(
    { memberId: selectedMemberId! },
    { enabled: !!selectedMemberId },
  );

  const grant = trpc.org.grantPermission.useMutation({
    onSuccess: () => {
      void utils.org.getMemberPermissions.invalidate();
      toast({ title: _(msg`Permission granted`) });
    },
  });

  const revoke = trpc.org.revokePermission.useMutation({
    onSuccess: () => {
      void utils.org.getMemberPermissions.invalidate();
      toast({ title: _(msg`Permission revoked`) });
    },
  });

  if (!membership) {
    return <div className="py-12 text-center text-muted-foreground"><Trans>Create an organization first.</Trans></div>;
  }

  const isAdmin = membership.role === 'ORG_ADMIN' || membership.role === 'DMS_ADMIN';
  const org = membership.organization;

  const selectedMember = org.members.find((m) => m.id === selectedMemberId);
  const grantedActions = new Set<string>(permissions?.map((p) => p.action) || []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>DMS Permissions</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Manage Document Manager permissions for each member. Select a member to configure their access.</Trans>
        </p>
      </div>

      <div className="flex gap-4">
        {/* Member list */}
        <div className="w-[220px] flex-shrink-0 rounded-[var(--r)] border border-border bg-card p-2">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">Members</p>
          {org.members.map((member) => (
            <button
              key={member.id}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                selectedMemberId === member.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
              }`}
              onClick={() => setSelectedMemberId(member.id)}
            >
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                {(member.user.name || member.user.email)[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium">{member.user.name || member.user.email}</p>
                <p className="text-[10px] text-muted-foreground">{member.role.replace(/_/g, ' ')}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Permission matrix */}
        <div className="flex-1 rounded-[var(--r)] border border-border bg-card p-4">
          {selectedMember ? (
            <>
              <h3 className="text-[14px] font-semibold">
                Permissions for {selectedMember.user.name || selectedMember.user.email}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Role: {selectedMember.role.replace(/_/g, ' ')} · Toggle individual permissions below
              </p>

              <div className="mt-4 space-y-1.5">
                {ALL_ACTIONS.map((action) => {
                  const hasPermission = grantedActions.has(action.value);
                  const permission = permissions?.find((p) => p.action === action.value);

                  return (
                    <div key={action.value} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <span className="text-[13px]">{action.label}</span>
                      {isAdmin ? (
                        <button
                          className={`flex h-6 w-6 items-center justify-center rounded ${
                            hasPermission
                              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                              : 'bg-muted text-muted-foreground'
                          }`}
                          onClick={() => {
                            if (hasPermission && permission) {
                              void revoke.mutateAsync({ permissionId: permission.id });
                            } else {
                              void grant.mutateAsync({ memberId: selectedMemberId!, action: action.value as 'DMS_VIEW' });
                            }
                          }}
                        >
                          {hasPermission ? <CheckIcon className="h-3.5 w-3.5" /> : <XIcon className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <span className={`text-[11px] font-medium ${hasPermission ? 'text-green-600' : 'text-muted-foreground'}`}>
                          {hasPermission ? 'Granted' : 'Denied'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShieldIcon className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-[13px]"><Trans>Select a member to manage their DMS permissions</Trans></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function OrgPermissionsPageRoute() {
  return (
    <OrgAdminGuard roles={['ORG_ADMIN', 'DMS_ADMIN']}>
      <OrgPermissionsPage />
    </OrgAdminGuard>
  );
}
