/** Compact relative time (e.g. "Just now", "5m ago", "11h ago", "1d ago"), WorkHub/Outlook-style. */
export const formatRelativeTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const diffWeek = Math.round(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}w ago`;

  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
