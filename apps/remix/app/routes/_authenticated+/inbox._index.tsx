import { redirect } from 'react-router';

/** Convenience alias — `Inbox` is a top-level idea, so give it a top-level URL. */
export function loader() {
  throw redirect('/org/inbox');
}
