import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { LockIcon, Loader } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { match } from 'ts-pattern';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { isApproachingLimit } from '@documenso/ee/server-only/limits/thresholds';
import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '@documenso/lib/constants/time-zones';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { mergePdfFiles } from '@documenso/lib/universal/pdf-merge';
import { putPdfFile } from '@documenso/lib/universal/upload/put-file';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { DocumentDropzone } from '@documenso/ui/primitives/document-upload';
import { Input } from '@documenso/ui/primitives/input';
import { Popover, PopoverContent, PopoverTrigger } from '@documenso/ui/primitives/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@documenso/ui/primitives/tooltip';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useOptionalCurrentTeam } from '~/providers/team';

export type DocumentUploadDropzoneProps = {
  className?: string;
};

export const DocumentUploadDropzone = ({ className }: DocumentUploadDropzoneProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { user } = useSession();
  const { folderId } = useParams();

  const team = useOptionalCurrentTeam();

  const navigate = useNavigate();
  const analytics = useAnalytics();

  const userTimezone =
    TIME_ZONES.find((timezone) => timezone === Intl.DateTimeFormat().resolvedOptions().timeZone) ??
    DEFAULT_DOCUMENT_TIME_ZONE;

  const { quota, remaining, refreshLimits } = useLimits();

  const [isLoading, setIsLoading] = useState(false);
  const [lockPdf, setLockPdf] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [lockPasswordConfirm, setLockPasswordConfirm] = useState('');

  const { mutateAsync: createDocument } = trpc.document.createDocument.useMutation();

  const disabledMessage = useMemo(() => {
    if (remaining.documents === 0) {
      return team
        ? msg`Document upload disabled due to unpaid invoices`
        : msg`You have reached your signature request limit.`;
    }

    if (!user.emailVerified) {
      return msg`Verify your email to upload documents.`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining.documents, user.emailVerified, team]);

  const onFileDrop = async (files: File[]) => {
    try {
      // Validate password fields if Lock PDF is enabled
      if (lockPdf) {
        if (lockPassword.length < 4) {
          toast({
            title: _(msg`Password too short`),
            description: _(msg`Lock password must be at least 4 characters.`),
            variant: 'destructive',
          });
          return;
        }
        if (lockPassword !== lockPasswordConfirm) {
          toast({
            title: _(msg`Passwords do not match`),
            description: _(msg`Please confirm the same password in both fields.`),
            variant: 'destructive',
          });
          return;
        }
      }

      setIsLoading(true);

      // Merge multiple PDFs into one if needed
      const file = files.length > 1 ? await mergePdfFiles(files) : files[0];

      const response = await putPdfFile(file);

      const { id } = await createDocument({
        title: file.name,
        documentDataId: response.id,
        timezone: userTimezone,
        folderId: folderId ?? undefined,
        pdfPassword: lockPdf ? lockPassword : undefined,
      });

      void refreshLimits();

      toast({
        title: _(msg`Document uploaded`),
        description: _(msg`Your document has been uploaded successfully.`),
        duration: 5000,
      });

      analytics.capture('App: Document Uploaded', {
        userId: user.id,
        documentId: id,
        timestamp: new Date().toISOString(),
      });

      await navigate(
        folderId
          ? `${formatDocumentsPath(team?.url)}/f/${folderId}/${id}/edit`
          : `${formatDocumentsPath(team?.url)}/${id}/edit`,
      );
    } catch (err) {
      const error = AppError.parseError(err);

      console.error(err);

      const errorMessage = match(error.code)
        .with('INVALID_DOCUMENT_FILE', () => msg`You cannot upload encrypted PDFs`)
        .with(
          AppErrorCode.LIMIT_EXCEEDED,
          () => msg`You have reached your signature request limit for this month. Please upgrade your plan.`,
        )
        .otherwise(() => msg`An error occurred while uploading your document.`);

      toast({
        title: _(msg`Error`),
        description: _(errorMessage),
        variant: 'destructive',
        duration: 7500,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onFileDropRejected = () => {
    toast({
      title: _(msg`Your document failed to upload.`),
      description: _(msg`File cannot be larger than ${APP_DOCUMENT_UPLOAD_SIZE_LIMIT}MB`),
      duration: 5000,
      variant: 'destructive',
    });
  };

  return (
    <div className={cn('group/upload relative inline-flex items-center gap-1.5', className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DocumentDropzone
                disabled={remaining.documents === 0 || !user.emailVerified}
                disabledMessage={disabledMessage}
                onDrop={onFileDrop}
                onDropRejected={onFileDropRejected}
              />
            </div>
          </TooltipTrigger>
          {team?.id === undefined &&
            remaining.documents > 0 &&
            Number.isFinite(remaining.documents) && (
              <TooltipContent>
                <p
                  className={cn(
                    'text-sm',
                    isApproachingLimit(quota.documents, remaining.documents) &&
                      'font-medium text-amber-600 dark:text-amber-400',
                  )}
                >
                  <Trans>
                    {remaining.documents} of {quota.documents} signature requests remaining this month.
                  </Trans>
                </p>
              </TooltipContent>
            )}
        </Tooltip>
      </TooltipProvider>

      {/* Lock toggle — slides in on hover next to the upload button.
          Always visible on touch devices (no hover state) and when lock is on. */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-all hover:bg-muted hover:text-foreground',
              // Hidden by default on hover-capable devices, revealed on hover
              'w-0 overflow-hidden border-0 opacity-0 group-hover/upload:w-9 group-hover/upload:border group-hover/upload:opacity-100',
              // Always visible on touch devices and when lock is enabled
              '[@media(hover:none)]:w-9 [@media(hover:none)]:border [@media(hover:none)]:opacity-100',
              lockPdf &&
                '!w-9 !border-primary !bg-primary/10 !text-primary !opacity-100',
            )}
            title={lockPdf ? 'PDF lock enabled' : 'Lock PDF with password'}
          >
            <LockIcon className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={lockPdf}
              onChange={(e) => setLockPdf(e.target.checked)}
            />
            <Trans>Lock PDF with password</Trans>
          </label>
          <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
            <Trans>Applied to the final signed PDF.</Trans>
          </p>

          {lockPdf && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  <Trans>Password</Trans>
                </label>
                <Input
                  type="password"
                  className="mt-1 h-8 text-[13px]"
                  placeholder="At least 4 characters"
                  value={lockPassword}
                  onChange={(e) => setLockPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  <Trans>Confirm</Trans>
                </label>
                <Input
                  type="password"
                  className="mt-1 h-8 text-[13px]"
                  placeholder="Re-enter password"
                  value={lockPasswordConfirm}
                  onChange={(e) => setLockPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <p className="text-[11px] text-amber-700">
                <Trans>
                  Save this password — once signed, the system discards it and you must share
                  it with recipients yourself.
                </Trans>
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {isLoading && (
        <div className="bg-background/50 absolute inset-0 flex items-center justify-center rounded-lg">
          <Loader className="text-muted-foreground h-12 w-12 animate-spin" />
        </div>
      )}
    </div>
  );
};
