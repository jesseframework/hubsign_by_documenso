import { redirect } from 'react-router';

/** Convenience alias matching the `Repository` nav label. */
export function loader() {
  throw redirect('/dms/documents');
}
