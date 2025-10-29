import { useCallback, useMemo, useRef, useState } from 'react';

import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';

import { PDF_VIEWER_PAGE_SELECTOR } from '../../constants/pdf-viewer';
import { getBoundingClientRect } from '../get-bounding-client-rect';

type PercentCoords = { x: number; y: number };
type PixelCoords = { x: number; y: number; width: number; height: number };

export type UseDraggableFieldPositionOptions = {
  field: FieldWithSignature;
  enabled: boolean;
};

export type UseDraggableFieldPosition = {
  posPercent: PercentCoords;
  toPixels: () => PixelCoords | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => boolean;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function useDraggableFieldPosition(
  options: UseDraggableFieldPositionOptions,
): UseDraggableFieldPosition {
  const { field, enabled } = options;

  const widthPercent = Number(field.width) > 0 ? Number(field.width) : 0;
  const heightPercent = Number(field.height) > 0 ? Number(field.height) : 0;

  const initialPercent = useMemo<PercentCoords>(() => {
    const fx = field.fieldSignedPosition?.fieldSignedPositionX;
    const fy = field.fieldSignedPosition?.fieldSignedPositionY;

    if (fx !== undefined && fx !== null && fy !== undefined && fy !== null) {
      return { x: Number(fx), y: Number(fy) };
    }

    return { x: Number(field.positionX), y: Number(field.positionY) };
  }, [
    field.positionX,
    field.positionY,
    field.fieldSignedPosition?.fieldSignedPositionX,
    field.fieldSignedPosition?.fieldSignedPositionY,
  ]);

  const [posPercent, setPosPercent] = useState<PercentCoords>(initialPercent);
  const isPointerDownRef = useRef(false);
  const didDragRef = useRef(false);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);

  const getPageEl = useCallback((): HTMLElement | null => {
    return document.querySelector<HTMLElement>(
      `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.page}"]`,
    );
  }, [field.page]);

  const toPixels = useCallback((): PixelCoords | null => {
    const $page = getPageEl();
    if (!$page) return null;

    const { top, left, height, width } = getBoundingClientRect($page);

    const xPx = (posPercent.x / 100) * width + left;
    const yPx = (posPercent.y / 100) * height + top;
    const wPx = (widthPercent / 100) * width;
    const hPx = (heightPercent / 100) * height;

    return { x: xPx, y: yPx, width: wPx, height: hPx };
  }, [getPageEl, heightPercent, posPercent.x, posPercent.y, widthPercent]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      isPointerDownRef.current = true;
      didDragRef.current = false;
      startClientRef.current = { x: e.clientX, y: e.clientY };
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !isPointerDownRef.current) return;

      const $page = getPageEl();
      if (!$page) return;

      const { top, left, width, height } = $page.getBoundingClientRect();

      let xPercent = ((e.clientX - left) / width) * 100;
      let yPercent = ((e.clientY - top) / height) * 100;

      xPercent -= widthPercent / 2;
      yPercent -= heightPercent / 2;

      xPercent = clamp(xPercent, 0, Math.max(0, 100 - widthPercent));
      yPercent = clamp(yPercent, 0, Math.max(0, 100 - heightPercent));

      const start = startClientRef.current;
      if (start) {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx > 3 || dy > 3) {
          didDragRef.current = true;
        }
      }

      setPosPercent({ x: xPercent, y: yPercent });

      const el = document.getElementById(`field-${field.id}`);
      if (el?.parentElement) {
        el.parentElement.setAttribute('data-validate', 'true');
        requestAnimationFrame(() => {
          el.parentElement?.setAttribute('data-validate', 'false');
        });
      }
    },
    [enabled, getPageEl, heightPercent, widthPercent, field.id],
  );

  const onPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (!enabled) return false;
      const didDrag = didDragRef.current;
      isPointerDownRef.current = false;
      didDragRef.current = false;
      startClientRef.current = null;
      return didDrag;
    },
    [enabled],
  );

  return {
    posPercent,
    toPixels,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
