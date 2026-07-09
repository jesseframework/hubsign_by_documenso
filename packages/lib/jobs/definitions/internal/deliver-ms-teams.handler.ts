import { prisma } from '@documenso/prisma';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../../constants/app';
import { resolveMsTeamsEventTarget } from '../../../server-only/ms-teams/event-payload';
import {
  getChannelLinksForEvent,
  postOrUpdateTracker,
  postToChannel,
} from '../../../server-only/ms-teams/deliver';
import { getTransport } from '../../../server-only/ms-teams/transport';
import { renderMilestoneCard } from '../../../universal/ms-teams/cards';
import type { JobRunIO } from '../../client/_internal/job';
import type { TDeliverMsTeamsJobDefinition } from './deliver-ms-teams';

export const run = async ({
  payload,
  io,
}: {
  payload: TDeliverMsTeamsJobDefinition;
  io: JobRunIO;
}) => {
  const { event, organizationId, data } = payload;

  const links = await getChannelLinksForEvent({ organizationId, event });

  if (!links) {
    return;
  }

  const { connection, channels } = links;

  const appUrl = NEXT_PUBLIC_WEBAPP_URL();
  const target = resolveMsTeamsEventTarget(event, data, appUrl);

  if (!target) {
    io.logger.warn(`[ms-teams] ${event} payload carried no renderable document — skipping`);
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  if (!organization) {
    return;
  }

  const transport = getTransport(connection.transport);
  const failures: string[] = [];

  for (const channel of channels) {
    // One task per channel: a channel that already succeeded is memoised, so a
    // retry of this job will not repost to it.
    //
    // The task result is persisted into BackgroundJobTask, so it must be plain
    // JSON — narrow MsTeamsSendResult (whose `body` is `unknown`) down to the
    // two fields we actually need, rather than storing whole Teams responses.
    const outcome = await io.runTask(
      `ms-teams:${channel.id}:${event}`,
      async (): Promise<{ ok: boolean; error: string | null }> => {
        // A live tracker needs a card we can rewrite AND signing progress to show.
        const useTracker = channel.tracker && transport.supportsUpdate && target.trackable;

        const result = useTracker
          ? await postOrUpdateTracker({
              link: channel,
              connection,
              event,
              document: target.document,
              organizationName: organization.name,
              appUrl,
            })
          : await postToChannel({
              link: channel,
              connection,
              event,
              message: renderMilestoneCard({
                event,
                document: target.document,
                organizationName: organization.name,
                appUrl,
                documentUrl: target.documentUrl,
              }),
            });

        return { ok: result.ok, error: result.error ?? null };
      },
    );

    if (!outcome.ok) {
      failures.push(`${channel.name}: ${outcome.error ?? 'unknown error'}`);
    }
  }

  // Every attempt already wrote an MsTeamsDelivery row. Throwing here asks the
  // job provider to retry only the channels that failed — the successful ones
  // replay from their memoised task result.
  if (failures.length > 0) {
    throw new Error(`Teams delivery failed for ${failures.length} channel(s): ${failures.join('; ')}`);
  }
};
