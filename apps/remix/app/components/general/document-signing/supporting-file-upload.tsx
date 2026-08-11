import { useEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import {
  CheckCircle2Icon,
  FileIcon,
  Loader2Icon,
  PaperclipIcon,
  ScanLineIcon,
  Trash2Icon,
} from 'lucide-react';

import {
  MAX_SUPPORTING_FILES_PER_RECIPIENT,
  SUPPORTING_FILE_ACCEPT,
} from '@documenso/lib/server-only/document/supporting-file-types';

/** What the extraction service found in an attachment, if it was read. */
export type AttachmentOcr = {
  ran: boolean;
  ok: boolean;
  error: string | null;
  documentType: string | null;
  poNumber: string | null;
  vendorName: string | null;
  total: string | null;
  appliedToInvoice?: 'applied' | 'already-present' | 'document-closed' | 'not-an-inbox-item' | null;
};

export type SupportingFile = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  ocr?: AttachmentOcr | null;
};

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Lets a signer attach supporting documentation while signing.
 *
 * Uploads go straight to the token-authenticated endpoint rather than through
 * tRPC, because the file is multipart and the signer has no session. The
 * `accept` attribute and the size hint are conveniences only — the server
 * re-checks extension, declared type AND magic bytes, since anything the browser
 * asserts here is attacker-controlled.
 */
export const SupportingFileUpload = ({
  token,
  files,
  onChange,
  disabled,
}: {
  token: string;
  files: SupportingFile[];
  onChange: (files: SupportingFile[]) => void;
  disabled?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load what this token has already attached. Without this the list starts
  // empty on every visit, so a signer who refreshed could not see or remove
  // what they had sent and would attach the same PO a second time.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/files/supporting/${token}`);
        if (!response.ok) return;

        const existing = (await response.json()) as SupportingFile[];

        if (!cancelled && Array.isArray(existing) && existing.length > 0) {
          onChange(existing);
        }
      } catch {
        // A failed load is not worth an error message: the signer can still
        // attach, and the server enforces the cap either way.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // Only on mount, and only keyed by the token — `onChange` is recreated by
    // the parent each render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const atLimit = files.length >= MAX_SUPPORTING_FILES_PER_RECIPIENT;

  const upload = async (selected: FileList | null) => {
    if (!selected?.length) return;

    setError(null);
    setBusy(true);

    const uploaded: SupportingFile[] = [];

    // Sequential rather than parallel: the per-recipient cap is enforced by a
    // count on the server, so concurrent posts could race past it.
    for (const file of Array.from(selected)) {
      if (files.length + uploaded.length >= MAX_SUPPORTING_FILES_PER_RECIPIENT) {
        setError(`You can attach at most ${MAX_SUPPORTING_FILES_PER_RECIPIENT} files.`);
        break;
      }

      const body = new FormData();
      body.append('file', file);

      try {
        const response = await fetch(`/api/files/supporting/${token}`, { method: 'POST', body });
        const payload = (await response.json()) as SupportingFile & { error?: string };

        if (!response.ok) {
          // Named so a rejection is actionable rather than mysterious.
          setError(`${file.name}: ${payload.error ?? 'Upload failed.'}`);
          break;
        }

        uploaded.push(payload);
      } catch {
        setError(`${file.name}: upload failed.`);
        break;
      }
    }

    if (uploaded.length > 0) {
      onChange([...files, ...uploaded]);
    }

    setBusy(false);

    // Reset so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = async (id: string) => {
    setError(null);

    const response = await fetch(`/api/files/supporting/${token}/${id}`, { method: 'DELETE' });

    if (response.ok) {
      onChange(files.filter((f) => f.id !== id));
    } else {
      setError('Could not remove that file.');
    }
  };

  return (
    <div>
      <p className="text-[13px] font-medium text-foreground">
        <Trans>Supporting documents</Trans>
        <span className="ml-1 font-normal text-muted-foreground">
          <Trans>(optional)</Trans>
        </span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        <Trans>
          Attach a purchase order, spec sheet or photo. PDF, Word, Excel, images, CSV — up to 15 MB
          each. A PDF or image is read automatically, so an attached purchase order can satisfy a
          rule that is holding up your signature.
        </Trans>
      </p>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="rounded-[var(--r-sm)] border border-border bg-muted/30 px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
              <FileIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{file.fileName}</span>
              <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                {formatSize(file.sizeBytes)}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => void remove(file.id)}
                  className="flex-shrink-0 text-destructive hover:opacity-70"
                  aria-label={`Remove ${file.fileName}`}
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              )}
              </div>

              {/*
                Say what was read. Being told the upload "succeeded" and left to
                guess whether the PO number came through is the difference
                between clearing a block and pressing Sign hopefully.
              */}
              {file.ocr?.ran && (
                <div className="mt-1 flex items-start gap-1.5 pl-5 text-[11px]">
                  {file.ocr.ok && file.ocr.poNumber ? (
                    <>
                      <CheckCircle2Icon className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        <Trans>PO number {file.ocr.poNumber} read from this file</Trans>
                        {file.ocr.appliedToInvoice === 'already-present' && (
                          <span className="block opacity-80">
                            <Trans>The document already had a PO number, so this one was not applied.</Trans>
                          </span>
                        )}
                      </span>
                    </>
                  ) : file.ocr.ok ? (
                    <>
                      <ScanLineIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        <Trans>Read, but no PO number was found in this file.</Trans>
                      </span>
                    </>
                  ) : (
                    <>
                      <ScanLineIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600" />
                      <span className="text-amber-700 dark:text-amber-400">
                        <Trans>This file could not be read automatically.</Trans>
                      </span>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={SUPPORTING_FILE_ACCEPT}
        onChange={(e) => void upload(e.target.files)}
      />

      <button
        type="button"
        disabled={disabled || busy || atLimit}
        onClick={() => inputRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--r-sm)] border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            <Trans>Uploading and reading…</Trans>
          </>
        ) : atLimit ? (
          <Trans>Attachment limit reached</Trans>
        ) : (
          <>
            <PaperclipIcon className="h-3.5 w-3.5" />
            <Trans>Attach a file</Trans>
          </>
        )}
      </button>
    </div>
  );
};
