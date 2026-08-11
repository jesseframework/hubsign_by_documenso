import { BuildingIcon, FileTextIcon, HashIcon } from 'lucide-react';

/**
 * The handful of OCR values worth seeing in a list of documents.
 *
 * Both components render nothing at all when there is no extraction, which is the
 * normal case for a hand-uploaded document — a list of empty dashes would make
 * every non-invoice row look like it was missing something.
 */
export type DocumentOcr = {
  vendorName: string | null;
  vendorContact: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
  totalAmount: string | null;
  currency: string | null;
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

export const DocumentOcrAmount = ({ ocr }: { ocr: DocumentOcr }) => {
  if (!ocr?.totalAmount) return null;

  /*
    Shown as extracted, not reformatted.

    The value arrives as whatever the extractor produced, so parsing it into a
    number to run through a currency formatter risks turning "1.234,56" into
    1.234 and reporting a thousandth of the real total on an invoice list. The
    currency code goes beside it instead.
  */
  return (
    <div className="whitespace-nowrap text-right text-[12px]">
      {ocr.currency && (
        <span className="mr-1 text-[10px] uppercase text-muted-foreground">{ocr.currency}</span>
      )}
      <span className="font-medium">{ocr.totalAmount}</span>
    </div>
  );
};
