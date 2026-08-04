/** Fraction of quota used at which UI should start warning before the hard block at 100%. */
export const LIMIT_WARNING_THRESHOLD = 0.8;

/**
 * `remaining` here is always plain quota minus usage (see `getServerLimits`), so this
 * derives the "approaching" state without needing any new fields on `/api/limits`.
 */
export const isApproachingLimit = (quota: number, remaining: number): boolean => {
  if (!Number.isFinite(quota) || quota <= 0 || remaining <= 0) {
    return false;
  }

  const used = quota - remaining;

  return used / quota >= LIMIT_WARNING_THRESHOLD;
};
