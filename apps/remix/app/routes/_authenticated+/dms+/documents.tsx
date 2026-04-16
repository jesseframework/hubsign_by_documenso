import { useEffect, useRef, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  CheckSquareIcon,
  DownloadIcon,
  FileTextIcon,
  FolderInputIcon,
  Loader,
  MoreHorizontalIcon,
  SearchIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { putDmsFile } from '@documenso/lib/universal/upload/put-dms-file';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@documenso/ui/primitives/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('DMS Documents');
}

export default function DmsDocumentsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  // Upload state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTypeId, setUploadTypeId] = useState('');
  const [uploadClassId, setUploadClassId] = useState('');
  const [uploadConfidentiality, setUploadConfidentiality] = useState('INTERNAL');
  const [uploadFormat, setUploadFormat] = useState('DIGITAL');
  const [uploadRetentionDate, setUploadRetentionDate] = useState('');
  const [uploadBinId, setUploadBinId] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open upload dialog when prefillBin is in URL (from filing structure)
  const prefillBin = searchParams.get('prefillBin');
  useEffect(() => {
    if (prefillBin) {
      setUploadBinId(prefillBin);
      // Trigger file picker
      setTimeout(() => fileInputRef.current?.click(), 300);
      // Clean the URL
      const params = new URLSearchParams(searchParams);
      params.delete('prefillBin');
      setSearchParams(params, { replace: true });
    }
  }, [prefillBin]);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const page = Number(searchParams.get('page')) || 1;
  const status = searchParams.get('status') || undefined;
  const filterBinId = searchParams.get('binId') || undefined;

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.dms.searchDocuments.useQuery({
    query: searchQuery || undefined,
    status: status as 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | undefined,
    binId: filterBinId,
    page,
    perPage: 20,
  });

  const { data: docTypes } = trpc.dms.getDocumentTypes.useQuery();
  const { data: classifications } = trpc.dms.getClassifications.useQuery();
  const { data: locations } = trpc.dms.getLocations.useQuery();

  const createDmsDocument = trpc.dms.createDocument.useMutation({
    onSuccess: () => {
      void utils.dms.searchDocuments.invalidate();
      void utils.dms.getDashboardStats.invalidate();
    },
  });

  const updateDocument = trpc.dms.updateDocument.useMutation({
    onSuccess: () => void utils.dms.searchDocuments.invalidate(),
  });

  const deleteDocument = trpc.dms.deleteDocument.useMutation({
    onSuccess: () => {
      void utils.dms.searchDocuments.invalidate();
      toast({ title: _(msg`Document deleted`) });
    },
  });

  // Flatten bins from locations tree
  // Build grouped location options for the dropdown
  type BinOption = { id: string; path: string; location: string; cabinet: string; shelf: string; bin: string };
  const allBins: BinOption[] = [];
  locations?.forEach((loc) => {
    if (loc.cabinets.length === 0) return;
    loc.cabinets.forEach((cab) => {
      if (cab.shelves.length === 0) return;
      cab.shelves.forEach((shelf) => {
        if (shelf.bins.length === 0) return;
        shelf.bins.forEach((bin) => {
          allBins.push({
            id: bin.id,
            path: `${loc.name} › ${cab.name} › ${shelf.name} › ${bin.name}`,
            location: loc.name,
            cabinet: cab.name,
            shelf: shelf.name,
            bin: bin.name,
          });
        });
      });
    });
  });

  // Group bins by location for the select dropdown
  const binsByLocation = allBins.reduce<Record<string, BinOption[]>>((acc, bin) => {
    if (!acc[bin.location]) acc[bin.location] = [];
    acc[bin.location].push(bin);
    return acc;
  }, {});

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setUploadFiles(Array.from(files));
      setUploadTitle(files[0].name.replace(/\.[^.]+$/, ''));
      setIsUploadOpen(true);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;

    try {
      setIsUploading(true);

      for (const file of uploadFiles) {
        const response = await putDmsFile(file);

        await createDmsDocument.mutateAsync({
          title: uploadFiles.length === 1 ? (uploadTitle || file.name) : file.name.replace(/\.[^.]+$/, ''),
          description: uploadDescription || undefined,
          fileUrl: response.id,
          fileName: file.name,
          fileType: file.type || 'application/pdf',
          fileSize: file.size,
          documentTypeId: uploadTypeId || undefined,
          classificationId: uploadClassId || undefined,
          confidentiality: uploadConfidentiality as 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED',
          format: uploadFormat as 'DIGITAL' | 'PHYSICAL' | 'BOTH',
          binId: uploadBinId || undefined,
          retentionDate: uploadRetentionDate || undefined,
        });
      }

      toast({
        title: _(msg`Document${uploadFiles.length > 1 ? 's' : ''} uploaded`),
        description: _(msg`${uploadFiles.length} document${uploadFiles.length > 1 ? 's' : ''} uploaded to Document Manager.`),
        duration: 5000,
      });

      resetUploadForm();
    } catch (err) {
      toast({
        title: _(msg`Upload failed`),
        description: _(msg`An error occurred while uploading.`),
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const resetUploadForm = () => {
    setIsUploadOpen(false);
    setUploadFiles([]);
    setUploadTitle('');
    setUploadDescription('');
    setUploadTypeId('');
    setUploadClassId('');
    setUploadConfidentiality('INTERNAL');
    setUploadFormat('DIGITAL');
    setUploadRetentionDate('');
    setUploadBinId('');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!data?.data) return;
    if (selectedIds.size === data.data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.data.map((d) => d.id)));
    }
  };

  const bulkArchive = async () => {
    for (const id of selectedIds) {
      await updateDocument.mutateAsync({ id, status: 'ARCHIVED' });
    }
    setSelectedIds(new Set());
    toast({ title: _(msg`${selectedIds.size} documents archived`) });
  };

  const bulkDelete = async () => {
    for (const id of selectedIds) {
      await deleteDocument.mutateAsync({ id });
    }
    setSelectedIds(new Set());
  };

  const statusFilters = [
    { value: undefined, label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'ARCHIVED', label: 'Archived' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'UNDER_REVIEW', label: 'Under Review' },
  ];

  const selectClass = 'h-8 rounded-md border border-border bg-background px-2 text-[13px] text-foreground outline-none';

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.tif,.tiff"
        className="hidden"
        multiple
        onChange={handleFileSelect}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          <Trans>Documents</Trans>
        </h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <span className="text-[12px] text-muted-foreground">{selectedIds.size} selected</span>
              <Button size="sm" variant="secondary" className="gap-1.5 text-[12px]" onClick={() => void bulkArchive()}>
                <FolderInputIcon className="h-3 w-3" />
                Archive
              </Button>
              <Button size="sm" variant="secondary" className="gap-1.5 text-[12px] text-destructive" onClick={() => void bulkDelete()}>
                <Trash2Icon className="h-3 w-3" />
                Delete
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon className="h-3.5 w-3.5" />
            <Trans>Upload</Trans>
          </Button>
        </div>
      </div>

      {/* ═══ Upload Dialog ═══ */}
      <Dialog open={isUploadOpen} onOpenChange={(open) => { if (!open) resetUploadForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>Upload Document{uploadFiles.length > 1 ? 's' : ''}</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
            {/* File list */}
            {uploadFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2.5">
                <FileTextIcon className="h-6 w-6 flex-shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setUploadFiles((f) => f.filter((_, idx) => idx !== i));
                    if (uploadFiles.length <= 1) resetUploadForm();
                  }}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Title (single file only) */}
            {uploadFiles.length === 1 && (
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Title</label>
                <Input className="mt-1 h-8 text-[13px]" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Description</label>
              <Input className="mt-1 h-8 text-[13px]" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Optional description..." />
            </div>

            {/* Two-column metadata */}
            <div className="grid grid-cols-2 gap-3">
              {/* Document Type */}
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Document Type</label>
                <select className={`mt-1 w-full ${selectClass}`} value={uploadTypeId} onChange={(e) => setUploadTypeId(e.target.value)}>
                  <option value="">Select type...</option>
                  {docTypes?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* Classification */}
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Classification</label>
                <select className={`mt-1 w-full ${selectClass}`} value={uploadClassId} onChange={(e) => setUploadClassId(e.target.value)}>
                  <option value="">Select classification...</option>
                  {classifications?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Confidentiality */}
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Confidentiality</label>
                <select className={`mt-1 w-full ${selectClass}`} value={uploadConfidentiality} onChange={(e) => setUploadConfidentiality(e.target.value)}>
                  <option value="PUBLIC">Public</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="CONFIDENTIAL">Confidential</option>
                  <option value="RESTRICTED">Restricted</option>
                </select>
              </div>

              {/* Format */}
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Document Format</label>
                <select className={`mt-1 w-full ${selectClass}`} value={uploadFormat} onChange={(e) => setUploadFormat(e.target.value)}>
                  <option value="DIGITAL">Digital Only</option>
                  <option value="PHYSICAL">Physical Only</option>
                  <option value="BOTH">Physical + Digital</option>
                </select>
              </div>

              {/* Retention Date */}
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Retention Until</label>
                <Input
                  type="date"
                  className={`mt-1 ${selectClass}`}
                  value={uploadRetentionDate}
                  onChange={(e) => setUploadRetentionDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                />
              </div>

              {/* Filing Location */}
              <div className="col-span-2">
                <label className="text-[12px] font-medium text-muted-foreground">Filing Location</label>
                {allBins.length > 0 ? (
                  <select className={`mt-1 w-full ${selectClass}`} value={uploadBinId} onChange={(e) => setUploadBinId(e.target.value)}>
                    <option value="">No location (unfiled)</option>
                    {Object.entries(binsByLocation).map(([locationName, bins]) => (
                      <optgroup key={locationName} label={locationName}>
                        {bins.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.cabinet} › {b.shelf} › {b.bin}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <div className="mt-1 rounded-md border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
                    No filing locations set up.{' '}
                    <Link to="/dms/filing" className="text-primary hover:underline" onClick={() => setIsUploadOpen(false)}>
                      Create locations first
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={resetUploadForm} disabled={isUploading}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={() => void handleUpload()} disabled={uploadFiles.length === 0 || isUploading}>
              {isUploading ? (
                <><Loader className="mr-2 h-3.5 w-3.5 animate-spin" /><Trans>Uploading...</Trans></>
              ) : (
                <><UploadIcon className="mr-2 h-3.5 w-3.5" /><Trans>Upload {uploadFiles.length > 1 ? `${uploadFiles.length} Files` : 'Document'}</Trans></>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Table Card ═══ */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        {/* Filter bar */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="scrollbar-hide flex gap-0.5 overflow-x-auto rounded-md border border-border bg-background p-[3px]">
            {statusFilters.map((filter) => (
              <button
                key={filter.value ?? 'all'}
                className={`whitespace-nowrap rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                  status === filter.value || (!status && !filter.value)
                    ? 'bg-card font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  if (filter.value) params.set('status', filter.value);
                  else params.delete('status');
                  params.delete('page');
                  setSearchParams(params);
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-[200px] pl-8 text-[12px]"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={data?.data ? selectedIds.size === data.data.length && data.data.length > 0 : false}
                    onChange={selectAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Ref #</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Title</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Type</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Status</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Confidentiality</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Location</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Date</th>
                <th className="w-10 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="py-12 text-center text-[13px] text-muted-foreground"><Trans>Loading...</Trans></td></tr>
              ) : data?.data && data.data.length > 0 ? (
                data.data.map((doc) => (
                  <tr key={doc.id} className="border-b border-border transition-colors last:border-0 hover:bg-[#faf9fe] dark:hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{doc.referenceNumber?.slice(0, 14)}</td>
                    <td className="px-3 py-3">
                      <Link to={`/dms/doc/${doc.id}`} className="flex items-center gap-2.5 hover:underline">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
                          <FileTextIcon className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div>
                          <p className="max-w-[180px] truncate text-[13px] font-medium">{doc.title}</p>
                          <p className="text-[10px] text-muted-foreground">{doc.fileName}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-muted-foreground">{doc.documentType?.name || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        doc.status === 'ACTIVE' ? 'bg-status-complete-bg text-status-complete-text'
                        : doc.status === 'ARCHIVED' ? 'bg-muted text-muted-foreground'
                        : doc.status === 'UNDER_REVIEW' ? 'bg-status-pending-bg text-status-pending-text'
                        : 'bg-status-draft-bg text-status-draft-text'
                      }`}>
                        <span className="h-1 w-1 rounded-full bg-current" />{doc.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[11px] font-medium ${
                        doc.confidentiality === 'RESTRICTED' ? 'text-red-600'
                        : doc.confidentiality === 'CONFIDENTIAL' ? 'text-amber-600'
                        : 'text-muted-foreground'
                      }`}>
                        {doc.confidentiality}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-muted-foreground">
                      {doc.bin ? `${doc.bin.shelf.cabinet.location.name} › ${doc.bin.name}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[11px] text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted">
                          <MoreHorizontalIcon className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/dms/doc/${doc.id}`}>View Details</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void updateDocument.mutateAsync({ id: doc.id, status: 'ARCHIVED' })}>
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => void deleteDocument.mutateAsync({ id: doc.id })}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={9} className="py-12 text-center text-[13px] text-muted-foreground"><Trans>No documents found</Trans></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {data && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>Showing {data.data.length} of {data.count} documents</span>
            <div className="flex items-center gap-1">
              {data.page > 1 && (
                <button
                  className="rounded border border-border px-2 py-0.5 hover:bg-muted"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set('page', String(data.page - 1));
                    setSearchParams(params);
                  }}
                >
                  Prev
                </button>
              )}
              <span>Page {data.page} of {data.totalPages}</span>
              {data.page < data.totalPages && (
                <button
                  className="rounded border border-border px-2 py-0.5 hover:bg-muted"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set('page', String(data.page + 1));
                    setSearchParams(params);
                  }}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
