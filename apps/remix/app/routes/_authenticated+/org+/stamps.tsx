import { Trans } from '@lingui/react/macro';

import { StampLibrary } from '~/components/general/stamps/stamp-library';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Stamps');
}

export default function OrgStampsPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold">
        <Trans>Stamps</Trans>
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        <Trans>
          Reusable image stamps every member of this organization can drop onto a document before
          signing.
        </Trans>
      </p>

      <hr className="my-4" />

      <StampLibrary />
    </div>
  );
}
