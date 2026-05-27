import { useCallback, useEffect, useState } from 'react';

import { ImageIcon } from 'lucide-react';
import { createPortal } from 'react-dom';

import { PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { getFile } from '@documenso/lib/universal/upload/get-file';
import type { StampPlacementForToken } from '@documenso/lib/server-only/stamps/get-stamp-placements-for-token';

/**
 * Read-only overlay that paints stamps the sender placed onto the document
 * over each PDF page in the signing view. Stamps are non-interactive — the
 * recipient sees them as part of the document but can't move/resize/remove
 * them. They get flattened into the final PDF at seal time.
 */
export const DocumentSigningStampOverlay = ({
  placements,
}: {
  placements: StampPlacementForToken[];
}) => {
  if (!placements || placements.length === 0) return null;
  return (
    <>
      {placements.map((p) => (
        <ReadOnlyStamp key={p.id} placement={p} />
      ))}
    </>
  );
};

const ReadOnlyStamp = ({ placement }: { placement: StampPlacementForToken }) => {
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const calculate = useCallback(() => {
    const $page = window.document.querySelector<HTMLElement>(
      `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${placement.pageIndex + 1}"]`,
    );
    if (!$page) {
      setCoords(null);
      return;
    }
    const rect = $page.getBoundingClientRect();
    setCoords({
      left: rect.left + window.scrollX + (placement.x / 100) * rect.width,
      top: rect.top + window.scrollY + (placement.y / 100) * rect.height,
      width: (placement.width / 100) * rect.width,
      height: (placement.height / 100) * rect.height,
    });
  }, [placement.pageIndex, placement.x, placement.y, placement.width, placement.height]);

  useEffect(() => {
    calculate();
    const retry = window.setTimeout(calculate, 200);
    window.addEventListener('resize', calculate);
    window.addEventListener('scroll', calculate, true);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener('resize', calculate);
      window.removeEventListener('scroll', calculate, true);
    };
  }, [calculate]);

  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const asset = placement.stamp.previewAsset;
    if (!asset) return;
    let revoked: string | null = null;
    let cancelled = false;
    void getFile(asset).then((bytes) => {
      if (cancelled) return;
      const blob = new Blob([bytes], { type: 'image/png' });
      revoked = URL.createObjectURL(blob);
      setSrc(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [placement.stamp.previewAsset]);

  if (!coords) return null;

  return createPortal(
    <div
      style={{
        position: 'absolute',
        left: coords.left,
        top: coords.top,
        width: coords.width,
        height: coords.height,
        zIndex: 20,
        pointerEvents: 'none',
      }}
      className="flex items-center justify-center overflow-hidden"
      aria-hidden
    >
      {src ? (
        <img
          src={src}
          alt={placement.stamp.name}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      ) : (
        <ImageIcon className="text-muted-foreground h-4 w-4" />
      )}
    </div>,
    window.document.body,
  );
};
