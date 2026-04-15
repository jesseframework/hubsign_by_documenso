import { useCallback, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CheckCircleIcon,
  FileTextIcon,
  Loader,
  UploadCloudIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';

import { putPdfFile } from '@documenso/lib/universal/upload/put-file';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Bulk Upload');
}

type UploadItem = {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  documentId?: string;
};

export default function DmsBulkUploadPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [files, setFiles] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Batch metadata (applied to all files)
  const [batchTypeId, setBatchTypeId] = useState('');
  const [batchClassId, setBatchClassId] = useState('');
  const [batchConfidentiality, setBatchConfidentiality] = useState('INTERNAL');
  const [batchFormat, setBatchFormat] = useState('DIGITAL');
  const [batchBinId, setBatchBinId] = useState('');
  const [autoOcr, setAutoOcr] = useState(true);

  const { data: docTypes } = trpc.dms.getDocumentTypes.useQuery();
  const { data: classifications } = trpc.dms.getClassifications.useQuery();
  const { data: locations } = trpc.dms.getLocations.useQuery();

  const createDmsDocument = trpc.dms.createDocument.useMutation();
  const triggerOcr = trpc.dms.triggerOcr.useMutation();

  // Flatten bins
  const allBins: { id: string; path: string }[] = [];
  locations?.forEach((loc) =>
    loc.cabinets.forEach((cab) =>
      cab.shelves.forEach((shelf) =>
        shelf.bins.forEach((bin) =>
          allBins.push({ id: bin.id, path: `${loc.name} › ${cab.name} › ${shelf.name} › ${bin.name}` }),
        ),
      ),
    ),
  );

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newItems: UploadItem[] = acceptedFiles.map((file) => ({
      file,
      status: 'pending' as const,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newItems]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.jpg', '.jpeg', '.png', '.tiff', '.tif'],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
  };

  const handleUploadAll = async () => {
    if (files.length === 0) return;

    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status === 'success') continue;

      // Update status to uploading
      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' as const, progress: 30 } : f)),
      );

      try {
        // Upload file
        const response = await putPdfFile(item.file);

        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 60 } : f)),
        );

        // Create DMS document
        const doc = await createDmsDocument.mutateAsync({
          title: item.file.name.replace(/\.[^.]+$/, ''),
          fileUrl: response.id,
          fileName: item.file.name,
          fileType: item.file.type || 'application/pdf',
          fileSize: item.file.size,
          documentTypeId: batchTypeId || undefined,
          classificationId: batchClassId || undefined,
          confidentiality: batchConfidentiality as 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED',
          format: batchFormat as 'DIGITAL' | 'PHYSICAL' | 'BOTH',
          binId: batchBinId || undefined,
        });

        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 90 } : f)),
        );

        // Queue OCR if enabled
        if (autoOcr) {
          await triggerOcr.mutateAsync({ id: doc.id });
        }

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'success' as const, progress: 100, documentId: doc.id } : f,
          ),
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error' as const, error: err instanceof Error ? err.message : 'Upload failed' }
              : f,
          ),
        );
      }
    }

    setIsUploading(false);

    const successCount = files.filter((f) => f.status === 'success').length + files.filter((f) => f.status === 'pending').length;
    void utils.dms.searchDocuments.invalidate();
    void utils.dms.getDashboardStats.invalidate();

    toast({
      title: `Bulk upload complete`,
      description: `${files.length} files processed`,
      duration: 5000,
    });
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);

  const selectClass = 'h-8 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Bulk Upload</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Upload multiple documents at once. All files will be processed with the same metadata settings.</Trans>
        </p>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-[var(--r)] border-2 border-dashed p-8 text-center transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card hover:border-primary/40'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloudIcon className="mx-auto h-12 w-12 text-muted-foreground/40" />
        <p className="mt-3 text-[14px] font-medium">
          {isDragActive ? (
            <Trans>Drop files here...</Trans>
          ) : (
            <Trans>Drag & drop files here, or click to browse</Trans>
          )}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          <Trans>Supports PDF, JPEG, PNG, TIFF. Upload invoices, receipts, bank statements, or any documents.</Trans>
        </p>
      </div>

      {files.length > 0 && (
        <>
          {/* Batch metadata settings */}
          <div className="rounded-[var(--r)] border border-border bg-card p-4">
            <h3 className="text-[14px] font-semibold mb-3">
              <Trans>Apply to all {files.length} files</Trans>
            </h3>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Document Type</label>
                <select className={`mt-1 w-full ${selectClass}`} value={batchTypeId} onChange={(e) => setBatchTypeId(e.target.value)}>
                  <option value="">Auto-detect</option>
                  {docTypes?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Classification</label>
                <select className={`mt-1 w-full ${selectClass}`} value={batchClassId} onChange={(e) => setBatchClassId(e.target.value)}>
                  <option value="">None</option>
                  {classifications?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Confidentiality</label>
                <select className={`mt-1 w-full ${selectClass}`} value={batchConfidentiality} onChange={(e) => setBatchConfidentiality(e.target.value)}>
                  <option value="PUBLIC">Public</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="CONFIDENTIAL">Confidential</option>
                  <option value="RESTRICTED">Restricted</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Format</label>
                <select className={`mt-1 w-full ${selectClass}`} value={batchFormat} onChange={(e) => setBatchFormat(e.target.value)}>
                  <option value="DIGITAL">Digital</option>
                  <option value="PHYSICAL">Physical</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Filing Location</label>
                <select className={`mt-1 w-full ${selectClass}`} value={batchBinId} onChange={(e) => setBatchBinId(e.target.value)}>
                  <option value="">Unfiled</option>
                  {allBins.map((b) => <option key={b.id} value={b.id}>{b.path}</option>)}
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 pb-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={autoOcr}
                    onChange={(e) => setAutoOcr(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  <span className="font-medium">Auto-OCR after upload</span>
                </label>
              </div>
            </div>
          </div>

          {/* File list */}
          <div className="rounded-[var(--r)] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-[13px]">
                <span className="font-semibold">{files.length} files</span>
                <span className="ml-2 text-muted-foreground">
                  ({(totalSize / 1024 / 1024).toFixed(1)} MB total)
                </span>
                {successCount > 0 && (
                  <span className="ml-2 text-green-600">{successCount} uploaded</span>
                )}
                {errorCount > 0 && (
                  <span className="ml-2 text-red-600">{errorCount} failed</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="text-[12px]" onClick={clearAll} disabled={isUploading}>
                  Clear All
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleUploadAll()}
                  disabled={isUploading || pendingCount === 0}
                >
                  {isUploading ? (
                    <><Loader className="h-3.5 w-3.5 animate-spin" />Uploading...</>
                  ) : (
                    <><UploadCloudIcon className="h-3.5 w-3.5" />Upload {pendingCount} Files</>
                  )}
                </Button>
              </div>
            </div>

            <div className="max-h-[400px] divide-y divide-border overflow-y-auto">
              {files.map((item, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-2.5">
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {item.status === 'success' ? (
                      <CheckCircleIcon className="h-4 w-4 text-green-500" />
                    ) : item.status === 'error' ? (
                      <XCircleIcon className="h-4 w-4 text-red-500" />
                    ) : item.status === 'uploading' ? (
                      <Loader className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <FileTextIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  {/* File info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{item.file.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                      <span>·</span>
                      <span>{item.file.type || 'unknown'}</span>
                      {item.error && (
                        <>
                          <span>·</span>
                          <span className="text-red-500">{item.error}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {(item.status === 'uploading' || item.status === 'success') && (
                    <div className="w-24 flex-shrink-0">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            item.status === 'success' ? 'bg-green-500' : 'bg-primary'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Remove button */}
                  {item.status === 'pending' && (
                    <button
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => removeFile(index)}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
