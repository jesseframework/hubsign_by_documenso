import { Trans } from '@lingui/react/macro';
import { DownloadIcon, FileIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files signers attached while signing, listed for individual download beneath
 * the main document's own Download action.
 *
 * Renders nothing when there are none, so it doesn't add an empty section to
 * every document — the common case by far.
 */
export const DocumentSupportingFiles = ({ documentId }: { documentId: number }) => {
  const { data: files } = trpc.document.listSupportingFiles.useQuery({ documentId });

  if (!files || files.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-border px-4 pt-4">
      <p className="text-[13px] font-medium text-foreground">
        <Trans>Supporting documents</Trans>
        <span className="ml-1 font-normal text-muted-foreground">({files.length})</span>
      </p>

      <ul className="mt-2 space-y-1.5">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex items-center gap-2 rounded-[var(--r-sm)] border border-border bg-muted/20 px-2 py-1.5"
          >
            <FileIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">{file.fileName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {formatSize(file.sizeBytes)}
                {file.recipient?.email && (
                  <>
                    {' · '}
                    <Trans>from {file.recipient.name || file.recipient.email}</Trans>
                  </>
                )}
              </p>
            </div>

            {/*
              A plain link, not fetch+blob: the endpoint already sends
              Content-Disposition: attachment, so the browser downloads it with
              the sanitized filename and no JS has to touch the bytes.
            */}
            <a
              href={`/api/files/supporting/${file.id}`}
              download={file.fileName}
              className="flex flex-shrink-0 items-center gap-1 rounded-[var(--r-sm)] border border-border px-2 py-1 text-[11px] hover:bg-muted"
            >
              <DownloadIcon className="h-3 w-3" />
              <Trans>Download</Trans>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
