import { useCallback, useRef, useState } from 'react';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ArrowRight, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router';

import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '@documenso/lib/constants/time-zones';
import { putPdfFile } from '@documenso/lib/universal/upload/put-file';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Doc Merging');
}

/**
 * In-memory representation of a single page from one of the user's uploaded
 * source PDFs. We keep the source file, page index, and a rendered thumbnail
 * data URL so we can render a sortable grid without re-rendering pages on
 * every reorder.
 */
type SourceFile = {
  id: string;
  name: string;
  bytes: ArrayBuffer;
};

type PageItem = {
  id: string; // unique per source-file + pageIndex
  sourceFileId: string;
  pageIndex: number;
  thumbnail: string; // data URL
  width: number;
  height: number;
};

const userTimezone =
  TIME_ZONES.find((tz) => tz === Intl.DateTimeFormat().resolvedOptions().timeZone) ??
  DEFAULT_DOCUMENT_TIME_ZONE;

export default function DocMergePage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [title, setTitle] = useState('Merged document');
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: createDocument } = trpc.document.createDocument.useMutation();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Render the first PDF's first page lazily — we use pdfjs-dist to rasterize each page to a thumbnail. */
  const renderThumbnails = useCallback(async (file: SourceFile): Promise<PageItem[]> => {
    // Use the react-pdf re-export so we share the same worker setup as the
    // rest of the app instead of double-configuring pdfjs.
    const { pdfjs } = await import('react-pdf');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.js',
        import.meta.url,
      ).toString();
    }

    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(file.bytes.slice(0)) });
    const pdf = await loadingTask.promise;
    const items: PageItem[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.4 }); // small for thumbnails
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      items.push({
        id: `${file.id}:${i - 1}`,
        sourceFileId: file.id,
        pageIndex: i - 1,
        thumbnail: canvas.toDataURL('image/png'),
        width: viewport.width,
        height: viewport.height,
      });
    }

    return items;
  }, []);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      setIsProcessingFiles(true);
      try {
        const newSources: SourceFile[] = [];
        for (const f of accepted) {
          if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) continue;
          newSources.push({
            id: crypto.randomUUID(),
            name: f.name,
            bytes: await f.arrayBuffer(),
          });
        }
        if (newSources.length === 0) {
          toast({
            title: _(msg`Only PDF files are supported`),
            variant: 'destructive',
          });
          return;
        }

        const newPages: PageItem[] = [];
        for (const src of newSources) {
          const renderedPages = await renderThumbnails(src);
          newPages.push(...renderedPages);
        }

        setSourceFiles((prev) => [...prev, ...newSources]);
        setPages((prev) => [...prev, ...newPages]);

        if (sourceFiles.length === 0 && newSources.length > 0) {
          // Seed the title from the first uploaded file the first time.
          const first = newSources[0].name.replace(/\.pdf$/i, '');
          setTitle(`${first} (merged)`);
        }
      } catch (err) {
        console.error('[doc-merge] failed to load file:', err);
        toast({
          title: _(msg`Couldn't read that PDF`),
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
      } finally {
        setIsProcessingFiles(false);
      }
    },
    [_, renderThumbnails, sourceFiles.length, toast],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const arr = Array.from(fileList).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (arr.length === 0) {
        toast({ title: _(msg`Only PDF files are supported`), variant: 'destructive' });
        return;
      }
      void onDrop(arr);
    },
    [_, onDrop, toast],
  );

  const onDragOverHandler = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const onDragLeaveHandler = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const onDropHandler = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pages.findIndex((p) => p.id === active.id);
    const newIndex = pages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setPages((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const removePage = (id: string) => setPages((prev) => prev.filter((p) => p.id !== id));

  /** Merge in the chosen page order, upload the merged PDF, create the Document, redirect. */
  const onCreate = async () => {
    if (pages.length === 0) {
      toast({ title: _(msg`Add at least one PDF first`), variant: 'destructive' });
      return;
    }
    if (!title.trim()) {
      toast({ title: _(msg`Pick a title`), variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      const { PDFDocument } = await import('pdf-lib');

      // Cache loaded source PDFs so we don't re-parse for each page.
      const sourceDocs = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
      for (const src of sourceFiles) {
        sourceDocs.set(src.id, await PDFDocument.load(src.bytes.slice(0)));
      }

      const merged = await PDFDocument.create();
      for (const item of pages) {
        const sourceDoc = sourceDocs.get(item.sourceFileId);
        if (!sourceDoc) continue;
        const [copied] = await merged.copyPages(sourceDoc, [item.pageIndex]);
        merged.addPage(copied);
      }

      const mergedBytes = await merged.save();
      const fileName = title.endsWith('.pdf') ? title : `${title}.pdf`;
      const file = new File([new Blob([mergedBytes], { type: 'application/pdf' })], fileName, {
        type: 'application/pdf',
      });

      const documentData = await putPdfFile(file);

      const { id } = await createDocument({
        title: fileName,
        documentDataId: documentData.id,
        timezone: userTimezone,
      });

      toast({ title: _(msg`Document created`), duration: 3000 });
      await navigate(`/documents/${id}/edit`);
    } catch (err) {
      console.error('[doc-merge] create failed:', err);
      toast({
        title: _(msg`Couldn't create the merged document`),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const totalPages = pages.length;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans>Doc Merging</Trans>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          <Trans>
            Upload two or more PDFs, drag pages to reorder them, remove any you don't need, then
            create one merged document and send it for signing.
          </Trans>
        </p>
      </div>

      {/* Upload area — native input + drag/drop, no library */}
      <div
        onDragOver={onDragOverHandler}
        onDragEnter={onDragOverHandler}
        onDragLeave={onDragLeaveHandler}
        onDrop={onDropHandler}
        className={`flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors ${
          isDragOver ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            // reset so picking the same file twice in a row still triggers onChange
            e.target.value = '';
          }}
        />
        {isProcessingFiles ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">
              <Trans>Reading PDFs…</Trans>
            </p>
          </div>
        ) : (
          <>
            <div className="text-muted-foreground flex flex-col items-center gap-2 text-center">
              <Upload className="h-7 w-7" />
              <p className="text-sm">
                {sourceFiles.length === 0 ? (
                  <Trans>Drag PDFs here to start, or click below to pick files.</Trans>
                ) : (
                  <Trans>Add more PDFs to the merge</Trans>
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Trans>Choose PDF files</Trans>
            </Button>
          </>
        )}
      </div>

      {/* Source files list */}
      {sourceFiles.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {sourceFiles.map((s) => {
            const pageCount = pages.filter((p) => p.sourceFileId === s.id).length;
            return (
              <div
                key={s.id}
                className="bg-muted/30 flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <FileText className="text-muted-foreground h-4 w-4" />
                <span className="max-w-[240px] truncate">{s.name}</span>
                <span className="text-muted-foreground text-xs">
                  · {pageCount} <Trans>pages</Trans>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Page grid */}
      {totalPages > 0 && (
        <>
          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-lg font-medium">
              <Trans>Page order</Trans>
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                ({totalPages})
              </span>
            </h2>
            <p className="text-muted-foreground text-xs">
              <Trans>Drag to reorder · click × to remove</Trans>
            </p>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {pages.map((page, index) => (
                  <PageThumbnail
                    key={page.id}
                    page={page}
                    index={index}
                    onRemove={() => removePage(page.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* Footer actions */}
      {totalPages > 0 && (
        <div className="mt-8 flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <Label htmlFor="doc-title" className="text-xs">
              <Trans>Document title</Trans>
            </Label>
            <Input
              id="doc-title"
              className="mt-1 max-w-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isCreating}
            />
          </div>
          <Button onClick={onCreate} loading={isCreating} disabled={totalPages === 0}>
            <Trans>Create signing document</Trans>
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

const PageThumbnail = ({
  page,
  index,
  onRemove,
}: {
  page: PageItem;
  index: number;
  onRemove: () => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-card group relative overflow-hidden rounded-md border"
    >
      <button
        type="button"
        onClick={onRemove}
        className="bg-destructive text-destructive-foreground absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full opacity-0 shadow-md transition-opacity group-hover:opacity-100"
        aria-label="Remove page"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div
        {...attributes}
        {...listeners}
        className="bg-muted/20 flex cursor-grab items-center justify-center p-3 active:cursor-grabbing"
      >
        <img
          src={page.thumbnail}
          alt={`Page ${page.pageIndex + 1}`}
          className="max-h-48 w-auto object-contain shadow-sm"
          draggable={false}
        />
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span className="font-medium">
          <Trans>Page</Trans> {index + 1}
        </span>
      </div>
    </div>
  );
};
