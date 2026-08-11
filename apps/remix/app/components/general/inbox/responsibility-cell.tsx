import { Trans } from '@lingui/react/macro';
import { BellIcon, CheckCheckIcon, CircleSlashIcon, UserIcon, XCircleIcon } from 'lucide-react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@documenso/ui/primitives/hover-card';

import { formatRelativeTime } from '~/utils/format-relative-time';

/**
 * "Who is this waiting on, and how hard have we chased them."
 *
 * The signature badge next to the invoice number already says how many people
 * have signed. What it cannot say is which person the document is actually
 * sitting with, which is the thing someone working the queue needs in order to
 * pick up a phone.
 */

type ReminderEntry = {
  sentAt: Date | string;
  kind: 'AUTOMATIC' | 'MANUAL';
  sentBy: string | null;
};

type Recipient = {
  recipientId: number;
  name: string;
  email: string;
  role: string;
  signingOrder: number | null;
  signingStatus: string;
  sendStatus: string;
  signedAt: Date | string | null;
  reminders: {
    total: number;
    timestamps: ReminderEntry[];
    untimestamped: number;
    older: number;
    lastAt: Date | string | null;
  };
};

export type Responsibility = {
  signingOrder: 'SEQUENTIAL' | 'PARALLEL';
  recipients: Recipient[];
  awaiting: Recipient[];
  reminderTotal: number;
  lastReminderAt: Date | string | null;
};

const roleLabel = (role: string) => role.toLowerCase();

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

const fullTimestamp = (value: Date | string) => asDate(value).toLocaleString();

export function ResponsibilityCell({
  responsibility,
  documentStatus,
}: {
  responsibility: Responsibility | null;
  documentStatus: string;
}) {
  // No recipients at all — the invoice has been read but nobody has been asked
  // to sign it yet. That is a real and common state in this queue (most items
  // sit here until someone reviews them), so it gets a plain label rather than
  // an empty cell that reads like missing data.
  if (!responsibility || responsibility.recipients.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <CircleSlashIcon className="h-3 w-3" />
        <Trans>Not sent for signature</Trans>
      </span>
    );
  }

  const { awaiting, recipients, signingOrder, reminderTotal } = responsibility;
  const rejected = recipients.filter((r) => r.signingStatus === 'REJECTED');
  const position = awaiting[0]?.signingOrder ?? null;

  return (
    <div className="space-y-1">
      {rejected.length > 0 ? (
        <div className="flex items-start gap-1.5">
          <XCircleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-red-700 dark:text-red-400">
              {rejected[0].name || rejected[0].email}
            </p>
            <p className="text-[11px] text-muted-foreground">
              <Trans>declined to sign</Trans>
            </p>
          </div>
        </div>
      ) : awaiting.length === 0 ? (
        <div className="flex items-start gap-1.5">
          <CheckCheckIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium">
              <Trans>Everyone has signed</Trans>
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {recipients.map((r) => r.name || r.email).join(', ')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          <UserIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-600" />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium" title={awaiting[0].email}>
              {awaiting[0].name || awaiting[0].email}
            </p>
            {awaiting[0].name && (
              <p className="truncate text-[11px] text-muted-foreground">{awaiting[0].email}</p>
            )}
            <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
              <span className="rounded-full bg-muted px-1.5 py-px font-medium capitalize">
                {roleLabel(awaiting[0].role)}
              </span>
              {signingOrder === 'SEQUENTIAL' && position !== null && (
                <span>
                  <Trans>
                    step {position} of {recipients.length}
                  </Trans>
                </span>
              )}
              {signingOrder === 'PARALLEL' && awaiting.length > 1 && (
                <span>
                  <Trans>+{awaiting.length - 1} more in parallel</Trans>
                </span>
              )}
              {/*
                A recipient who has not been emailed yet cannot be blamed for
                not signing — worth distinguishing from someone ignoring us.
              */}
              {awaiting[0].sendStatus === 'NOT_SENT' && (
                <span className="text-amber-600 dark:text-amber-400">
                  <Trans>not emailed yet</Trans>
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      <ReminderSummary responsibility={responsibility} />

      {/*
        Documents that were never sent have no recipients at all and are handled
        above, so a DRAFT reaching here means recipients exist but the send has
        not happened — worth saying, because the reminder count will be zero for
        a reason that has nothing to do with anyone being slow.
      */}
      {documentStatus === 'DRAFT' && reminderTotal === 0 && (
        <p className="text-[10px] text-muted-foreground">
          <Trans>draft — not yet distributed</Trans>
        </p>
      )}
    </div>
  );
}

function ReminderSummary({ responsibility }: { responsibility: Responsibility }) {
  const { recipients, reminderTotal, lastReminderAt } = responsibility;

  if (reminderTotal === 0) {
    return null;
  }

  const untimestamped = recipients.reduce((sum, r) => sum + r.reminders.untimestamped, 0);

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:hover:bg-sky-900"
        >
          <BellIcon className="h-3 w-3" />
          <Trans>{reminderTotal} reminder(s)</Trans>
          {lastReminderAt && (
            <span className="font-normal opacity-80">· {formatRelativeTime(asDate(lastReminderAt))}</span>
          )}
        </button>
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-80 p-3 text-[12px]">
        <p className="mb-2 font-semibold">
          <Trans>Reminders sent</Trans>
        </p>

        <div className="max-h-72 space-y-3 overflow-auto">
          {recipients
            .filter((r) => r.reminders.total > 0)
            .map((recipient) => (
              <div key={recipient.recipientId}>
                <p className="mb-1 truncate font-medium" title={recipient.email}>
                  {recipient.name || recipient.email}
                </p>
                <ul className="space-y-0.5">
                  {recipient.reminders.timestamps.map((entry, index) => (
                    <li
                      key={`${recipient.recipientId}-${index}`}
                      className="flex items-baseline justify-between gap-2 text-muted-foreground"
                    >
                      <span className="tabular-nums">{fullTimestamp(entry.sentAt)}</span>
                      <span className="flex-shrink-0 text-[10px] uppercase tracking-wide opacity-70">
                        {entry.kind === 'MANUAL' ? (
                          <Trans>by {entry.sentBy ?? 'a user'}</Trans>
                        ) : (
                          <Trans>automatic</Trans>
                        )}
                      </span>
                    </li>
                  ))}
                  {recipient.reminders.older > 0 && (
                    <li className="text-[11px] text-muted-foreground/70">
                      <Trans>+{recipient.reminders.older} older, not shown</Trans>
                    </li>
                  )}
                </ul>
              </div>
            ))}
        </div>

        {/*
          Said plainly rather than hidden. Before the reminder log existed only
          the most recent send was kept per recipient, so for anyone reminded
          more than once back then the earlier dates are simply gone. A tooltip
          listing one date beside a count of two, with no explanation, would
          read as a bug.
        */}
        {untimestamped > 0 && (
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            <Trans>
              {untimestamped} earlier send(s) were made before reminder times were recorded, so only
              the most recent one per person has a date.
            </Trans>
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
