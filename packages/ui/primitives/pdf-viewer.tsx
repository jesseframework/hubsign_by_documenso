import React, { useEffect, useMemo, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { DocumentData } from '@prisma/client';
import { Loader, Minus, Plus, RotateCcw } from 'lucide-react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { Document as PDFDocument, Page as PDFPage, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

import { PDF_VIEWER_PAGE_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { getFile } from '@documenso/lib/universal/upload/get-file';

import { cn } from '../lib/utils';
import { useToast } from './use-toast';

export type LoadedPDFDocument = PDFDocumentProxy;

/**
 * This imports the worker from the `pdfjs-dist` package.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

export type OnPDFViewerPageClick = (_event: {
  pageNumber: number;
  numPages: number;
  originalEvent: React.MouseEvent<HTMLDivElement, MouseEvent>;
  pageHeight: number;
  pageWidth: number;
  pageX: number;
  pageY: number;
}) => void | Promise<void>;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_DEFAULT = 1;

const PDFLoader = () => (
  <>
    <Loader className="text-primary h-12 w-12 animate-spin" />

    <p className="text-muted-foreground mt-4">
      <Trans>Loading document...</Trans>
    </p>
  </>
);

export type PDFViewerProps = {
  className?: string;
  documentData: DocumentData;
  onDocumentLoad?: (_doc: LoadedPDFDocument) => void;
  onPageClick?: OnPDFViewerPageClick;
  showZoomControls?: boolean;
  [key: string]: unknown;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onPageClick'>;

export const PDFViewer = ({
  className,
  documentData,
  onDocumentLoad,
  onPageClick,
  showZoomControls = true,
  ...props
}: PDFViewerProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const $el = useRef<HTMLDivElement>(null);

  const [isDocumentBytesLoading, setIsDocumentBytesLoading] = useState(false);
  const [documentBytes, setDocumentBytes] = useState<Uint8Array | null>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pdfError, setPdfError] = useState(false);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);

  const width = containerWidth * zoom;

  const memoizedData = useMemo(
    () => ({ type: documentData.type, data: documentData.data }),
    [documentData.data, documentData.type],
  );

  const isLoading = isDocumentBytesLoading || !documentBytes;

  const onZoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const onZoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  const onZoomReset = () => setZoom(ZOOM_DEFAULT);

  const zoomPercent = Math.round(zoom * 100);

  const onDocumentLoaded = (doc: LoadedPDFDocument) => {
    setNumPages(doc.numPages);
    onDocumentLoad?.(doc);
  };

  const onDocumentPageClick = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>,
    pageNumber: number,
  ) => {
    const $el = event.target instanceof HTMLElement ? event.target : null;

    if (!$el) {
      return;
    }

    const $page = $el.closest(PDF_VIEWER_PAGE_SELECTOR);

    if (!$page) {
      return;
    }

    const { height, width, top, left } = $page.getBoundingClientRect();

    const pageX = event.clientX - left;
    const pageY = event.clientY - top;

    if (onPageClick) {
      void onPageClick({
        pageNumber,
        numPages,
        originalEvent: event,
        pageHeight: height,
        pageWidth: width,
        pageX,
        pageY,
      });
    }
  };

  useEffect(() => {
    if ($el.current) {
      const $current = $el.current;

      const { width } = $current.getBoundingClientRect();

      setContainerWidth(width);

      const onResize = () => {
        const { width } = $current.getBoundingClientRect();

        setContainerWidth(width);
      };

      window.addEventListener('resize', onResize);

      return () => {
        window.removeEventListener('resize', onResize);
      };
    }
  }, []);

  useEffect(() => {
    const fetchDocumentBytes = async () => {
      try {
        setIsDocumentBytesLoading(true);

        const bytes = await getFile(memoizedData);

        setDocumentBytes(bytes);

        setIsDocumentBytesLoading(false);
      } catch (err) {
        console.error(err);

        toast({
          title: _(msg`Error`),
          description: _(msg`An error occurred while loading the document.`),
          variant: 'destructive',
        });
      }
    };

    void fetchDocumentBytes();
  }, [memoizedData, toast]);

  return (
    <div ref={$el} className={cn('relative flex flex-col overflow-hidden', className)} {...props}>
      {/* Zoom controls — top bar */}
      {showZoomControls && !isLoading && numPages > 0 && (
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {numPages} {numPages === 1 ? 'page' : 'pages'}
          </span>

          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
              onClick={onZoomOut}
              disabled={zoom <= ZOOM_MIN}
              title="Zoom out"
            >
              <Minus className="h-3 w-3" />
            </button>

            <button
              type="button"
              className="flex h-6 min-w-[2.5rem] items-center justify-center px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={onZoomReset}
              title="Reset zoom"
            >
              {zoomPercent}%
            </button>

            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
              onClick={onZoomIn}
              disabled={zoom >= ZOOM_MAX}
              title="Zoom in"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div
          className={cn(
            'flex h-[80vh] max-h-[60rem] w-full flex-col items-center justify-center overflow-hidden rounded',
          )}
        >
          <PDFLoader />
        </div>
      ) : (
        <div className={cn('overflow-x-auto', zoom > 1 && 'overflow-x-scroll')}>
          <PDFDocument
            file={documentBytes.buffer}
            className={cn('w-full overflow-hidden rounded', {
              'h-[80vh] max-h-[60rem]': numPages === 0,
            })}
            onLoadSuccess={(d) => onDocumentLoaded(d)}
            onSourceError={() => {
              setPdfError(true);
            }}
            externalLinkTarget="_blank"
            loading={
              <div className="dark:bg-background flex h-[80vh] max-h-[60rem] flex-col items-center justify-center bg-white/50">
                {pdfError ? (
                  <div className="text-muted-foreground text-center">
                    <p>
                      <Trans>Something went wrong while loading the document.</Trans>
                    </p>
                    <p className="mt-1 text-sm">
                      <Trans>Please try again or contact our support.</Trans>
                    </p>
                  </div>
                ) : (
                  <PDFLoader />
                )}
              </div>
            }
            error={
              <div className="dark:bg-background flex h-[80vh] max-h-[60rem] flex-col items-center justify-center bg-white/50">
                <div className="text-muted-foreground text-center">
                  <p>
                    <Trans>Something went wrong while loading the document.</Trans>
                  </p>
                  <p className="mt-1 text-sm">
                    <Trans>Please try again or contact our support.</Trans>
                  </p>
                </div>
              </div>
            }
          >
            {Array(numPages)
              .fill(null)
              .map((_, i) => (
                <div key={i} className="last:-mb-2">
                  <div className="border-border overflow-hidden rounded border will-change-transform">
                    <PDFPage
                      pageNumber={i + 1}
                      width={width}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      loading={() => ''}
                      onClick={(e) => onDocumentPageClick(e, i + 1)}
                    />
                  </div>
                  <p className="text-muted-foreground/80 my-2 text-center text-[11px]">
                    <Trans>
                      Page {i + 1} of {numPages}
                    </Trans>
                  </p>
                </div>
              ))}
          </PDFDocument>
        </div>
      )}

    </div>
  );
};

export default PDFViewer;
