import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ClockIcon, PlusIcon, RotateCwIcon, Trash2Icon, UsersIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';
import { OrgAdminGuard } from '~/components/general/org-admin-guard';

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

// `≥1h` rounds down to whole hours ("23h"); under an hour switches to minutes,
// rounded up so a link with seconds left still reads "1m" rather than "0m".
function formatRemaining(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes >= 60) {
    return `${Math.floor(totalMinutes / 60)}h`;
  }
  return `${totalMinutes}m`;
}

/**
 * Countdown to a member's set-password link expiring — only rendered for
 * members still locked out (`mustChangePassword: true`). `null` covers both
 * "no live token" and "already past its expiry", since a stranded member
 * needs the same Resend action either way.
 */
function InviteExpiryBadge({ expiresAt }: { expiresAt: string | Date | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = expiresAt ? new Date(expiresAt).getTime() - now : 0;

  if (remainingMs <= 0) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <ClockIcon className="h-3 w-3" />
        <Trans>Expired</Trans>
      </span>
    );
  }

  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-status-pending-bg px-2 py-0.5 text-[10px] font-medium text-status-pending-text">
      <ClockIcon className="h-3 w-3" />
      {formatRemaining(remainingMs)}
    </span>
  );
}

function OrgMembersPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('MEMBER');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const invite = trpc.org.inviteMember.useMutation({
    onSuccess: (result) => {
      void utils.org.getMyOrganization.invalidate();
      setInviteEmail('');
      setInviteName('');
      setWelcomeMessage('');
      setShowAdvanced(false);
      // Result includes the new member — the backend decides whether to send
      // a welcome (new user) or invite (existing user) email.
      toast({
        title: _(msg`Member invited`),
        description: result?.user
          ? _(msg`An email has been sent to ${result.user.email}.`)
          : undefined,
      });
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

  const resendInvite = trpc.org.resendMemberInvite.useMutation({
    onSuccess: (result) => {
      void utils.org.getMyOrganization.invalidate();
      toast({
        title: _(msg`Invite resent`),
        description: _(msg`A new link was emailed to ${result.email}.`),
      });
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

      {/* Invite / Add member form */}
      {isAdmin && (
        <div className="rounded-[var(--r)] border border-border bg-card p-4">
          <h3 className="text-[14px] font-semibold mb-3"><Trans>Invite or Create Member</Trans></h3>
          <p className="-mt-2 mb-3 text-[11px] text-muted-foreground">
            <Trans>
              If the email matches an existing HubSign user they'll just be added. Otherwise we'll
              create the account and email them a secure link to set their password.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-8 flex-1 min-w-[200px] text-[13px]"
              placeholder="Email address"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Input
              className="h-8 flex-1 min-w-[160px] text-[13px]"
              placeholder="Name (for new users)"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
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
              onClick={() => void invite.mutateAsync({
                email: inviteEmail,
                role: inviteRole as never,
                name: inviteName || undefined,
                welcomeMessage: welcomeMessage || undefined,
              })}
              disabled={!inviteEmail || invite.isPending}
            >
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              Invite
            </Button>
          </div>

          <button
            type="button"
            className="mt-2 text-[11px] text-primary hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '− Hide welcome message' : '+ Add welcome message (optional)'}
          </button>

          {showAdvanced && (
            <div className="mt-2">
              <label className="text-[11px] font-medium text-muted-foreground">
                <Trans>Welcome Message</Trans>
              </label>
              <textarea
                className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                rows={3}
                placeholder="Shown in the welcome email to newly created users."
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                maxLength={2000}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {welcomeMessage.length}/2000 · Only sent to users we're creating (not existing users)
              </p>
            </div>
          )}
        </div>
      )}

      {/*
        Domain-matched accounts that already exist but belong to no organization.
        Deliberately a separate list rather than rows in the members table: these
        people are NOT members yet and must not be counted as such.
      */}
      {isAdmin && <DomainCandidates />}

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
                  {member.user.mustChangePassword && (
                    <InviteExpiryBadge expiresAt={member.inviteExpiresAt} />
                  )}
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
                    <div className="flex justify-end gap-1">
                      {member.user.mustChangePassword && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-[11px]"
                          loading={resendInvite.isPending && resendInvite.variables?.memberId === member.id}
                          disabled={resendInvite.isPending}
                          onClick={() => void resendInvite.mutateAsync({ memberId: member.id })}
                        >
                          <RotateCwIcon className="h-3 w-3" />
                          Resend
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-[11px] text-destructive"
                        onClick={() => void remove.mutateAsync({ memberId: member.id })}
                      >
                        <Trash2Icon className="h-3 w-3" />
                        Remove
                      </Button>
                    </div>
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

/**
 * Existing HubSign accounts on one of the org's configured email domains that
 * aren't in any organization yet — adoptable in one click instead of re-inviting
 * someone who already has an account.
 *
 * Rendered separately from the members table on purpose: "pending" here means
 * *not a member*, and folding them into that table would inflate the member
 * count and imply access they do not have.
 */
const DomainCandidates = () => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.org.listDomainCandidates.useQuery();
  const [roleByUser, setRoleByUser] = useState<Record<number, string>>({});
  const [seatByUser, setSeatByUser] = useState<Record<number, string>>({});

  const convert = trpc.org.convertDomainCandidate.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.org.listDomainCandidates.invalidate(),
        utils.org.getMyOrganization.invalidate(),
      ]);

      // The membership can succeed while the seat fails (no seats left, for
      // instance). Reporting only "added" would hide that they're unlicensed.
      if (result.seat.error) {
        toast({
          title: _(msg`${result.email} added, but no seat was assigned`),
          description: result.seat.error,
          variant: 'destructive',
        });
      } else if (result.seat.assigned) {
        const tier = result.seat.tier ?? 'licensed';
        toast({ title: _(msg`${result.email} added with a ${tier} seat`) });
      } else {
        toast({ title: _(msg`${result.email} added to the organization`) });
      }
    },
    onError: (error) => toast({ title: error.message, variant: 'destructive' }),
  });

  const seatOptions = (data?.seatPlans ?? []).filter((p) => p.available > 0);

  // Nothing configured, or nothing to adopt — stay out of the way entirely.
  if (isLoading || !data || (data.candidates.length === 0 && data.ignoredPublicDomains.length === 0)) {
    return null;
  }

  return (
    <div className="rounded-[var(--r)] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">
            <Trans>Pending from your domains</Trans>
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {data.domains.length > 0 ? (
              <Trans>
                Existing HubSign accounts on {data.domains.join(', ')} that aren't in an
                organization yet.
              </Trans>
            ) : (
              <Trans>No claimable domains are configured.</Trans>
            )}
          </p>
        </div>
      </div>

      {/*
        Said plainly because the constraint is not obvious: domains are not
        verified, so this can only ever offer unaffiliated accounts.
      */}
      {data.ignoredPublicDomains.length > 0 && (
        <p className="mt-2 rounded-[var(--r-sm)] bg-status-pending-bg px-2.5 py-1.5 text-[11px] text-status-pending-text">
          <Trans>
            Ignoring {data.ignoredPublicDomains.join(', ')} — shared mailbox providers can't be
            claimed, since they identify no single organization.
          </Trans>
        </p>
      )}

      {data.candidates.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          <Trans>No unaffiliated accounts found on these domains.</Trans>
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">
                  {candidate.name || candidate.email}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{candidate.email}</p>
                {/*
                  Shown before the click, not after: seating them cancels their
                  own subscription, and that is the admin's decision to make
                  knowingly.
                */}
                {candidate.hasPersonalPlan && (
                  <p className="mt-0.5 text-[11px] text-status-pending-text">
                    <Trans>
                      Has a personal subscription — assigning a seat cancels it (prorated credit).
                    </Trans>
                  </p>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="rounded-full bg-status-pending-bg px-2 py-0.5 text-[10px] font-medium text-status-pending-text">
                  <Trans>Pending</Trans>
                </span>

                <select
                  className="h-7 rounded-[var(--r-sm)] border border-border bg-background px-1.5 text-[12px]"
                  value={seatByUser[candidate.id] ?? ''}
                  onChange={(e) =>
                    setSeatByUser((prev) => ({ ...prev, [candidate.id]: e.target.value }))
                  }
                  aria-label={`Seat for ${candidate.email}`}
                >
                  <option value="">No seat</option>
                  {seatOptions.map((plan) => (
                    <option key={plan.tier} value={plan.tier}>
                      {plan.tier} ({plan.available} left)
                    </option>
                  ))}
                </select>

                <select
                  className="h-7 rounded-[var(--r-sm)] border border-border bg-background px-1.5 text-[12px]"
                  value={roleByUser[candidate.id] ?? 'MEMBER'}
                  onChange={(e) =>
                    setRoleByUser((prev) => ({ ...prev, [candidate.id]: e.target.value }))
                  }
                  aria-label={`Role for ${candidate.email}`}
                >
                  <option value="MEMBER">Member</option>
                  <option value="MANAGER">Manager</option>
                  <option value="TEAM_ADMIN">Team Admin</option>
                  <option value="DMS_ADMIN">DMS Admin</option>
                  <option value="ORG_ADMIN">Org Admin</option>
                </select>

                <Button
                  size="sm"
                  className="h-7 text-[12px]"
                  loading={convert.isPending && convert.variables?.userId === candidate.id}
                  disabled={convert.isPending}
                  onClick={() => {
                    const seatTier = seatByUser[candidate.id] || undefined;

                    convert.mutate({
                      userId: candidate.id,
                      role: (roleByUser[candidate.id] ?? 'MEMBER') as 'MEMBER',
                      seatTier: seatTier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM' | undefined,
                      // Only pre-acknowledged when the admin can actually see the
                      // warning above AND chose to consume a seat, so the
                      // cancellation is never a surprise.
                      acknowledgeCancelPersonalPlan: Boolean(seatTier && candidate.hasPersonalPlan),
                    });
                  }}
                >
                  <Trans>Convert</Trans>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function OrgMembersPageRoute() {
  return (
    <OrgAdminGuard>
      <OrgMembersPage />
    </OrgAdminGuard>
  );
}
