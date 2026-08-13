import { redirect } from 'react-router';

/**
 * The Spend page became Reports: spend by vendor is now one saved report among
 * however many the organization builds for itself.
 *
 * Kept as a redirect rather than deleted, because this URL has been handed out and
 * a bookmark that 404s teaches people the feature was removed.
 */
export function loader() {
  throw redirect('/org/reports');
}

export default function SpendRedirect() {
  return null;
}
