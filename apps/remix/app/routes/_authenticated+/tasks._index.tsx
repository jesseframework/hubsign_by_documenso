import { redirect } from 'react-router';

/**
 * Shell route for the Tasks surface.
 *
 * Approvals and Retrievals are two queues of "things waiting on me", so the nav
 * offers them as one destination with tabs. The tabs themselves still point at
 * the original routes — this only gives the sidebar row a stable href to own,
 * which is why `Tasks` is matched by surface rather than by path.
 */
export function loader() {
  throw redirect('/org/approvals');
}
