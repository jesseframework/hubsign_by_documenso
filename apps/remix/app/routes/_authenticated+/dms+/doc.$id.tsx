import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ChevronLeftIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FileTextIcon,
  CheckCircleIcon,
  ClipboardListIcon,
  FolderInputIcon,
  GitBranchIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
  FolderXIcon,
  HeartIcon,
  LockIcon,
  LogInIcon,
  LogOutIcon,
  MapPinIcon,
  MessageSquareIcon,
  PrinterIcon,
  SendIcon,
  ShieldIcon,
  TagIcon,
  UnlockIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Document Details');
}

export default function DmsDocumentDetailPage() {
  const { id } = useParams();
  const { _ } = useLingui();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'details' | 'workflows' | 'audit' | 'comments' | 'versions'>('preview');
  const [isFilingOpen, setIsFilingOpen] = useState(false);
  const [selectedBinId, setSelectedBinId] = useState('');
  const [isRetrievalOpen, setIsRetrievalOpen] = useState(false);
  const [retrievalReason, setRetrievalReason] = useState('');
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowSteps, setWorkflowSteps] = useState<{ email: string; action: string }[]>([{ email: '', action: 'APPROVE' }]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: doc, isLoading } = trpc.dms.getDocument.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  const { data: auditLogs } = trpc.dms.getAuditLog.useQuery(
    { id: id! },
    { enabled: !!id && activeTab === 'audit' },
  );

  const { data: locations } = trpc.dms.getLocations.useQuery();

  const updateDocument = trpc.dms.updateDocument.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      toast({ title: _(msg`Document updated`) });
    },
  });

  // Flatten bins from locations tree
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

  const handleFileDocument = () => {
    if (!selectedBinId) return;
    void updateDocument.mutateAsync({ id: doc!.id, binId: selectedBinId }).then(() => {
      setIsFilingOpen(false);
      setSelectedBinId('');
    });
  };

  const handleUnfile = () => {
    void updateDocument.mutateAsync({ id: doc!.id, binId: null });
  };

  // Build preview URL — uses the DMS preview endpoint
  useEffect(() => {
    if (!doc || previewUrl) return;

    if (doc.format === 'PHYSICAL') {
      // No preview for physical-only documents
      return;
    }

    // Use the direct DMS preview endpoint
    setPreviewUrl(`/api/files/dms-preview/${doc.fileUrl}`);
  }, [doc, previewUrl]);

  const checkout = trpc.dms.checkoutDocument.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      toast({ title: _(msg`Document checked out`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Checkout failed`), description: err.message, variant: 'destructive' });
    },
  });

  const checkin = trpc.dms.checkinDocument.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      toast({ title: _(msg`Document checked in`) });
    },
  });

  const createWorkflow = trpc.dms.createWorkflow.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      setIsWorkflowOpen(false);
      setWorkflowName('');
      setWorkflowSteps([{ email: '', action: 'APPROVE' }]);
      toast({ title: _(msg`Approval workflow started`) });
    },
  });

  const respondToStep = trpc.dms.respondToWorkflowStep.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      toast({ title: _(msg`Response submitted`) });
    },
  });

  const createRetrieval = trpc.dms.createRetrievalRequest.useMutation({
    onSuccess: () => {
      setIsRetrievalOpen(false);
      setRetrievalReason('');
      toast({ title: _(msg`Retrieval request created`) });
    },
  });

  const toggleFavorite = trpc.dms.toggleFavorite.useMutation({
    onSuccess: () => void utils.dms.getDocument.invalidate({ id: id! }),
  });

  const addComment = trpc.dms.createComment.useMutation({
    onSuccess: () => {
      void utils.dms.getDocument.invalidate({ id: id! });
      setCommentText('');
      toast({ title: _(msg`Comment added`) });
    },
  });

  if (isLoading || !doc) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Trans>Loading document...</Trans>
      </div>
    );
  }

  const isPdf = doc.fileType === 'application/pdf' || doc.fileName.endsWith('.pdf');
  const isImage = doc.fileType.startsWith('image/');

  const tabs = [
    { id: 'preview' as const, label: 'Preview' },
    { id: 'details' as const, label: 'Details' },
    { id: 'workflows' as const, label: `Workflows (${doc.workflows.length})` },
    { id: 'audit' as const, label: 'Audit Trail' },
    { id: 'comments' as const, label: `Comments (${doc.comments.length})` },
    { id: 'versions' as const, label: `Versions (${doc.versions.length})` },
  ];

  const confidentialityColor =
    doc.confidentiality === 'RESTRICTED' ? 'text-red-600'
    : doc.confidentiality === 'CONFIDENTIAL' ? 'text-amber-600'
    : doc.confidentiality === 'INTERNAL' ? 'text-blue-600'
    : 'text-green-600';

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link to="/dms/documents" className="flex items-center text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="mr-1 h-4 w-4" />
        <Trans>Back to Documents</Trans>
      </Link>

      {/* Header */}
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <FileTextIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{doc.title}</h1>
                <button
                  className={`flex-shrink-0 transition-colors ${
                    doc.favorites.length > 0 ? 'text-red-500' : 'text-muted-foreground/40 hover:text-red-400'
                  }`}
                  onClick={() => void toggleFavorite.mutateAsync({ documentId: doc.id })}
                  title={doc.favorites.length > 0 ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <HeartIcon className={`h-5 w-5 ${doc.favorites.length > 0 ? 'fill-current' : ''}`} />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                <span className="font-mono">{doc.referenceNumber}</span>
                <span>·</span>
                <span>{doc.fileName}</span>
                <span>·</span>
                <span>{(doc.fileSize / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              {doc.description && (
                <p className="mt-2 text-[13px] text-muted-foreground">{doc.description}</p>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
              doc.status === 'ACTIVE' ? 'bg-status-complete-bg text-status-complete-text'
              : doc.status === 'ARCHIVED' ? 'bg-muted text-muted-foreground'
              : 'bg-status-pending-bg text-status-pending-text'
            }`}>
              <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />
              {doc.status}
            </span>

            {/* Format badge */}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
              doc.format === 'PHYSICAL' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              : doc.format === 'BOTH' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
              : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
            }`}>
              {doc.format === 'PHYSICAL' ? '📁 Physical' : doc.format === 'BOTH' ? '📁📄 Physical + Digital' : '📄 Digital'}
            </span>

            {/* Print Label */}
            {(doc.format === 'PHYSICAL' || doc.format === 'BOTH') && (
              <Link to={`/dms/label/${doc.id}`}>
                <Button size="sm" variant="secondary" className="h-7 gap-1 text-[11px]">
                  <PrinterIcon className="h-3 w-3" />
                  Print Label
                </Button>
              </Link>
            )}

            {/* File / Unfile button */}
            <div className="flex items-center gap-1.5">
              {doc.binId ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    <MapPinIcon className="h-3 w-3" />
                    Filed
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => setIsFilingOpen(true)}
                  >
                    <FolderInputIcon className="h-3 w-3" />
                    Move
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px] text-muted-foreground"
                    onClick={handleUnfile}
                  >
                    <FolderXIcon className="h-3 w-3" />
                    Unfile
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => setIsFilingOpen(true)}
                >
                  <FolderInputIcon className="h-3 w-3" />
                  File Document
                </Button>
              )}
            </div>

            {/* Start Approval Workflow */}
            <Button
              size="sm"
              variant="secondary"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setIsWorkflowOpen(true)}
            >
              <GitBranchIcon className="h-3 w-3" />
              Start Approval
            </Button>

            {/* Request Retrieval (physical docs) */}
            {(doc.format === 'PHYSICAL' || doc.format === 'BOTH') && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-[11px]"
                onClick={() => setIsRetrievalOpen(true)}
              >
                <ClipboardListIcon className="h-3 w-3" />
                Request Retrieval
              </Button>
            )}

            {/* Checkout status + actions */}
            {doc.checkedOut ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <LockIcon className="h-3 w-3" />
                  Checked out by {doc.checkedOutBy?.name || doc.checkedOutBy?.email}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => void checkin.mutateAsync({ id: doc.id })}
                  loading={checkin.isPending}
                >
                  <LogInIcon className="h-3 w-3" />
                  Check In
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-[11px]"
                onClick={() => void checkout.mutateAsync({ id: doc.id })}
                loading={checkout.isPending}
              >
                <LogOutIcon className="h-3 w-3" />
                Check Out
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-md border border-border bg-card p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        {activeTab === 'preview' && (
          <div>
            {previewUrl ? (
              <>
                {isPdf ? (
                  <div className="overflow-hidden rounded-md border border-border">
                    <iframe
                      src={previewUrl}
                      className="h-[70vh] w-full"
                      title={doc.title}
                    />
                  </div>
                ) : isImage ? (
                  <div className="flex justify-center rounded-md border border-border bg-muted/30 p-4">
                    <img
                      src={previewUrl}
                      alt={doc.title}
                      className="max-h-[70vh] max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <FileTextIcon className="mb-3 h-12 w-12 opacity-30" />
                    <p className="text-[14px] font-medium">Preview not available for this file type</p>
                    <p className="mt-1 text-[12px]">{doc.fileType} — {doc.fileName}</p>
                    <a
                      href={previewUrl}
                      download={doc.fileName}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary/90"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      Download File
                    </a>
                  </div>
                )}
              </>
            ) : doc.format === 'PHYSICAL' ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FolderInputIcon className="mb-3 h-12 w-12 opacity-30" />
                <p className="text-[14px] font-medium">Physical Document</p>
                <p className="mt-1 text-[12px]">This is a physical document. No digital preview available.</p>
                {doc.bin && (
                  <p className="mt-2 text-[12px]">
                    Filed at: <span className="font-medium text-foreground">
                      {doc.bin.shelf.cabinet.location.name} › {doc.bin.shelf.cabinet.name} › {doc.bin.shelf.name} › {doc.bin.name}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileTextIcon className="mb-3 h-12 w-12 opacity-30" />
                <p className="text-[14px] font-medium">Preview unavailable</p>
                <p className="mt-1 text-[12px]">Unable to load document preview. The file may be stored externally.</p>
              </div>
            )}

            {/* Download bar */}
            {previewUrl && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">{doc.fileName} · {(doc.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                <a
                  href={previewUrl}
                  download={doc.fileName}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/15"
                >
                  <DownloadIcon className="h-3 w-3" />
                  Download
                </a>
              </div>
            )}
          </div>
        )}

        {activeTab === 'details' && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Metadata */}
            <div className="space-y-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Document Information</h3>

              <div className="space-y-3">
                {[
                  { label: 'Document Type', value: doc.documentType?.name || 'Not set' },
                  { label: 'Classification', value: doc.classification?.name || 'Not set' },
                  { label: 'Confidentiality', value: doc.confidentiality, className: confidentialityColor },
                  { label: 'Uploaded By', value: doc.uploadedBy.name || doc.uploadedBy.email },
                  { label: 'Created', value: new Date(doc.createdAt).toLocaleString() },
                  { label: 'Last Updated', value: new Date(doc.updatedAt).toLocaleString() },
                  { label: 'OCR Processed', value: doc.ocrProcessed ? 'Yes' : 'No' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-[12px] text-muted-foreground">{item.label}</span>
                    <span className={`text-[13px] font-medium ${item.className || ''}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Filing location + Tags */}
            <div className="space-y-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Filing & Tags</h3>

              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="text-[12px] text-muted-foreground">Location</span>
                  <span className="text-[13px] font-medium">
                    {doc.bin
                      ? `${doc.bin.shelf.cabinet.location.name} › ${doc.bin.shelf.cabinet.name} › ${doc.bin.shelf.name} › ${doc.bin.name}`
                      : 'Not filed'}
                  </span>
                </div>

                {doc.retentionDate && (
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-[12px] text-muted-foreground">Retention Until</span>
                    <span className="text-[13px] font-medium">{new Date(doc.retentionDate).toLocaleDateString()}</span>
                  </div>
                )}

                {doc.expiryDate && (
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-[12px] text-muted-foreground">Expires</span>
                    <span className="text-[13px] font-medium text-amber-600">{new Date(doc.expiryDate).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <span className="text-[12px] text-muted-foreground">Tags</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doc.tags.length > 0 ? (
                    doc.tags.map((t) => (
                      <span key={t.tagId} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                        #{t.tag.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-muted-foreground">No tags</span>
                  )}
                </div>
              </div>

              {/* OCR Preview */}
              {/* Extracted metadata (from OCR/AI) */}
              {doc.metadata && typeof doc.metadata === 'object' && Object.keys(doc.metadata as Record<string, unknown>).length > 0 && (
                <div>
                  <span className="text-[12px] font-medium text-muted-foreground">Extracted Data</span>
                  <div className="mt-1.5 space-y-1.5">
                    {Object.entries(doc.metadata as Record<string, unknown>).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between rounded border border-border bg-muted/20 px-2.5 py-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                        <span className="text-[12px] font-medium">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OCR text preview */}
              {doc.ocrText && (
                <div>
                  <span className="text-[12px] text-muted-foreground">OCR Content</span>
                  <p className="mt-1 max-h-48 overflow-y-auto rounded border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground leading-relaxed">
                    {doc.ocrText.substring(0, 1000)}
                    {doc.ocrText.length > 1000 && '...'}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{doc.ocrText.length} characters extracted</p>
                </div>
              )}

              {/* OCR status */}
              {!doc.ocrProcessed && (
                <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950">
                  <ClockIcon className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">OCR pending — text will be extracted when the AI service processes this document</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'workflows' && (
          <div className="space-y-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Approval Workflows</h3>

            {doc.workflows.length > 0 ? (
              <div className="space-y-4">
                {doc.workflows.map((workflow) => (
                  <div key={workflow.id} className="rounded-md border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[14px] font-medium">{workflow.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Started by {workflow.initiatedBy.name || workflow.initiatedBy.email} · {new Date(workflow.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        workflow.status === 'APPROVED' ? 'bg-status-complete-bg text-status-complete-text'
                        : workflow.status === 'REJECTED' ? 'bg-red-50 text-red-600'
                        : workflow.status === 'IN_PROGRESS' ? 'bg-status-pending-bg text-status-pending-text'
                        : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />
                        {workflow.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Steps */}
                    <div className="mt-3 space-y-2">
                      {workflow.steps.map((step) => (
                        <div key={step.id} className="flex items-center gap-3 rounded border border-border bg-muted/20 p-2.5">
                          <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            step.status === 'APPROVED' ? 'bg-green-100 text-green-700'
                            : step.status === 'REJECTED' ? 'bg-red-100 text-red-700'
                            : step.step === workflow.currentStep ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'
                          }`}>
                            {step.status === 'APPROVED' ? '✓' : step.status === 'REJECTED' ? '✗' : step.step}
                          </div>

                          <div className="flex-1">
                            <p className="text-[12px] font-medium">
                              Step {step.step}: {step.action} — {step.assignedTo.name || step.assignedTo.email}
                            </p>
                            {step.notes && <p className="text-[11px] text-muted-foreground">{step.notes}</p>}
                            {step.completedAt && (
                              <p className="text-[10px] text-muted-foreground">
                                {step.status} on {new Date(step.completedAt).toLocaleString()}
                              </p>
                            )}
                          </div>

                          {step.status === 'PENDING' && step.step === workflow.currentStep && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 gap-1 text-[10px] text-green-600 hover:bg-green-50"
                                onClick={() => void respondToStep.mutateAsync({ stepId: step.id, status: 'APPROVED' })}
                              >
                                <CheckCircleIcon className="h-3 w-3" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 gap-1 text-[10px] text-red-600 hover:bg-red-50"
                                onClick={() => void respondToStep.mutateAsync({ stepId: step.id, status: 'REJECTED' })}
                              >
                                <XCircleIcon className="h-3 w-3" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-[13px] text-muted-foreground">
                <GitBranchIcon className="mx-auto mb-3 h-8 w-8 opacity-30" />
                <p>No approval workflows yet</p>
                <p className="mt-1 text-[11px]">Click "Start Approval" to create one.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-0">
            <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Audit Trail</h3>
            {auditLogs && auditLogs.length > 0 ? (
              <div className="relative space-y-0 border-l-2 border-border pl-6">
                {auditLogs.map((log) => (
                  <div key={log.id} className="relative pb-4">
                    <div className="absolute -left-[31px] top-0.5 h-3 w-3 rounded-full border-2 border-primary bg-card" />
                    <div>
                      <p className="text-[13px] font-medium">{log.action.replace(/_/g, ' ')}</p>
                      <p className="text-[11px] text-muted-foreground">{log.details}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {log.user.name || log.user.email} · {new Date(log.createdAt).toLocaleString()}
                        {log.ipAddress && ` · ${log.ipAddress}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-[13px] text-muted-foreground">No audit events recorded</p>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="space-y-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Comments</h3>

            {/* Add comment */}
            <div className="flex gap-2">
              <Input
                className="h-9 text-[13px]"
                placeholder="Add a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && commentText.trim()) {
                    void addComment.mutateAsync({ documentId: doc.id, text: commentText });
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!commentText.trim()}
                onClick={() => void addComment.mutateAsync({ documentId: doc.id, text: commentText })}
              >
                <SendIcon className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Comments list */}
            <div className="space-y-3">
              {doc.comments.map((comment) => (
                <div key={comment.id} className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium">{comment.user.name || comment.user.email}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-[13px]">{comment.text}</p>
                </div>
              ))}
              {doc.comments.length === 0 && (
                <p className="py-6 text-center text-[13px] text-muted-foreground">No comments yet</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'versions' && (
          <div className="space-y-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Version History</h3>

            {doc.versions.length > 0 ? (
              <div className="space-y-2">
                {doc.versions.map((version) => (
                  <div key={version.id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <span className="text-[13px] font-medium">Version {version.version}</span>
                      {version.notes && <p className="text-[11px] text-muted-foreground">{version.notes}</p>}
                      <p className="text-[10px] text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{(version.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">No previous versions</p>
            )}
          </div>
        )}
      </div>

      {/* Filing Location Dialog */}
      <Dialog open={isFilingOpen} onOpenChange={setIsFilingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>{doc.binId ? 'Move Document' : 'File Document'}</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="py-2">
            <label className="text-[12px] font-medium text-muted-foreground">Select Filing Location</label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <Trans>Choose a Location › Cabinet › Shelf › Bin to file this document.</Trans>
            </p>

            {allBins.length > 0 ? (
              <select
                className="mt-3 h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] outline-none"
                value={selectedBinId}
                onChange={(e) => setSelectedBinId(e.target.value)}
              >
                <option value="">Select location...</option>
                {allBins.map((bin) => (
                  <option key={bin.id} value={bin.id}>{bin.path}</option>
                ))}
              </select>
            ) : (
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-4 text-center">
                <MapPinIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-[13px] text-muted-foreground">
                  <Trans>No filing locations configured.</Trans>
                </p>
                <Link to="/dms/filing" className="mt-1 text-[12px] text-primary hover:underline">
                  <Trans>Set up filing structure</Trans>
                </Link>
              </div>
            )}

            {doc.binId && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Currently filed in: <span className="font-medium text-foreground">
                  {doc.bin ? `${doc.bin.shelf.cabinet.location.name} › ${doc.bin.shelf.cabinet.name} › ${doc.bin.shelf.name} › ${doc.bin.name}` : 'Unknown'}
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsFilingOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={handleFileDocument}
              disabled={!selectedBinId || updateDocument.isPending}
            >
              {updateDocument.isPending ? (
                <Trans>Filing...</Trans>
              ) : (
                <><FolderInputIcon className="mr-2 h-3.5 w-3.5" /><Trans>{doc.binId ? 'Move Here' : 'File Here'}</Trans></>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Workflow Dialog */}
      <Dialog open={isWorkflowOpen} onOpenChange={setIsWorkflowOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <Trans>Start Approval Workflow</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
            <p className="text-[13px] text-muted-foreground">
              <Trans>Route this document through a multi-step approval chain. Each step must be approved before the next person is notified.</Trans>
            </p>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Workflow Name</label>
              <Input
                className="mt-1 h-8 text-[13px]"
                placeholder="e.g. Invoice Approval, Contract Review..."
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Approval Steps</label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Add approvers in order. Each must approve before the next is asked.</p>

              <div className="mt-2 space-y-2">
                {workflowSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {i + 1}
                    </span>
                    <Input
                      className="h-8 flex-1 text-[13px]"
                      placeholder="Approver email address"
                      type="email"
                      value={step.email}
                      onChange={(e) => {
                        const updated = [...workflowSteps];
                        updated[i] = { ...updated[i], email: e.target.value };
                        setWorkflowSteps(updated);
                      }}
                    />
                    <select
                      className="h-8 rounded-md border border-border bg-background px-2 text-[12px]"
                      value={step.action}
                      onChange={(e) => {
                        const updated = [...workflowSteps];
                        updated[i] = { ...updated[i], action: e.target.value };
                        setWorkflowSteps(updated);
                      }}
                    >
                      <option value="APPROVE">Approve</option>
                      <option value="REVIEW">Review</option>
                      <option value="SIGN_OFF">Sign Off</option>
                    </select>
                    {workflowSteps.length > 1 && (
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setWorkflowSteps(workflowSteps.filter((_, idx) => idx !== i))}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
                onClick={() => setWorkflowSteps([...workflowSteps, { email: '', action: 'APPROVE' }])}
              >
                <PlusIcon className="h-3 w-3" />
                Add Step
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsWorkflowOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={async () => {
                const validSteps = workflowSteps.filter((s) => s.email.trim());
                if (!workflowName || validSteps.length === 0) return;

                // Look up user IDs by email
                const resolvedSteps: { assignedToId: number; action: string }[] = [];
                for (const step of validSteps) {
                  const user = await utils.dms.lookupUserByEmail.fetch({ email: step.email });
                  if (!user) {
                    toast({ title: `User not found: ${step.email}`, variant: 'destructive' });
                    return;
                  }
                  resolvedSteps.push({ assignedToId: user.id, action: step.action });
                }

                await createWorkflow.mutateAsync({
                  documentId: doc.id,
                  name: workflowName,
                  steps: resolvedSteps,
                });
              }}
              disabled={!workflowName || workflowSteps.every((s) => !s.email.trim()) || createWorkflow.isPending}
            >
              {createWorkflow.isPending ? <Trans>Starting...</Trans> : <Trans>Start Workflow</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retrieval Request Dialog */}
      <Dialog open={isRetrievalOpen} onOpenChange={setIsRetrievalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Request Document Retrieval</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              <Trans>Submit a request to retrieve the physical copy of this document from storage.</Trans>
            </p>

            {doc.bin && (
              <div className="rounded-md border border-border bg-muted/30 p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground">Current Location</p>
                <p className="mt-0.5 text-[13px] font-medium">
                  {doc.bin.shelf.cabinet.location.name} › {doc.bin.shelf.cabinet.name} › {doc.bin.shelf.name} › {doc.bin.name}
                </p>
              </div>
            )}

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Reason for retrieval</label>
              <Input
                className="mt-1"
                placeholder="e.g. Client audit, legal review, copy needed..."
                value={retrievalReason}
                onChange={(e) => setRetrievalReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsRetrievalOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={() => void createRetrieval.mutateAsync({
                documentId: doc.id,
                reason: retrievalReason || undefined,
              })}
              disabled={createRetrieval.isPending}
            >
              {createRetrieval.isPending ? <Trans>Submitting...</Trans> : <Trans>Submit Request</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
