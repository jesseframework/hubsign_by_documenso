import { useEffect, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { authClient } from '@documenso/auth/client';
import { ONE_SECOND } from '@documenso/lib/constants/time';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

export const ZSendConfirmationEmailFormSchema = z.object({
  email: z.string().email().min(1),
});

export type TSendConfirmationEmailFormSchema = z.infer<typeof ZSendConfirmationEmailFormSchema>;

export type SendConfirmationEmailFormProps = {
  className?: string;
};

// Mirrors the flat cooldown `verify-email-banner.tsx` uses for the same
// action elsewhere in the app — kept the same value for consistency. The
// server's own resend guard (`sendConfirmationToken`) is a stricter 5
// minutes; this shorter client-side window just stops rapid re-clicking,
// it's not the real anti-spam limit.
const RESEND_CONFIRMATION_EMAIL_COOLDOWN_SECONDS = 20;

export const SendConfirmationEmailForm = ({ className }: SendConfirmationEmailFormProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const [hasSentOnce, setHasSentOnce] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const form = useForm<TSendConfirmationEmailFormSchema>({
    values: {
      email: '',
    },
    resolver: zodResolver(ZSendConfirmationEmailFormSchema),
  });

  const isSubmitting = form.formState.isSubmitting;
  const isCoolingDown = cooldownSeconds > 0;

  useEffect(() => {
    const interval = setInterval(() => {
      setCooldownSeconds((seconds) => (seconds > 0 ? seconds - 1 : 0));
    }, ONE_SECOND);

    return () => clearInterval(interval);
  }, []);

  const onFormSubmit = async ({ email }: TSendConfirmationEmailFormSchema) => {
    try {
      await authClient.emailPassword.resendVerifyEmail({ email });

      toast({
        title: _(msg`Confirmation email sent`),
        description: _(
          msg`A confirmation email has been sent, and it should arrive in your inbox shortly.`,
        ),
        duration: 5000,
      });

      setHasSentOnce(true);
      setCooldownSeconds(RESEND_CONFIRMATION_EMAIL_COOLDOWN_SECONDS);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: _(msg`An error occurred while sending your confirmation email`),
        description: _(msg`Please try again and make sure you enter the correct email address.`),
      });
    }
  };

  const buttonLabel = !hasSentOnce ? (
    <Trans>Send confirmation email</Trans>
  ) : isCoolingDown ? (
    <Trans>Resend confirmation email ({cooldownSeconds}s)</Trans>
  ) : (
    <Trans>Resend confirmation email</Trans>
  );

  return (
    <Form {...form}>
      <form
        className={cn('mt-6 flex w-full flex-col gap-y-4', className)}
        onSubmit={form.handleSubmit(onFormSubmit)}
      >
        <fieldset className="flex w-full flex-col gap-y-4" disabled={isSubmitting}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Email address</Trans>
                </FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormMessage />

          <Button
            size="lg"
            type="submit"
            disabled={isSubmitting || isCoolingDown}
            loading={isSubmitting}
          >
            {buttonLabel}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
};
