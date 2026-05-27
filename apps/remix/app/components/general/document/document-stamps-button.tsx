import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Check, ImageIcon, Stamp as StampIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';

import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
import { PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { getFile } from '@documenso/lib/universal/upload/get-file';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type DocumentStampsButtonProps = {
  documentId: number;
  /** Disable when the document is already completed/sealed. */
  disabled?: boolean;
};

const DEFAULT_W_PCT = 18;  // ~ 18% of page width
const DEFAULT_H_PCT = 8;   // ~ 8% of page height
const MIN_W_PCT = 5;
const MIN_H_PCT = 3;

type PreviewAsset = { id: string; type: 'S3_PATH' | 'BYTES' | 'BYTES_64'; data: string };

type StampSummary = {
  id: string;
  name: string;
  previewAsset: PreviewAsset | null;
};

type Placement = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stamp: StampSummary;
};

/**
 * Toolbar button + drag-to-place overlay for applying custom stamps onto a
 * document. Coordinates are stored as percentages of each page's dimensions
 * so they survive zoom changes; the seal-time embedder converts them to PDF
 * points (see embed-stamp-on-pdf.ts).
 */
export const DocumentStampsButton = ({ documentId, disabled }: DocumentStampsButtonProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [active, setActive] = useState(false);
  const [armedStampId, setArmedStampId] = useState<string | null>(null);

  const { data: stamps } = trpc.stamp.list.useQuery(undefined, { enabled: active });
  const { data: placements, refetch } = trpc.stamp.listPlacements.useQuery(
    { documentId },
    { enabled: true, refetchOnWindowFocus: false },
  );

  const utils = trpc.useUtils();
  const invalidate = useCallback(
    () => utils.stamp.listPlacements.invalidate({ documentId }),
    [utils, documentId],
  );

  const { mutateAsync: createPlacement } = trpc.stamp.createPlacement.useMutation({
    onSuccess: invalidate,
  });
  const { mutateAsync: updatePlacement } = trpc.stamp.updatePlacement.useMutation({
    onSuccess: invalidate,
  });
  const { mutateAsync: deletePlacement } = trpc.stamp.deletePlacement.useMutation({
    onSuccess: invalidate,
  });

  // Click on the PDF places the armed stamp at that spot.
  useEffect(() => {
    if (!active || !armedStampId) return;

    const onClick = async (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;

      // Ignore mouseups that ended on (or originated from) an existing
      // placement — those are drag/resize gestures, not "click to place".
      if (event.target.closest('[data-stamp-placement]')) return;

      const $page = event.target.closest<HTMLElement>(PDF_VIEWER_PAGE_SELECTOR);
      if (!$page) return;

      const rect = getBoundingClientRect($page);
      const pageNumber = Number($page.getAttribute('data-page-number') ?? '1');
      const pageIndex = Math.max(0, pageNumber - 1);

      // Click position as % of page, centered on cursor.
      const xPct = ((event.pageX - rect.left) / rect.width) * 100 - DEFAULT_W_PCT / 2;
      const yPct = ((event.pageY - rect.top) / rect.height) * 100 - DEFAULT_H_PCT / 2;

      try {
        await createPlacement({
          documentId,
          stampId: armedStampId,
          pageIndex,
          x: clamp(xPct, 0, 100 - DEFAULT_W_PCT),
          y: clamp(yPct, 0, 100 - DEFAULT_H_PCT),
          width: DEFAULT_W_PCT,
          height: DEFAULT_H_PCT,
        });
      } catch (err) {
        toast({
          title: _(msg`Couldn't place stamp`),
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
      }
    };

    window.addEventListener('mouseup', onClick);
    return () => window.removeEventListener('mouseup', onClick);
  }, [active, armedStampId, documentId, createPlacement, toast, _]);

  const placedCount = placements?.length ?? 0;

  return (
    <>
      <Button
        variant={active ? 'default' : 'outline'}
        size="sm"
        disabled={disabled}
        onClick={() => setActive((v) => !v)}
      >
        {active ? <Check className="mr-2 h-4 w-4" /> : <StampIcon className="mr-2 h-4 w-4" />}
        {active ? <Trans>Done</Trans> : <Trans>Stamps</Trans>}
        {!active && placedCount > 0 && (
          <span className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5 text-xs">
            {placedCount}
          </span>
        )}
      </Button>

      {/* Sidebar palette (only when active) */}
      {active && (
        <StampPalette
          stamps={stamps ?? []}
          armedStampId={armedStampId}
          onArm={setArmedStampId}
          onClose={() => {
            setActive(false);
            setArmedStampId(null);
          }}
        />
      )}

      {/* Render every placement as a draggable Rnd over its PDF page. Always
          rendered (even outside active mode) so the user can see what's been
          placed without entering placement mode. */}
      {(placements ?? []).map((p) => (
        <PlacedStamp
          key={p.id}
          placement={p}
          editable={active}
          onMove={async (x, y) => {
            await updatePlacement({ id: p.id, x, y }).catch(() =>
              toast({ title: _(msg`Couldn't move stamp`), variant: 'destructive' }),
            );
          }}
          onResize={async (x, y, width, height) => {
            await updatePlacement({ id: p.id, x, y, width, height }).catch(() =>
              toast({ title: _(msg`Couldn't resize stamp`), variant: 'destructive' }),
            );
          }}
          onDelete={async () => {
            await deletePlacement({ id: p.id }).catch(() =>
              toast({ title: _(msg`Couldn't remove stamp`), variant: 'destructive' }),
            );
          }}
        />
      ))}
    </>
  );
};

/** Floating right-side palette: pick a stamp to arm for placement. */
const StampPalette = ({
  stamps,
  armedStampId,
  onArm,
  onClose,
}: {
  stamps: StampSummary[];
  armedStampId: string | null;
  onArm: (id: string) => void;
  onClose: () => void;
}) => {
  return (
    <div className="bg-card fixed right-4 top-24 z-40 w-64 rounded-lg border p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          <Trans>Pick a stamp, then click on the page</Trans>
        </p>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {stamps.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-center text-xs">
          <ImageIcon className="text-muted-foreground mx-auto h-5 w-5" />
          <p className="text-muted-foreground mt-1">
            <Trans>No stamps yet.</Trans>
          </p>
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
            <a href="/settings/stamps">
              <Trans>Open the library</Trans>
            </a>
          </Button>
        </div>
      ) : (
        <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
          {stamps.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onArm(s.id)}
                className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors ${
                  armedStampId === s.id ? 'bg-primary/10 ring-primary ring-1' : 'hover:bg-muted'
                }`}
              >
                <StampThumbnail asset={s.previewAsset} />
                <span className="truncate">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {armedStampId && (
        <p className="text-muted-foreground mt-3 text-xs">
          <Trans>Click on a page to drop the stamp. Drag corners to resize.</Trans>
        </p>
      )}
    </div>
  );
};

/** Renders a stamp thumbnail by lazy-fetching its underlying asset bytes. */
const StampThumbnail = ({ asset }: { asset: PreviewAsset | null }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
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
  }, [asset]);

  return (
    <div className="bg-muted flex h-8 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded">
      {src ? (
        <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageIcon className="text-muted-foreground h-4 w-4" />
      )}
    </div>
  );
};

/** A placed stamp drawn over its PDF page using react-rnd. */
const PlacedStamp = ({
  placement,
  editable,
  onMove,
  onResize,
  onDelete,
}: {
  placement: Placement;
  editable: boolean;
  onMove: (x: number, y: number) => void | Promise<void>;
  onResize: (x: number, y: number, width: number, height: number) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) => {
  const [coords, setCoords] = useState<{
    pageX: number;
    pageY: number;
    pageWidth: number;
    pageHeight: number;
  } | null>(null);

  // Recompute screen-space rectangle from the PDF page's current bounds.
  // We expose the result as initial values to Rnd via `default` (uncontrolled
  // pattern, mirrored from FieldItem) so Rnd can drive its own drag/resize
  // without React fighting it on every parent render. When external coords
  // genuinely change (zoom, page resize) the `key` is recomputed and Rnd
  // remounts to pick up the new defaults.
  const calculate = useCallback(() => {
    const $page = window.document.querySelector<HTMLElement>(
      `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${placement.pageIndex + 1}"]`,
    );
    if (!$page) {
      setCoords(null);
      return;
    }
    const rect = $page.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const left = rect.left + window.scrollX;
    setCoords({
      pageX: (placement.x / 100) * rect.width + left,
      pageY: (placement.y / 100) * rect.height + top,
      pageWidth: (placement.width / 100) * rect.width,
      pageHeight: (placement.height / 100) * rect.height,
    });
  }, [placement.pageIndex, placement.x, placement.y, placement.width, placement.height]);

  useEffect(() => {
    calculate();
    // If the PDF page wasn't in the DOM yet (race with the viewer mounting),
    // retry once after a tick.
    const retry = window.setTimeout(calculate, 200);
    window.addEventListener('resize', calculate);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener('resize', calculate);
    };
  }, [calculate]);

  if (!coords) return null;

  const bounds = `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${placement.pageIndex + 1}"]`;

  const toPercent = (xPx: number, yPx: number, wPx: number, hPx: number) => {
    const $page = window.document.querySelector<HTMLElement>(bounds);
    if (!$page) return null;
    const rect = $page.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;
    return {
      x: ((xPx - left) / rect.width) * 100,
      y: ((yPx - top) / rect.height) * 100,
      width: (wPx / rect.width) * 100,
      height: (hPx / rect.height) * 100,
    };
  };

  const node = (
    <Rnd
      // Remount when external coords genuinely change (zoom, page resize).
      key={`${coords.pageX}-${coords.pageY}-${coords.pageWidth}-${coords.pageHeight}`}
      default={{
        x: coords.pageX,
        y: coords.pageY,
        width: coords.pageWidth,
        height: coords.pageHeight,
      }}
      bounds={bounds}
      disableDragging={!editable}
      enableResizing={editable}
      resizeHandleStyles={{
        bottom: { bottom: -8, cursor: 'ns-resize' },
        top: { top: -8, cursor: 'ns-resize' },
        left: { cursor: 'ew-resize' },
        right: { cursor: 'ew-resize' },
      }}
      onDragStop={(_e, d) => {
        const pct = toPercent(d.x, d.y, coords.pageWidth, coords.pageHeight);
        if (!pct) return;
        void onMove(
          clamp(pct.x, 0, 100 - placement.width),
          clamp(pct.y, 0, 100 - placement.height),
        );
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        const pct = toPercent(pos.x, pos.y, ref.offsetWidth, ref.offsetHeight);
        if (!pct) return;
        void onResize(
          clamp(pct.x, 0, 100 - pct.width),
          clamp(pct.y, 0, 100 - pct.height),
          Math.max(MIN_W_PCT, pct.width),
          Math.max(MIN_H_PCT, pct.height),
        );
      }}
      className={editable ? 'z-30' : 'z-20'}
    >
      <div
        data-stamp-placement={placement.id}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm ${
          editable
            ? 'border-primary bg-primary/5 cursor-move border-2 border-dashed'
            : 'border-primary/40 pointer-events-none border'
        }`}
      >
        <StampThumbnail asset={placement.stamp.previewAsset} />
        {editable && (
          <button
            type="button"
            // Stop drag/click events from propagating to Rnd so the click
            // registers as a delete instead of starting a drag.
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void onDelete();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full shadow-md transition-colors"
            aria-label="Remove stamp"
            title="Remove stamp"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </Rnd>
  );

  return createPortal(node, window.document.body);
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
