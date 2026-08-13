/**
 * SLA evaluation for Signature Inbox items.
 *
 * Three clocks, covering two consecutive stages and the whole span:
 *
 *   INTERNAL    received → sent for signature   (what this organization controls)
 *   SIGNING     sent for signature → fully signed  (what the signer controls)
 *   END-TO-END  received → fully signed         (the sum of the two)
 *
 * Keeping them apart is the point: a single blended number tells you an invoice
 * was late but not whether your team sat on it or the signer did.
 *
 * The signing clock exists because the internal one STOPS at the send. Before it,
 * an invoice sent within the hour and then left unsigned for three weeks was
 * measured as a success by the internal clock and by nothing else — the only
 * figure covering it was end-to-end, which blames the queue for the signer's
 * delay and gives nobody a target to chase against. It starts at the first
 * DOCUMENT_SENT and is simply absent until then; an invoice nobody has sent is
 * not late to be signed.
 *
 * Targets resolve per vendor, falling back to the organization default — the
 * same precedence idea as OCR template routing, since "this vendor's invoices
 * legitimately take longer" is the common case.
 */

import type { Organization, SignatureInboxItem } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { normalizeMetadataKey } from '../../universal/metadata';
import { resolveOcrVendorName } from '../../universal/ocr-fields';
import { matchVendorName, prepareVendorCandidates } from '../../universal/vendor-match';
import {
  type SlaCalendar,
  type SlaEvaluation,
  evaluateSla,
  normalizeCalendar,
} from '../../universal/sla';

export type OrgSlaConfig = Pick<
  Organization,
  | 'slaEnabled'
  | 'slaTimezone'
  | 'slaWorkingDays'
  | 'slaWorkdayStart'
  | 'slaWorkdayEnd'
  | 'slaHolidays'
  | 'slaDefaultInternalHours'
  | 'slaDefaultEndToEndHours'
  | 'slaDefaultSigningHours'
>;

export const SLA_ORG_SELECT = {
  slaEnabled: true,
  slaTimezone: true,
  slaWorkingDays: true,
  slaWorkdayStart: true,
  slaWorkdayEnd: true,
  slaHolidays: true,
  slaDefaultInternalHours: true,
  slaDefaultEndToEndHours: true,
  slaDefaultSigningHours: true,
} as const;

export const calendarFromOrg = (org: OrgSlaConfig): SlaCalendar =>
  normalizeCalendar({
    timezone: org.slaTimezone ?? 'UTC',
    workingDays: org.slaWorkingDays?.length ? org.slaWorkingDays : undefined,
    workdayStart: org.slaWorkdayStart ?? undefined,
    workdayEnd: org.slaWorkdayEnd ?? undefined,
    holidays: org.slaHolidays ?? [],
  });

export type SlaTargets = {
  internalHours: number | null;
  endToEndHours: number | null;
  signingHours: number | null;
  /** Where the target came from, for display and for debugging a surprise. */
  source: 'vendor' | 'keyword' | 'org-default' | 'none';
  vendorLabel?: string;
  /**
   * The identified vendor's payment terms code, e.g. `30d`.
   *
   * Carried here rather than resolved by a second lookup because identifying the
   * vendor is the expensive and error-prone half of the job, and a second
   * implementation of "which directory record is this invoice from" would
   * eventually disagree with this one. Independent of the SLA target: a vendor may
   * state terms and no turnaround target, or the reverse.
   */
  termsCode?: string | null;
};

const positiveInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const readTargets = (
  data: unknown,
): {
  internal: number | null;
  endToEnd: number | null;
  signing: number | null;
  termsCode: string | null;
} => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { internal: null, endToEnd: null, signing: null, termsCode: null };
  }

  const bag = data as Record<string, unknown>;

  return {
    internal: positiveInt(bag.slaInternalHours),
    endToEnd: positiveInt(bag.slaEndToEndHours),
    signing: positiveInt(bag.slaSigningHours),
    // Stored as typed, parsed at the point of use — so a code that will not parse
    // stays visible in the directory instead of being silently dropped on save.
    termsCode: typeof bag.termsCode === 'string' && bag.termsCode.trim() !== '' ? bag.termsCode : null,
  };
};

