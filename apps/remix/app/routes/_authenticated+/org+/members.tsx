import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Members');
}

const roleColors: Record<string, string> = {
  ORG_ADMIN: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  DMS_ADMIN: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  TEAM_ADMIN: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  MANAGER: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  MEMBER: 'bg-muted text-muted-foreground',
};

export default function OrgMembersPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('MEMBER');

  const invite = trpc.org.inviteMember.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      setInviteEmail('');
      toast({ title: _(msg`Member invited`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  const updateRole = trpc.org.updateMemberRole.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Role updated`) });
    },
  });

  const remove = trpc.org.removeMember.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      toast({ title: _(msg`Member removed`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading...</div>;

  if (!membership) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <UsersIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p><Trans>Create an organization first.</Trans></p>
      </div>
    );
  }

  const org = membership.organization;
  const isAdmin = membership.role === 'ORG_ADMIN';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold"><Trans>Members</Trans></h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{org.members.length} members in {org.name}</p>
        </div>
      </div>

      {/* Invite form */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="text-[14px] font-semibold mb-3"><Trans>Invite Member</Trans></h3>
          <div className="flex gap-2">
            <Input
              className="h-8 flex-1 text-[13px]"
              placeholder="Email address"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="MEMBER">Member</option>
              <option value="MANAGER">Manager</option>
              <option value="TEAM_ADMIN">Team Admin</option>
              <option value="DMS_ADMIN">DMS Admin</option>
              <option value="ORG_ADMIN">Org Admin</option>
            </select>
            <Button
              size="sm"
              onClick={() => void invite.mutateAsync({ email: inviteEmail, role: inviteRole as never })}
              disabled={!inviteEmail || invite.isPending}
            >
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              Invite
            </Button>
          </div>
        </div>
      )}

      {/* Members list */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Member</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Role</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Joined</th>
              {isAdmin && <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {org.members.map((member) => (
              <tr key={member.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="text-[13px] font-medium">{member.user.name || 'Unnamed'}</p>
                  <p className="text-[11px] text-muted-foreground">{member.user.email}</p>
                </td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <select
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${roleColors[member.role] || roleColors.MEMBER}`}
                      value={member.role}
                      onChange={(e) => void updateRole.mutateAsync({ memberId: member.id, role: e.target.value as never })}
                    >
                      <option value="MEMBER">Member</option>
                      <option value="MANAGER">Manager</option>
                      <option value="TEAM_ADMIN">Team Admin</option>
                      <option value="DMS_ADMIN">DMS Admin</option>
                      <option value="ORG_ADMIN">Org Admin</option>
                    </select>
                  ) : (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${roleColors[member.role] || roleColors.MEMBER}`}>
                      {member.role.replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">
                  {new Date(member.joinedAt).toLocaleDateString()}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[11px] text-destructive"
                      onClick={() => void remove.mutateAsync({ memberId: member.id })}
                    >
                      <Trash2Icon className="h-3 w-3" />
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
