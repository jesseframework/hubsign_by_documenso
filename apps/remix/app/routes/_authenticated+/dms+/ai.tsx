import { redirect } from 'react-router';

/**
 * The AI Agent was rebranded to "Aubrey AI" and moved out of the DMS section
 * (it is no longer gated on the DMS add-on). Keep the old /dms/ai URL working
 * for bookmarks by redirecting to the new top-level route.
 */
export function loader() {
  return redirect('/aubrey');
}

export default function DmsAiRedirect() {
  return null;
}
