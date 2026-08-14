/**
 * Carries a signup-time plan selection (from the marketing site's
 * `?plan=<slug>` link) across the email-verification gap — signup itself
 * creates no session (email must be verified first), so this can't ride on
 * auth state. `SameSite=Lax` is load-bearing: the primary path is clicking
 * the verification link in an email client, a cross-site top-level GET,
 * which a `Strict` cookie would not survive in most browsers.
 */
const PENDING_PLAN_COOKIE = 'hubsign_pending_plan';
const PENDING_PLAN_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day

export const PENDING_PLAN_SLUGS = ['free', 'individual', 'team', 'business', 'enterprise'] as const;

export type PendingPlanSlug = (typeof PENDING_PLAN_SLUGS)[number];

export const isPendingPlanSlug = (value: string | null): value is PendingPlanSlug =>
  value !== null && (PENDING_PLAN_SLUGS as readonly string[]).includes(value);

export const setPendingPlanCookie = (slug: PendingPlanSlug): void => {
  document.cookie = `${PENDING_PLAN_COOKIE}=${slug}; Path=/; Max-Age=${PENDING_PLAN_MAX_AGE_SECONDS}; SameSite=Lax`;
};

export const getPendingPlanCookie = (): PendingPlanSlug | null => {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${PENDING_PLAN_COOKIE}=`));

  const value = match?.slice(PENDING_PLAN_COOKIE.length + 1) ?? null;

  return isPendingPlanSlug(value) ? value : null;
};

export const clearPendingPlanCookie = (): void => {
  document.cookie = `${PENDING_PLAN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};
