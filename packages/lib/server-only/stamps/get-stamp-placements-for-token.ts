import { prisma } from '@documenso/prisma';

export type GetStampPlacementsForTokenOptions = {
  token: string;
};

/**
 * Public-context fetch of stamp placements for a signing recipient. Used by
 * the signing route loader so a recipient can see the stamps the sender has
 * placed on the document before signing. Only returns the minimum needed to
 * render an image overlay (placement geometry + the underlying DocumentData
 * the asset lives in) — never the full Stamp record.
 */
export const getStampPlacementsForToken = async ({ token }: GetStampPlacementsForTokenOptions) => {
  if (!token) return [];

  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: { documentId: true },
  });

  if (!recipient?.documentId) return [];

  const placements = await prisma.documentStampPlacement.findMany({
    where: { documentId: recipient.documentId },
    include: {
      stamp: { select: { id: true, name: true, kind: true, imageAssetId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const assetIds = placements
    .map((p) => p.stamp.imageAssetId)
    .filter((id): id is string => Boolean(id));
  const assets = assetIds.length
    ? await prisma.documentData.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, type: true, data: true },
      })
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return placements.map((p) => ({
    id: p.id,
    pageIndex: p.pageIndex,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    rotation: p.rotation,
    opacity: p.opacity,
    stamp: {
      id: p.stamp.id,
      name: p.stamp.name,
      previewAsset: p.stamp.imageAssetId ? (assetById.get(p.stamp.imageAssetId) ?? null) : null,
    },
  }));
};

export type StampPlacementForToken = Awaited<ReturnType<typeof getStampPlacementsForToken>>[number];