const keywordsOf = (data: unknown): string[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const raw = (data as Record<string, unknown>).keywords;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',') : [];
  return list.map((k) => k.trim().toLowerCase()).filter(Boolean);
};

type ResolverRecord = {
  key: string;
  label: string | null;
  email: string | null;
  keywords: string[];
  internal: number | null;
  endToEnd: number | null;
  signing: number | null;
  termsCode: string | null;
};

/**
 * Load the directory once and return a synchronous resolver.
 *
 * A dashboard evaluates every item in the range; doing a lookup per item would
 * be one query per invoice.
 */
export const buildSlaResolver = async (organizationId: number, org: OrgSlaConfig) => {
  const records = await prisma.metadataRecord.findMany({
    where: { organizationId },
    select: { key: true, label: true, email: true, data: true },
  });

  const candidates: ResolverRecord[] = records.map((record) => {
    const targets = readTargets(record.data);
    return {
      key: record.key,
      label: record.label,
      email: record.email,
      keywords: keywordsOf(record.data),
      internal: targets.internal,
      endToEnd: targets.endToEnd,
      signing: targets.signing,
      termsCode: targets.termsCode,
    };
  });

  // Only records that actually carry a target can win; the rest of the
  // directory is noise for this purpose.
  const withTargets = candidates.filter(
    (c) => c.internal !== null || c.endToEnd !== null || c.signing !== null,
  );
  /** Every directory key, including records that set no target of their own. */
  const byKey = new Map(candidates.map((c) => [c.key, c]));

  // Reduced once, not once per invoice. The dashboard resolves every item in the
  // window against this list, so deriving each record's core name inside that
  // loop was the bulk of the work — about 3ms per invoice against 500 vendors.
  const prepared = prepareVendorCandidates(
    candidates.map((c) => ({ name: c.label ?? c.key, value: c })),
  );

  /**
   * Identification is a pure function of the name, and a window is mostly
   * repeats — twelve of this deployment's thirty-two invoices are from one
   * vendor. Matching is linear in directory size, so caching by name turns
   * "invoices × vendors" into "distinct vendor names × vendors".
   */
  type Identity = {
    record: ResolverRecord | null;
    /** The vendor is in the directory, even if which record is unclear. */
    known: boolean;
  };

  const identityCache = new Map<string, Identity>();

  const identify = (vendorName: string): Identity => {
    const cached = identityCache.get(vendorName);
    if (cached) return cached;

    const exact = byKey.get(normalizeMetadataKey(vendorName));
    let identity: Identity;

    if (exact) {
      identity = { record: exact, known: true };
    } else {
      const outcome = matchVendorName(vendorName, prepared);
      // An ambiguous result still means "this vendor is in the directory" — we
      // just cannot say which record. Treating it as unknown let the keyword
      // branch below borrow a different vendor's target, which is precisely the
      // capture the guard exists to stop, and it happens exactly when the
      // directory holds the same company twice.
      identity = {
        record: outcome.match?.value ?? null,
        known: outcome.match !== null || outcome.ambiguousWith !== null,
      };
    }

    identityCache.set(vendorName, identity);
    return identity;
  };

  const orgDefaults: SlaTargets = {
    internalHours: org.slaDefaultInternalHours ?? null,
    endToEndHours: org.slaDefaultEndToEndHours ?? null,
    signingHours: org.slaDefaultSigningHours ?? null,
    source:
      org.slaDefaultInternalHours || org.slaDefaultEndToEndHours || org.slaDefaultSigningHours
        ? 'org-default'
        : 'none',
  };

  return (item: Pick<SignatureInboxItem, 'senderEmail' | 'extractedData' | 'subject'>): SlaTargets => {
    const vendorName = resolveOcrVendorName(item.extractedData);

    // Identify the vendor ONCE, against the whole directory — exactly first,
    // then by name similarity so "Company Ltd." on the invoice still finds
    // "Company Limited" in the directory.
    //
    // Identity and target are separate questions and are answered in that order.
    // Searching only the records that carry a target would let an invoice be
    // attributed to some other vendor that happens to have one, when its own
    // record simply leaves the target unset.
    const identity = vendorName ? identify(vendorName) : { record: null, known: false };
    const identified = identity.record;

    // 1. That vendor's own target.
    if (
      identified &&
      (identified.internal !== null || identified.endToEnd !== null || identified.signing !== null)
    ) {
      return {
        internalHours: identified.internal ?? orgDefaults.internalHours,
        endToEndHours: identified.endToEnd ?? orgDefaults.endToEndHours,
        signingHours: identified.signing ?? orgDefaults.signingHours,
        source: 'vendor',
        vendorLabel: identified.label ?? undefined,
        termsCode: identified.termsCode,
      };
    }

    // 2. The sender's own record — catches mail whose vendor name didn't extract.
    const sender = item.senderEmail?.trim().toLowerCase();
    if (sender) {
      const hit = withTargets.find((c) => c.email?.trim().toLowerCase() === sender);
      if (hit) {
        return {
          internalHours: hit.internal ?? orgDefaults.internalHours,
          endToEndHours: hit.endToEnd ?? orgDefaults.endToEndHours,
          signingHours: hit.signing ?? orgDefaults.signingHours,
          source: 'vendor',
          vendorLabel: hit.label ?? undefined,
          termsCode: hit.termsCode ?? identified?.termsCode ?? null,
        };
      }
    }

    // 3. Keywords, scanned across the extracted values and the subject — lets a
    //    class of document ("utility", "rush") carry its own target.
    //
    //    Skipped once the invoice's vendor is positively in the directory: that
    //    vendor simply not setting a target means "use the default", not "borrow
    //    whichever other vendor's keyword happens to appear". Without this guard
    //    a generic keyword like "consulting" on one vendor silently captures
    //    every invoice from any company with that word in its name.
    if (!identity.known) {
      // Extracted VALUES only. Stringifying the whole object dragged the OCR
      // field names in with them, so an ordinary keyword like "total" or "date"
      // matched the schema of every invoice rather than anything on it.
      const extractedValues =
        item.extractedData && typeof item.extractedData === 'object'
          ? Object.values(item.extractedData as Record<string, unknown>)
              .filter((v) => typeof v === 'string' || typeof v === 'number')
              .join(' ')
          : '';

      const haystack = [vendorName ?? '', item.subject ?? '', extractedValues]
        .join(' ')
        .toLowerCase();

      const keywordHit = withTargets.find((c) => c.keywords.some((kw) => haystack.includes(kw)));

      if (keywordHit) {
        return {
          internalHours: keywordHit.internal ?? orgDefaults.internalHours,
          endToEndHours: keywordHit.endToEnd ?? orgDefaults.endToEndHours,
          signingHours: keywordHit.signing ?? orgDefaults.signingHours,
          source: 'keyword',
          vendorLabel: keywordHit.label ?? undefined,
          termsCode: keywordHit.termsCode,
        };
      }
    }

    /*
      No target of its own, so the org default applies — but the terms code is a
      separate question and is answered here regardless. A vendor that states
      "30d" and leaves the turnaround target unset is the common case, and losing
      its terms here would push every one of its invoices into "no due date".
    */
    return { ...orgDefaults, termsCode: identified?.termsCode ?? null };
  };
};

