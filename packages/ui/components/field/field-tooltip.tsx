import { useEffect, useState } from 'react';

import type { Field } from '@prisma/client';
import { TooltipArrow } from '@radix-ui/react-tooltip';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { createPortal } from 'react-dom';

import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
import { useFieldPageCoords } from '@documenso/lib/client-only/hooks/use-field-page-coords';

import { cn } from '../..//lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../..//primitives/tooltip';

const tooltipVariants = cva('font-semibold', {
  variants: {
    color: {
      default: 'border-2 fill-white',
      warning: 'border-0 bg-orange-300 fill-orange-300 text-orange-900',
    },
  },
  defaultVariants: {
    color: 'default',
  },
});

interface FieldToolTipProps extends VariantProps<typeof tooltipVariants> {
  children: React.ReactNode;
  className?: string;
  field: Field;
}

/**
 * Renders a tooltip for a given field.
 */
export function FieldToolTip({ children, color, className = '', field }: FieldToolTipProps) {
  const fallback = useFieldPageCoords(field);
  const [coords, setCoords] = useState(fallback);

  useEffect(() => {
    const maybeEl = document.getElementById(`field-${field.id}`);
    const el: HTMLElement | null = maybeEl instanceof HTMLElement ? maybeEl : null;
    if (!el) {
      setCoords(fallback);
      return;
    }

    const update = () => {
      const targetEl = el.parentElement instanceof HTMLElement ? el.parentElement : el;
      const { top, left, width, height } = getBoundingClientRect(targetEl);
      setCoords({ x: left, y: top, width, height });
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    if (el.parentElement instanceof HTMLElement) ro.observe(el.parentElement);

    const mo = new MutationObserver(() => update());
    mo.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'data-validate'] });
    if (el.parentElement)
      mo.observe(el.parentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-validate'],
      });

    const onResize = () => update();
    const onScroll = () => update();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [field.id]);

  return createPortal(
    <div
      className={cn('pointer-events-none absolute')}
      style={{
        top: `${coords.y}px`,
        left: `${coords.x}px`,
        height: `${coords.height}px`,
        width: `${coords.width}px`,
      }}
    >
      <TooltipProvider>
        <Tooltip
          key={`${field.id}-${coords.x}-${coords.y}-${coords.width}-${coords.height}`}
          delayDuration={0}
          open={!field.inserted || !field.fieldMeta}
        >
          <TooltipTrigger className="absolute inset-0 w-full"></TooltipTrigger>

          <TooltipContent className={tooltipVariants({ color, className })} sideOffset={2}>
            {children}
            <TooltipArrow />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>,
    document.body,
  );
}
