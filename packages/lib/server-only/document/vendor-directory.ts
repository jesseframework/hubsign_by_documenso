import { normalizeMetadataKey } from '../../universal/metadata';
import { matchVendorName, prepareVendorCandidates } from '../../universal/vendor-match';

/**
 * Deciding which directory record an invoice belongs to.
 *
 * Extracted from the invoice report because a second reader arrived — the spend
 * meter on the signing page — and the two must never disagree. If the meter
 * attributed an invoice to a vendor the report attributes elsewhere, the figure
 * an approver sees before signing would not be the figure on the Reports page,
 * and there would be no way to tell which one was lying.
 *
 * The rules encoded here are load-bearing and each one was a bug first; see the
 * comments on `identify` and `identifyItem`.
 */

/** The directory columns identification actually reads. */
export type VendorDirectoryRecord = {
  key: string;
  label: string | null;
  email: string | null;
};

export type VendorIdentifier<T extends VendorDirectoryRecord> = {
  /**
   * The record for a vendor name as OCR read it, or null when the directory has
   * no confident answer.
   */
  identify: (vendorName: string) => T | null;
  /**
   * The record for a whole invoice: its vendor name, falling back to the sender's
   * address ONLY when no name was read at all.
   */
  identifyItem: (item: { vendorName: string; senderEmail?: string | null }) => T | null;
};

export const buildVendorIdentifier = <T extends VendorDirectoryRecord>(
  records: T[],
): VendorIdentifier<T> => {
  const byKey = new Map(records.map((record) => [record.key, record]));
  const byEmail = new Map(
    records
      .filter((record) => record.email?.trim())
      .map((record) => [record.email!.trim().toLowerCase(), record]),
  );
  const prepared = prepareVendorCandidates(
    records.map((record) => ({ name: record.label ?? record.key, value: record })),
  );

  const cache = new Map<string, T | null>();

  const identify = (vendorName: string): T | null => {
    const cached = cache.get(vendorName);
    if (cached !== undefined) return cached;

    const exact = byKey.get(normalizeMetadataKey(vendorName));
    const outcome = exact ? null : matchVendorName(vendorName, prepared);
    // An ambiguous match resolves to nothing: the directory holds the same
    // company twice, and attributing spend to one of them would be a coin flip
    // that moves money between two rows of the report.
    const resolved = exact ?? (outcome?.ambiguousWith ? null : (outcome?.match?.value ?? null));

    cache.set(vendorName, resolved);
    return resolved;
  };

  const identifyItem = ({
    vendorName,
    senderEmail,
  }: {
    vendorName: string;
    senderEmail?: string | null;
  }) => {
    const byName = vendorName ? identify(vendorName) : null;

    /*
      The sender's address is a fallback ONLY when OCR read no vendor name at all.

      Applying it whenever the name failed to match the directory looks harmless
      and is not: several vendors' invoices routinely arrive from one shared
      mailbox — a forwarding address, an AP inbox, this deployment's own test
      account — so a single directory record holding that address would capture
      every invoice whose vendor is simply not in the directory yet. That is how a
      bank statement for 6,017,047 was attributed to a landscaping supplier and
      became 99% of the report.

      A named vendor that is not in the directory belongs in its own row under its
      own name.
    */
    if (byName) return byName;

    if (!vendorName && senderEmail) {
      return byEmail.get(senderEmail.trim().toLowerCase()) ?? null;
    }

    return null;
  };

  return { identify, identifyItem };
};