export type ItemSlaResult = {
  inboxItemId: string;
  vendorLabel: string | null;
  targets: SlaTargets;
  internal: SlaEvaluation;
  endToEnd: SlaEvaluation;
  /**
   * Sent → signed. **Null until the document has been sent**, because there is no
   * clock yet — and null is the honest way to say so. Folding an unsent invoice
   * into this leg as `untracked` would have made it indistinguishable from one
   * whose vendor set no signing target, and the page reports those separately.
   */
  signing: SlaEvaluation | null;
  /** When the document first went out for signature, if it has. */
  sentAt: Date | null;
  /**
   * Whether the clock started from the mail server's arrival time or from the
   * row's own insert instant. The fallback is only equivalent while polling is
   * healthy, so the dashboard has to be able to say how much of a window rests
   * on it.
   */
  startedFrom: 'mail-server' | 'ingest';
};

type EvaluableItem = Pick<
  SignatureInboxItem,
  'id' | 'createdAt' | 'receivedAt' | 'senderEmail' | 'subject' | 'extractedData' | 'documentId'
> & {
  document: { status: string; completedAt: Date | null };
};

/**
 * When the invoice actually arrived.
 *
 * `createdAt` is when the poller INSERTed the row, which equals arrival only if
 * the poller was running. It was not: a 25-day gap in this deployment ended with
 * ten June messages ingested inside ten seconds on 4 August, every one of them
 * measured as having arrived that evening. Prefer the mail server's timestamp;
 * fall back only when the source gave none.
 */
