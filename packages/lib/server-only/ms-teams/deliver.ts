/**
 * Delivery + audit for Microsoft Teams.
 *
 * Every outbound attempt writes an MsTeamsDelivery row — the Teams analogue of
 * WebhookCall — so a silent failure is diagnosable after the fact.
 */
import type { MsTeamsChannelLink, MsTeamsConnection, Prisma } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import type { MsTeamsDocumentSummary, MsTeamsMessage, MsTeamsSendResult } from '../../types/ms-teams';
import { toCardEnvelope } from '../../types/ms-teams';
import { renderTrackerCard } from '../../universal/ms-teams/cards';
import { getTransport } from './transport';

/** Response bodies are remote-controlled and unbounded; cap what we persist. */
const MAX_RECORDED_BODY_CHARS = 4_000;

/** Returns `undefined` for empty bodies so Prisma leaves the nullable column null. */
const truncateBody = (body: unknown): Prisma.InputJsonValue | undefined => {
  if (body === null || body === undefined || body === '') {
    return undefined;
  }

  const serialized = typeof body === 'string' ? body : JSON.stringify(body);

  if (serialized !== undefined && serialized.length <= MAX_RECORDED_BODY_CHARS) {
    return body as Prisma.InputJsonValue;
  }

  return `${(serialized ?? '').slice(0, MAX_RECORDED_BODY_CHARS)}…[truncated]`;
};

const recordDelivery = async ({
  link,
  connection,
  event,
  message,
  result,
}: {
  link: MsTeamsChannelLink;
  connection: Pick<MsTeamsConnection, 'transport'>;
  event: string;
  message: MsTeamsMessage;
  result: MsTeamsSendResult;
}) => {
  await prisma.msTeamsDelivery.create({
    data: {
      channelLinkId: link.id,
      event,
      status: result.ok ? 'SUCCESS' : 'FAILED',
      transport: connection.transport,
      // The envelope only — never `link.webhookUrl`, which is itself a bearer
      // credential for posting into the channel.
      requestBody: toCardEnvelope(message) as unknown as Prisma.InputJsonValue,
      responseCode: result.status,
      responseBody: truncateBody(result.body),
      error: result.error,
    },
  });
};

/**
 * Post a one-shot card (milestone, digest, link prompt) to a channel.
 */
export const postToChannel = async ({
  link,
  connection,
  event,
  message,
}: {
  link: MsTeamsChannelLink;
  connection: Pick<MsTeamsConnection, 'transport'>;
  event: string;
  message: MsTeamsMessage;
}): Promise<MsTeamsSendResult> => {
  const transport = getTransport(connection.transport);
  const result = await transport.post(link, message);

  await recordDelivery({ link, connection, event, message, result });

  return result;
};

/**
 * The live tracker.
 *
 * On a transport that supports updates, the first event posts a card and stores
 * its activity id; every later event rewrites that same card in place. On a
 * transport that does not, each call posts a fresh snapshot — which is why the
 * webhook transport is chattier by nature, not by accident.
 */
export const postOrUpdateTracker = async ({
  link,
  connection,
  event,
  document,
  organizationName,
  appUrl,
}: {
  link: MsTeamsChannelLink;
  connection: Pick<MsTeamsConnection, 'transport'>;
  event: string;
  document: MsTeamsDocumentSummary;
  organizationName: string;
  appUrl: string;
}): Promise<MsTeamsSendResult> => {
  const transport = getTransport(connection.transport);

  const message = renderTrackerCard({
    document,
    organizationName,
    appUrl,
    interactive: transport.supportsUpdate,
    updatedAt: new Date(),
  });

  if (!transport.supportsUpdate) {
    return postToChannel({ link, connection, event, message });
  }

  const existing = await prisma.msTeamsCardRef.findUnique({
    where: { channelLinkId_documentId: { channelLinkId: link.id, documentId: document.id } },
  });

  if (existing) {
    const updated = await transport.update(link, existing.activityId, message);

    if (updated.ok) {
      await prisma.msTeamsCardRef.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });

      await recordDelivery({ link, connection, event, message, result: updated });

      return updated;
    }

    // The card was deleted in Teams (404) or we lost permission to edit it (403).
    // Drop the dangling pointer and fall through to a fresh post rather than
    // failing every subsequent event on this document forever.
    if (updated.status === 404 || updated.status === 403) {
      await prisma.msTeamsCardRef.delete({ where: { id: existing.id } }).catch(() => undefined);
    } else {
      await recordDelivery({ link, connection, event, message, result: updated });

      return updated;
    }
  }

  const posted = await transport.post(link, message);

  await recordDelivery({ link, connection, event, message, result: posted });

  if (posted.ok && posted.activityId && link.conversationId && link.serviceUrl) {
    await prisma.msTeamsCardRef.upsert({
      where: { channelLinkId_documentId: { channelLinkId: link.id, documentId: document.id } },
      create: {
        channelLinkId: link.id,
        documentId: document.id,
        activityId: posted.activityId,
        conversationId: link.conversationId,
        serviceUrl: link.serviceUrl,
      },
      update: {
        activityId: posted.activityId,
        conversationId: link.conversationId,
        serviceUrl: link.serviceUrl,
      },
    });
  }

  return posted;
};

/**
 * Channel links that should receive `event`. An empty `events` array means "all".
 */
export const getChannelLinksForEvent = async ({
  organizationId,
  event,
}: {
  organizationId: number;
  event: string;
}) => {
  const connection = await prisma.msTeamsConnection.findUnique({
    where: { organizationId },
    include: { channels: { where: { enabled: true } } },
  });

  if (!connection || !connection.enabled) {
    return null;
  }

  const channels = connection.channels.filter(
    (channel) => channel.events.length === 0 || channel.events.includes(event),
  );

  if (channels.length === 0) {
    return null;
  }

  return { connection, channels };
};
