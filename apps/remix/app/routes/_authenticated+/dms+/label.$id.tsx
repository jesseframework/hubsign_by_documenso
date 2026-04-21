import { useEffect } from 'react';

import { Trans } from '@lingui/react/macro';
import { ChevronLeftIcon, PrinterIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Print Label');
}

// Simple QR code generator using SVG (no external dependency)
function generateQRSvg(text: string, size: number = 100): string {
  // Simple text-based identifier display since full QR needs a library
  // We'll show a styled reference card instead
  return '';
}

export default function DmsLabelPage() {
  const { id } = useParams();

  const { data: doc, isLoading } = trpc.dms.getDocument.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  const markPrinted = trpc.dms.markLabelPrinted.useMutation();

  const handlePrint = () => {
    void markPrinted.mutateAsync({ id: id! });
    window.print();
  };

  if (isLoading || !doc) {
    return <div className="py-20 text-center text-muted-foreground">Loading...</div>;
  }

  const locationPath = doc.bin
    ? `${doc.bin.shelf.cabinet.location.name} › ${doc.bin.shelf.cabinet.name} › ${doc.bin.shelf.name} › ${doc.bin.name}`
    : 'Not Filed';

  return (
    <div>
      {/* Screen-only controls */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={`/dms/doc/${id}`} className="flex items-center text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="mr-1 h-4 w-4" />
          Back to Document
        </Link>
        <Button onClick={handlePrint} className="gap-1.5">
          <PrinterIcon className="h-3.5 w-3.5" />
          Print Label
        </Button>
      </div>

      {/* Printable labels - 2 copies */}
      <div className="space-y-6 print:space-y-4">
        {[1, 2].map((copy) => (
          <div
            key={copy}
            className="mx-auto w-full max-w-md rounded-lg border-2 border-dashed border-border bg-card p-6 print:max-w-none print:rounded-none print:border-solid print:border-black print:p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-3 print:border-black">
              <div>
                <h2 className="text-lg font-bold tracking-tight">HubSign DMS</h2>
                <p className="text-[10px] text-muted-foreground print:text-black">Document Label</p>
              </div>
              <div className="text-right">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  doc.format === 'PHYSICAL' ? 'bg-amber-100 text-amber-800 print:border print:border-black print:bg-transparent'
                  : doc.format === 'BOTH' ? 'bg-blue-100 text-blue-800 print:border print:border-black print:bg-transparent'
                  : 'bg-green-100 text-green-800 print:border print:border-black print:bg-transparent'
                }`}>
                  {doc.format}
                </span>
              </div>
            </div>

            {/* Reference number - large */}
            <div className="mt-3 text-center">
              <p className="font-mono text-2xl font-bold tracking-wider">{doc.referenceNumber}</p>
            </div>

            {/* Document info */}
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-[12px]">
                <span className="font-medium text-muted-foreground print:text-black">Title:</span>
                <span className="max-w-[60%] truncate font-semibold">{doc.title}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="font-medium text-muted-foreground print:text-black">Type:</span>
                <span>{doc.documentType?.name || 'Uncategorized'}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="font-medium text-muted-foreground print:text-black">Classification:</span>
                <span>{doc.classification?.name || 'Unclassified'}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="font-medium text-muted-foreground print:text-black">Confidentiality:</span>
                <span className={`font-semibold ${
                  doc.confidentiality === 'RESTRICTED' ? 'text-red-600 print:text-black'
                  : doc.confidentiality === 'CONFIDENTIAL' ? 'text-amber-600 print:text-black'
                  : ''
                }`}>
                  {doc.confidentiality}
                </span>
              </div>
            </div>

            {/* Filing location - highlighted */}
            <div className="mt-3 rounded border border-border bg-muted/30 p-2 print:border-black print:bg-transparent">
              <p className="text-[10px] font-medium uppercase text-muted-foreground print:text-black">Filing Location</p>
              <p className="mt-0.5 text-[13px] font-semibold">{locationPath}</p>
            </div>

            {/* Retention info */}
            {doc.retentionDate && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 print:border-black print:bg-transparent">
                <p className="text-[10px] font-medium uppercase text-amber-800 print:text-black">Retention Until</p>
                <p className="text-[13px] font-semibold text-amber-900 print:text-black">
                  {new Date(doc.retentionDate).toLocaleDateString()}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground print:border-black print:text-black">
              <span>Filed: {new Date(doc.createdAt).toLocaleDateString()}</span>
              <span>ID: {doc.id.slice(0, 8)}</span>
              <span>Copy {copy}/2</span>
            </div>

            {/* Barcode area */}
            <div className="mt-2 flex justify-center border-t border-border pt-2 print:border-black">
              <div className="text-center">
                <div className="mx-auto flex h-8 items-end gap-[1px]">
                  {/* Simple barcode visualization */}
                  {(doc.referenceNumber || doc.id).split('').map((char, i) => (
                    <div
                      key={i}
                      className="bg-black"
                      style={{
                        width: char.charCodeAt(0) % 2 === 0 ? '2px' : '1px',
                        height: `${20 + (char.charCodeAt(0) % 12)}px`,
                      }}
                    />
                  ))}
                </div>
                <p className="mt-0.5 font-mono text-[9px]">{doc.referenceNumber}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          .print\\:hidden { display: none !important; }
          .sidebar-nav, .sidebar-main > :first-child, .bottom-nav { display: none !important; }
          .sidebar-main { margin-left: 0 !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
