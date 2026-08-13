import { Hono } from 'hono';

/**
 * Collector for `Content-Security-Policy[-Report-Only]` violation reports.
 *
 * The point of this endpoint is the report-only phase: we need to know what a
 * real enforcing policy would have broken before flipping
 * `NEXT_PRIVATE_CSP_MODE=enforce`. It is unauthenticated by necessity — the
 * browser posts these with no credentials — so it has to be cheap and
 * unbounded-input safe: anyone on the internet can POST here all day.
 *
 * Defences: a hard body cap, a bounded dedupe map, and one log line per
 * distinct (directive, blocked origin) per window rather than per report.
 */

/** Reports are small; anything larger is not a browser being helpful. */
const MAX_BODY_BYTES = 16 * 1024;

/** How often the same violation is allowed to produce a log line. */
const LOG_WINDOW_MS = 10 * 60 * 1000;

/** Cap on distinct violations tracked, so a fuzzer can't grow this forever. */
const MAX_TRACKED_VIOLATIONS = 500;

type ViolationRecord = {
  count: number;
  firstSeenAt: number;
  lastLoggedAt: number;
};

const seenViolations = new Map<string, ViolationRecord>();

type NormalisedViolation = {
  directive: string;
  blocked: string;
  documentUri: string;
  sample: string;
};

/**
 * Browsers disagree on the payload: `report-uri` sends a `csp-report` object
 * with kebab-case keys, `report-to` sends an array of reports with camelCase
 * keys. Accept both so we aren't blind on whichever browser reports first.
 */
const normaliseReports = (payload: unknown): NormalisedViolation[] => {
  const reports: NormalisedViolation[] = [];

  const push = (report: Record<string, unknown>) => {
    const directive = String(
      report['effective-directive'] ??
        report.effectiveDirective ??
        report['violated-directive'] ??
        report.violatedDirective ??
        'unknown',
    );

    const blocked = String(report['blocked-uri'] ?? report.blockedURL ?? 'unknown');
    const documentUri = String(report['document-uri'] ?? report.documentURL ?? 'unknown');
    const sample = String(report['script-sample'] ?? report.sample ?? '');

    reports.push({ directive, blocked, documentUri, sample });
  };

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry && typeof entry === 'object' && 'body' in entry) {
        const body = (entry as { body?: unknown }).body;

        if (body && typeof body === 'object') {
          push(body as Record<string, unknown>);
        }
      }
    }

    return reports;
  }

  if (payload && typeof payload === 'object') {
    const cspReport = (payload as { 'csp-report'?: unknown })['csp-report'];

    if (cspReport && typeof cspReport === 'object') {
      push(cspReport as Record<string, unknown>);
    }
  }

  return reports;
};

/**
 * Group by directive plus the *origin* that was blocked. Per-URL keys would let
 * a single page with many blocked assets flood the map.
 */
const violationKey = ({ directive, blocked }: NormalisedViolation): string => {
  let blockedOrigin = blocked;

  try {
    blockedOrigin = new URL(blocked).origin;
  } catch {
    // `blocked-uri` is often a bare token like "inline", "eval" or "data".
  }

  return `${directive}|${blockedOrigin}`;
};

/** True when this violation is novel enough to deserve a log line. */
const shouldLog = (key: string, now: number): boolean => {
  const existing = seenViolations.get(key);

  if (!existing) {
    if (seenViolations.size >= MAX_TRACKED_VIOLATIONS) {
      // Full — count it against an overflow bucket instead of evicting real
      // entries, otherwise a fuzzer could push out the violations we care about.
      return false;
    }

    seenViolations.set(key, { count: 1, firstSeenAt: now, lastLoggedAt: now });

    return true;
  }

  existing.count += 1;

  if (now - existing.lastLoggedAt < LOG_WINDOW_MS) {
    return false;
  }

  existing.lastLoggedAt = now;

  return true;
};

export const cspReportRoute = new Hono();

cspReportRoute.post('/', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);

  if (contentLength > MAX_BODY_BYTES) {
    return c.body(null, 413);
  }

  const raw = await c.req.text().catch(() => '');

  if (!raw || raw.length > MAX_BODY_BYTES) {
    return c.body(null, 204);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return c.body(null, 204);
  }

  const now = Date.now();

  for (const violation of normaliseReports(payload)) {
    const key = violationKey(violation);

    if (!shouldLog(key, now)) {
      continue;
    }

    const { count } = seenViolations.get(key) ?? { count: 1 };

    // Deliberately console.error, not the debug logger: these only exist while
    // we're tuning the policy and they need to reach production logs.
    console.error(
      `[CSP] ${violation.directive} blocked ${violation.blocked} on ${violation.documentUri}` +
        `${violation.sample ? ` (sample: ${violation.sample.slice(0, 120)})` : ''} [x${count}]`,
    );
  }

  // 204 keeps browsers from retrying or logging a failed report.
  return c.body(null, 204);
});
