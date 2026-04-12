import { Trans } from '@lingui/react/macro';
import { Mails } from 'lucide-react';

import { BrandingLogo } from '~/components/general/branding-logo';
import { SendConfirmationEmailForm } from '~/components/forms/send-confirmation-email';

export default function UnverifiedAccount() {
  return (
    <div className="w-full px-4">
      <div className="mb-8 flex justify-center">
        <BrandingLogo className="h-10 w-auto" />
      </div>

      <div className="rounded-[var(--r)] border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Mails className="mt-1 hidden h-8 w-8 flex-shrink-0 text-primary md:block" strokeWidth={1.8} />

          <div>
            <h2 className="text-xl font-semibold">
              <Trans>Confirm email</Trans>
            </h2>

            <p className="text-muted-foreground mt-3 text-[13px]">
              <Trans>
                To gain access to your account, please confirm your email address by clicking on the
                confirmation link from your inbox.
              </Trans>
            </p>

            <p className="text-muted-foreground mt-3 text-[13px]">
              <Trans>
                If you don't find the confirmation link in your inbox, you can request a new one
                below.
              </Trans>
            </p>

            <SendConfirmationEmailForm />
          </div>
        </div>
      </div>
    </div>
  );
}
