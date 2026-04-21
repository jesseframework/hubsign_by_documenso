import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { FileTextIcon, SearchIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Input } from '@documenso/ui/primitives/input';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('DMS Search');
}

export default function DmsSearchPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = trpc.dms.searchDocuments.useQuery(
    { query: query || undefined, page: 1, perPage: 50 },
    { enabled: submitted && query.length > 0 },
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        <Trans>Search Documents</Trans>
      </h2>

      {/* Search bar */}
      <div className="rounded-[var(--r)] border border-border bg-card p-6">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-10 text-[14px]"
              placeholder="Search by title, content (OCR), reference number, tags..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSubmitted(false);
              }}
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-primary px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary/90"
          >
            <Trans>Search</Trans>
          </button>
        </form>

        <p className="mt-2 text-[11px] text-muted-foreground">
          <Trans>
            Full-text search across document titles, OCR content, reference numbers, and file names.
          </Trans>
        </p>
      </div>

      {/* Results */}
      {submitted && (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-semibold">
              {isLoading ? (
                <Trans>Searching...</Trans>
              ) : (
                <Trans>{data?.count ?? 0} results found</Trans>
              )}
            </h3>
          </div>

          <div className="divide-y divide-border">
            {data?.data?.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileTextIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{doc.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {doc.referenceNumber} · {doc.documentType?.name || 'Uncategorized'} ·{' '}
                    {doc.classification?.name || 'Unclassified'}
                  </p>
                  {doc.ocrText && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/70">
                      {doc.ocrText.substring(0, 200)}...
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    doc.status === 'ACTIVE'
                      ? 'bg-status-complete-bg text-status-complete-text'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {doc.status}
                </span>
              </div>
            ))}

            {!isLoading && data?.data?.length === 0 && (
              <div className="py-12 text-center text-[13px] text-muted-foreground">
                <Trans>No documents match your search.</Trans>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
