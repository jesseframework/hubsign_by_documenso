import type { HTMLAttributes } from 'react';

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { CheckCircle2, Clock, File, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react/dist/lucide-react';

import type { ExtendedDocumentStatus } from '@documenso/prisma/types/extended-document-status';
import { SignatureIcon } from '@documenso/ui/icons/signature';
import { cn } from '@documenso/ui/lib/utils';

type FriendlyStatus = {
  label: MessageDescriptor;
  labelExtended: MessageDescriptor;
  icon?: LucideIcon;
  color: string;
  badgeBg: string;
  badgeText: string;
};

export const FRIENDLY_STATUS_MAP: Record<ExtendedDocumentStatus, FriendlyStatus> = {
  PENDING: {
    label: msg`Pending`,
    labelExtended: msg`Document pending`,
    icon: Clock,
    color: 'text-status-pending-text',
    badgeBg: 'bg-status-pending-bg',
    badgeText: 'text-status-pending-text',
  },
  COMPLETED: {
    label: msg`Completed`,
    labelExtended: msg`Document completed`,
    icon: CheckCircle2,
    color: 'text-status-complete-text',
    badgeBg: 'bg-status-complete-bg',
    badgeText: 'text-status-complete-text',
  },
  DRAFT: {
    label: msg`Draft`,
    labelExtended: msg`Document draft`,
    icon: File,
    color: 'text-status-draft-text',
    badgeBg: 'bg-status-draft-bg',
    badgeText: 'text-status-draft-text',
  },
  REJECTED: {
    label: msg`Rejected`,
    labelExtended: msg`Document rejected`,
    icon: XCircle,
    color: 'text-red-500 dark:text-red-300',
    badgeBg: 'bg-red-50 dark:bg-red-950',
    badgeText: 'text-red-600 dark:text-red-300',
  },
  INBOX: {
    label: msg`Inbox`,
    labelExtended: msg`Document inbox`,
    icon: SignatureIcon,
    color: 'text-status-inbox-text',
    badgeBg: 'bg-status-inbox-bg',
    badgeText: 'text-status-inbox-text',
  },
  ALL: {
    label: msg`All`,
    labelExtended: msg`Document All`,
    color: 'text-muted-foreground',
    badgeBg: 'bg-muted',
    badgeText: 'text-muted-foreground',
  },
};

export type DocumentStatusProps = HTMLAttributes<HTMLSpanElement> & {
  status: ExtendedDocumentStatus;
  inheritColor?: boolean;
  asBadge?: boolean;
};

export const DocumentStatus = ({
  className,
  status,
  inheritColor,
  asBadge,
  ...props
}: DocumentStatusProps) => {
  const { _ } = useLingui();

  const { label, icon: Icon, color, badgeBg, badgeText } = FRIENDLY_STATUS_MAP[status];

  if (asBadge) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
          badgeBg,
          badgeText,
          className,
        )}
        {...props}
      >
        <span
          className={cn('h-[5px] w-[5px] rounded-full opacity-80', {
            'bg-current': true,
          })}
        />
        {_(label)}
      </span>
    );
  }

  return (
    <span className={cn('flex items-center', className)} {...props}>
      {Icon && (
        <Icon
          className={cn('mr-2 inline-block h-4 w-4', {
            [color]: !inheritColor,
          })}
        />
      )}
      {_(label)}
    </span>
  );
};
