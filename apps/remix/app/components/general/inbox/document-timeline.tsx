import { Trans } from '@lingui/react/macro';
import {
  BellIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  EyeIcon,
  InboxIcon,
  MailCheckIcon,
  MailIcon,
  PenLineIcon,
  ScanLineIcon,
  SendIcon,
  UserCogIcon,
  WorkflowIcon,
  XCircleIcon,
} from 'lucide-react';

import { trpc } from '@documenso/trpc/react';

import { formatRelativeTime } from '~/utils/format-relative-time';

/**
 * The document's history, in one column.
 *
 * Merged server-side from the inbox item, the audit log, the reminder log and
 * the workflow runs, then rendered here so the wording can be translated. Every
 * entry is a recorded event with a real timestamp — nothing is inferred to fill
 * a gap, which is why a document that was never sent shows only two or three
 * rows rather than a plausible-looking narrative.
 */

type Kind =
  | 'ARRIVED'
  | 'OCR_COMPLETED'
  | 'OPENED_IN_APP'
  | 'MAILBOX_MARKED_READ'
  | 'SENT_FOR_SIGNATURE'
  | 'SIGNING_REQUEST_EMAILED'
  | 'REMINDER_SENT'
  | 'RECIPIENT_OPENED'
  | 'RECIPIENT_SIGNED'
  | 'RECIPIENT_REJECTED'
  | 'COMPLETED'
  | 'COPY_EMAILED'
  | 'WORKFLOW_RUN'
  | 'FIELD_CORRECTED'
  | 'FIELD_FROM_ATTACHMENT'
  | 'ATTACHMENT_READ';

const ICONS: Record<Kind, typeof InboxIcon> = {
  ARRIVED: InboxIcon,
  OCR_COMPLETED: ScanLineIcon,
  OPENED_IN_APP: EyeIcon,
  MAILBOX_MARKED_READ: MailCheckIcon,
  SENT_FOR_SIGNATURE: SendIcon,
  SIGNING_REQUEST_EMAILED: MailIcon,
  REMINDER_SENT: BellIcon,
  RECIPIENT_OPENED: EyeIcon,
  RECIPIENT_SIGNED: PenLineIcon,
  RECIPIENT_REJECTED: XCircleIcon,
  COMPLETED: CheckCheckIcon,
  COPY_EMAILED: MailIcon,
  WORKFLOW_RUN: WorkflowIcon,
  FIELD_CORRECTED: UserCogIcon,
  FIELD_FROM_ATTACHMENT: ScanLineIcon,
  ATTACHMENT_READ: ScanLineIcon,
};

const TONES: Partial<Record<Kind, string>> = {
  COMPLETED: 'text-emerald-600 dark:text-emerald-400',
  RECIPIENT_SIGNED: 'text-emerald-600 dark:text-emerald-400',
  RECIPIENT_REJECTED: 'text-red-600 dark:text-red-400',
  REMINDER_SENT: 'text-sky-600 dark:text-sky-400',
  SENT_FOR_SIGNATURE: 'text-violet-600 dark:text-violet-400',
  FIELD_CORRECTED: 'text-sky-600 dark:text-sky-400',
  FIELD_FROM_ATTACHMENT: 'text-sky-600 dark:text-sky-400',
};

function Label({
  kind,
  actor,
  detail,
  note,
}: {
  kind: Kind;
  actor: string | null;
  detail: string | null;
  note: string | null;
}) {
  const who = actor ?? '—';

  switch (kind) {
    case 'ARRIVED':
      return detail === 'mail-server' ? (
        <Trans>Email arrived</Trans>
      ) : (
        // Said plainly: without a mail-server date the only time we have is
        // when the poller found it, which lags arrival whenever polling stops.
        <Trans>Email ingested (no mail-server time available)</Trans>
      );
    case 'OCR_COMPLETED':
      return <Trans>OCR finished reading the document</Trans>;
    case 'OPENED_IN_APP':
      return <Trans>Opened in HubSign</Trans>;
    case 'MAILBOX_MARKED_READ':
      return <Trans>Marked read in the mailbox</Trans>;
    case 'SENT_FOR_SIGNATURE':
      return actor ? <Trans>Sent for signature by {who}</Trans> : <Trans>Sent for signature</Trans>;
    case 'SIGNING_REQUEST_EMAILED':
      return <Trans>Signing request emailed to {who}</Trans>;
    case 'REMINDER_SENT':
      return detail === 'MANUAL' ? (
        <Trans>
          Reminder sent to {who} by {note ?? 'a user'}
        </Trans>
      ) : (
        <Trans>Automatic reminder sent to {who}</Trans>
      );
    case 'RECIPIENT_OPENED':
      return <Trans>Opened by {who}</Trans>;
    case 'RECIPIENT_SIGNED':
      return <Trans>Signed by {who}</Trans>;
    case 'RECIPIENT_REJECTED':
      return note ? (
        <Trans>
          Declined by {who} — {note}
        </Trans>
      ) : (
        <Trans>Declined by {who}</Trans>
      );
    case 'COMPLETED':
      return <Trans>Everyone signed — document completed</Trans>;
    case 'COPY_EMAILED':
      return <Trans>Signed copy emailed to {who}</Trans>;
    case 'FIELD_CORRECTED':
      return note ? (
        <Trans>
          {who} set {String(detail ?? 'a field').replace(/_/g, ' ')} to {note}
        </Trans>
      ) : (
        <Trans>{who} corrected {String(detail ?? 'a field').replace(/_/g, ' ')}</Trans>
      );
    case 'FIELD_FROM_ATTACHMENT':
      return (
        <Trans>
          {String(detail ?? 'a field').replace(/_/g, ' ')} taken from the attached “{who}”
          {note ? `: ${note}` : ''}
        </Trans>
      );
    case 'ATTACHMENT_READ':
      return detail === 'failed' ? (
        <Trans>OCR could not read the attachment “{note ?? 'file'}”</Trans>
      ) : (
        <Trans>
          Attachment “{note ?? 'file'}” read by OCR ({who})
        </Trans>
      );
    case 'WORKFLOW_RUN':
      return (
        <Trans>
          Workflow “{note ?? 'workflow'}” {String(detail ?? '').toLowerCase()}
        </Trans>
      );
    default:
      return null;
  }
}

