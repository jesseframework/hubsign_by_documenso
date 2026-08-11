import { BuildingIcon, FileTextIcon, HashIcon } from 'lucide-react';

/**
 * The handful of OCR values worth seeing in a list of documents.
 *
 * Renders nothing at all when there is no extraction, which is the normal case for
 * a hand-uploaded document — a list of empty dashes would make every non-invoice
 * row look like it was missing something.
 *
 * There is deliberately no amount here. It was briefly its own column, which put
 * a permanent "Amount" header above a cell that is empty for every contract, NDA
 * and letter in the list — most of them. A figure only some documents have does
 * not earn a column of its own.
 */
export type DocumentOcr = {
  vendorName: string | null;
  vendorContact: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
} | null;

export const DocumentOcrSummary = ({ ocr }: { ocr: DocumentOcr }) => {
  if (!ocr) return null;

  const { vendorName, vendorContact, invoiceNumber, poNumber } = ocr;

  if (!vendorName && !vendorContact && !invoiceNumber && !poNumber) {
    return null;
  }

  return (
    <div className="mt-1 space-y-0.5">
      {(vendorName || vendorContact) && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <BuildingIcon className="h-3 w-3 flex-shrink-0" />
          <span className="truncate" title={[vendorName, vendorContact].filter(Boolean).join(' · ')}>
            {vendorName || vendorContact}
          </span>
        </div>
      )}

      {(invoiceNumber || poNumber) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {invoiceNumber && (
            <span className="inline-flex items-center gap-1">
              <FileTextIcon className="h-3 w-3 flex-shrink-0" />
              {/* Labelled, because on their own an invoice number and a PO number
                  are indistinguishable strings. */}
              <span className="opacity-70">Inv</span>
              <span className="font-medium text-foreground/80">{invoiceNumber}</span>
            </span>
          )}
          {poNumber && (
            <span className="inline-flex items-center gap-1">
              <HashIcon className="h-3 w-3 flex-shrink-0" />
              <span className="opacity-70">PO</span>
              <span className="font-medium text-foreground/80">{poNumber}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
