import { AubreyChat } from '~/components/general/aubrey/aubrey-chat';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Aubrey AI');
}

export default function AubreyPage() {
  return <AubreyChat />;
}