export const slaClockStart = (
  item: Pick<SignatureInboxItem, 'createdAt' | 'receivedAt'>,
): Date => item.receivedAt ?? item.createdAt;

/**
 * Evaluate both clocks for a set of items.
 *
 * The "sent for signature" instant comes from the document's `DOCUMENT_SENT`
 * audit log rather than a dedicated column, so history that predates SLA being
 * switched on is measurable too — the dashboard is useful immediately instead
 * of starting empty.
 */
export const evaluateItemsSla = async ({
  organizationId,
  org,
  items,
  now = new Date(),
}: {
  organizationId: number;
  org: OrgSlaConfig;
  items: EvaluableItem[];
  now?: Date;
}): Promise<ItemSlaResult[]> => {
  if (items.length === 0) {
    return [];
  }

  const [resolve, sentLogs] = await Promise.all([
    buildSlaResolver(organizationId, org),
    prisma.documentAuditLog.findMany({
      where: { documentId: { in: items.map((i) => i.documentId) }, type: 'DOCUMENT_SENT' },
      select: { documentId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // First send wins — a resend must not reset a clock that already stopped.
  const sentAtByDocument = new Map<number, Date>();
  for (const log of sentLogs) {
    if (!sentAtByDocument.has(log.documentId)) {
      sentAtByDocument.set(log.documentId, log.createdAt);
    }
  }

  const calendar = calendarFromOrg(org);

  return items.map((item) => {
    const targets = resolve(item);
    const sentAt = sentAtByDocument.get(item.documentId) ?? null;
    const startedAt = slaClockStart(item);

    return {
      inboxItemId: item.id,
      // Attribute to the vendor named ON THE INVOICE, not to whichever record
      // supplied the target — a keyword-matched target must never make the
      // dashboard blame a different company for this invoice's breach.
      vendorLabel: resolveOcrVendorName(item.extractedData) ?? targets.vendorLabel ?? null,
      targets,
      startedFrom: item.receivedAt ? ('mail-server' as const) : ('ingest' as const),
      sentAt,
      internal: evaluateSla({
        startedAt,
        completedAt: sentAt,
        targetHours: targets.internalHours,
        calendar,
        now,
      }),
      endToEnd: evaluateSla({
        startedAt,
        completedAt: item.document.completedAt,
        targetHours: targets.endToEndHours,
        calendar,
        now,
      }),
      // From the send, not from arrival: this leg is the signer's, and starting
      // it at arrival would charge them for however long the invoice sat with us
      // before anyone asked for a signature.
      //
      // A rejected document has no clock either. The signer answered — with a
      // refusal, which is a different problem — and leaving the clock running
      // would park a permanently-growing "waiting on signature" breach in the
      // chase list for something nobody is ever going to sign.
      signing:
        sentAt && item.document.status !== 'REJECTED'
          ? evaluateSla({
              startedAt: sentAt,
              completedAt: item.document.completedAt,
              targetHours: targets.signingHours,
              calendar,
              now,
            })
          : null,
    };
  });
};
