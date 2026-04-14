import { Trans } from '@lingui/react/macro';
import { ActivityIcon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Activity Feed');
}

const actionColors: Record<string, string> = {
  DOCUMENT_UPLOADED: 'bg-green-500',
  DOCUMENT_UPDATED: 'bg-blue-500',
  DOCUMENT_DELETED: 'bg-red-500',
  DOCUMENT_CHECKED_OUT: 'bg-amber-500',
  DOCUMENT_CHECKED_IN: 'bg-green-500',
  WORKFLOW_CREATED: 'bg-purple-500',
  WORKFLOW_STEP_APPROVED: 'bg-green-500',
  WORKFLOW_STEP_REJECTED: 'bg-red-500',
  COMMENT_ADDED: 'bg-blue-400',
  VERSION_CREATED: 'bg-indigo-500',
  LABEL_PRINTED: 'bg-gray-500',
  RETRIEVAL_REQUESTED: 'bg-amber-500',
  SHARE_LINK_CREATED: 'bg-purple-400',
  DOCUMENT_LINKED: 'bg-blue-500',
  DISPOSAL_APPROVED_FOR_DISPOSAL: 'bg-red-400',
  DISPOSAL_DISPOSED: 'bg-red-600',
  DISPOSAL_RETAINED: 'bg-green-500',
};

export default function DmsActivityPage() {
  const { data: feed, isLoading } = trpc.dms.getActivityFeed.useQuery({ limit: 100 });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold"><Trans>Activity Feed</Trans></h2>

      <div className="rounded-[var(--r)] border border-border bg-card">
        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">Loading...</div>
        ) : feed && feed.length > 0 ? (
          <div className="relative divide-y divide-border">
            {feed.map((event) => (
              <div key={event.id} className="flex gap-3 px-4 py-3">
                <div className="relative mt-1 flex-shrink-0">
                  <div className={`h-2.5 w-2.5 rounded-full ${actionColors[event.action] || 'bg-gray-400'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-medium">
                      {event.user.name || event.user.email}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {event.action.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </div>
                  {event.document && (
                    <Link
                      to={`/dms/doc/${event.document.id}`}
                      className="mt-0.5 block text-[12px] text-primary hover:underline"
                    >
                      {event.document.title}
                    </Link>
                  )}
                  {event.details && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{event.details}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ActivityIcon className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-[13px]"><Trans>No activity yet</Trans></p>
          </div>
        )}
      </div>
    </div>
  );
}
