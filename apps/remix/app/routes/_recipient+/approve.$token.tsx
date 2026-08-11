import { useState } from 'react';

import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { Form, useNavigation, useSearchParams } from 'react-router';

import {
  actOnApprovalByToken,
  getApprovalFlowView,
} from '@documenso/lib/server-only/approval/approval-actions';
import { Button } from '@documenso/ui/primitives/button';

import type { Route } from './+types/approve.$token';

export function meta() {
  return [{ title: 'Approval — HubSign' }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const view = await getApprovalFlowView(params.token);
  return { view };
}

export async function action({ params, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');
  const comments = String(formData.get('comments') ?? '').trim() || undefined;

  if (intent !== 'approve' && intent !== 'reject') {
    return { result: { ok: false as const, reason: 'invalid' as const } };
  }

  const result = await actOnApprovalByToken(params.token, intent === 'approve', comments);
  return { result, intent };
}

export default function ApprovePage({ loaderData, actionData }: Route.ComponentProps) {
  const { view } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === 'submitting';

  /*
    The email's two buttons arrive here as ?intent=, which only chooses which
    control is already open — the decision itself still needs a click on this
    page. Mail clients and security scanners prefetch links, and a GET that
    approved a payment would let them do it on the approver's behalf.
  */
  const [searchParams] = useSearchParams();
  const [showReject, setShowReject] = useState(searchParams.get('intent') === 'reject');

  const card = 'mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm';

  // Result of an action just performed.
  if (actionData?.result) {
    const r = actionData.result;
    if (r.ok) {
      const approved = r.decision === 'approved';
      return (
        <div className={card}>
          {approved ? (
            <CheckCircle2Icon className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
          ) : (
            <XCircleIcon className="mx-auto mb-3 h-12 w-12 text-red-500" />
          )}
          <h1 className="text-lg font-semibold">
            {approved ? 'Approved' : 'Rejected'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You {approved ? 'approved' : 'rejected'} “{r.entityTitle}”. Thank you — you can close
            this page.
          </p>
        </div>
      );
    }
    return (
      <div className={card}>
        <XCircleIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Already handled</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This request has already been actioned or the link is no longer valid.
        </p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className={card}>
        <XCircleIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Invalid or expired link</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This approval link is not valid. Please contact the sender.
        </p>
      </div>
    );
  }

  if (!view.actionable) {
    return (
      <div className={card}>
        <CheckCircle2Icon className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Already {view.decision?.toLowerCase() ?? 'handled'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          “{view.entityTitle}” has already been {view.decision?.toLowerCase() ?? 'actioned'}.
        </p>
      </div>
    );
  }

  return (
    <div className={card}>
      <h1 className="text-lg font-semibold">Approval requested</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {view.approverName ? `Hi ${view.approverName}, ` : ''}please review and decide.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-left text-sm">
        <p className="font-medium">{view.entityTitle}</p>
        {view.stepName && <p className="text-xs text-muted-foreground">Step: {view.stepName}</p>}
      </div>

      {!showReject ? (
        <div className="mt-5 flex gap-2">
          <Form method="post" className="flex-1">
            <input type="hidden" name="intent" value="approve" />
            <Button type="submit" className="w-full" disabled={submitting}>
              <CheckCircle2Icon className="mr-1.5 h-4 w-4" />
              Approve
            </Button>
          </Form>
          <Button
            type="button"
            variant="outline"
            className="flex-1 text-destructive"
            onClick={() => setShowReject(true)}
            disabled={submitting}
          >
            <XCircleIcon className="mr-1.5 h-4 w-4" />
            Reject
          </Button>
        </div>
      ) : (
        <Form method="post" className="mt-5 text-left">
          <input type="hidden" name="intent" value="reject" />
          <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <textarea
            name="comments"
            rows={3}
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            placeholder="Why are you rejecting this?"
          />
          <div className="mt-3 flex gap-2">
            <Button type="submit" variant="destructive" className="flex-1" disabled={submitting}>
              Confirm rejection
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setShowReject(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </Form>
      )}
    </div>
  );
}