export function DocumentTimeline({ inboxItemId }: { inboxItemId: string }) {
  const { data: events, isLoading } = trpc.inbox.timeline.useQuery({ inboxItemId });

  return (
    <div className="rounded-[var(--r)] border border-border bg-card p-4">
      <h3 className="mb-3 text-[14px] font-semibold">
        <Trans>Timeline</Trans>
      </h3>

      {isLoading ? (
        <p className="py-4 text-[12px] text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : !events || events.length === 0 ? (
        <p className="py-4 text-[12px] text-muted-foreground">
          <Trans>Nothing recorded for this document yet.</Trans>
        </p>
      ) : (
        <ol className="relative space-y-3.5">
          {/*
            The rail stops short of the last marker rather than running past it,
            so the column reads as finished instead of trailing off.
          */}
          <span
            aria-hidden
            className="absolute bottom-3 left-[7px] top-2 w-px bg-border"
            style={{ display: events.length > 1 ? undefined : 'none' }}
          />

          {events.map((event) => {
            const kind = event.kind as Kind;
            const Icon = ICONS[kind] ?? InboxIcon;
            const at = event.at instanceof Date ? event.at : new Date(event.at);

            return (
              <li key={event.id} className="relative flex gap-2.5">
                <span
                  className={`relative z-10 mt-0.5 flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full bg-card ${
                    TONES[kind] ?? 'text-muted-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-snug">
                    <Label kind={kind} actor={event.actor} detail={event.detail} note={event.note} />
                  </p>
                  <p
                    className="text-[11px] text-muted-foreground"
                    title={at.toLocaleString()}
                  >
                    {at.toLocaleString()} · {formatRelativeTime(at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The signing state of the document, said in a sentence. */
export function SigningStatusBanner({
  documentStatus,
  recipients,
  completedAt,
}: {
  documentStatus: string;
  recipients: { name: string; email: string; signingStatus: string }[];
  completedAt: Date | string | null;
}) {
  const rejected = recipients.filter((r) => r.signingStatus === 'REJECTED');
  const signed = recipients.filter((r) => r.signingStatus === 'SIGNED');
  const pending = recipients.filter((r) => r.signingStatus === 'NOT_SIGNED');

  if (rejected.length > 0) {
    return (
      <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950 dark:text-red-300">
        <XCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          <Trans>Declined by {rejected[0].name || rejected[0].email}. Nothing further will be sent.</Trans>
        </span>
      </p>
    );
  }

  // Complete is the state the old copy could not express: it said "has been
  // sent for signature" whether nobody had signed or everybody had.
  if (documentStatus === 'COMPLETED' || (recipients.length > 0 && pending.length === 0)) {
    const at = completedAt ? new Date(completedAt) : null;

    return (
      <p className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          <Trans>Signing complete — all {recipients.length} recipient(s) have signed.</Trans>
          {at && (
            <span className="block opacity-80">
              <Trans>Completed {at.toLocaleString()}</Trans>
            </span>
          )}
        </span>
      </p>
    );
  }

  return (
    <p className="flex items-start gap-2 rounded-md bg-violet-50 px-3 py-2 text-[12px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
      <SendIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>
        <Trans>
          Sent for signature — {signed.length} of {recipients.length} signed, waiting on{' '}
          {pending.map((r) => r.name || r.email).join(', ') || '—'}.
        </Trans>
      </span>
    </p>
  );
}
