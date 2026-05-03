import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Building2, ImageIcon, Lock, MoreHorizontal, Plus, Sparkles, Trash2 } from 'lucide-react';

import { getFile } from '@documenso/lib/universal/upload/get-file';
import { trpc } from '@documenso/trpc/react';
import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { StampGenerateAiDialog } from '~/components/forms/stamp-generate-ai-dialog';
import { StampUploadDialog } from '~/components/forms/stamp-upload-dialog';

export type StampLibraryProps = Record<string, never>;

type StampPreviewAsset = {
  id: string;
  type: 'S3_PATH' | 'BYTES' | 'BYTES_64';
  data: string;
};

const StampPreview = ({
  asset,
  alt,
}: {
  asset: StampPreviewAsset | null;
  alt: string;
}) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    let revoked: string | null = null;
    let cancelled = false;
    void getFile(asset).then((bytes) => {
      if (cancelled) return;
      const blob = new Blob([bytes], { type: 'image/png' });
      revoked = URL.createObjectURL(blob);
      setSrc(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [asset]);

  if (!asset) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center">
        <ImageIcon className="h-8 w-8" />
      </div>
    );
  }

  if (!src) {
    return <div className="bg-muted h-full w-full animate-pulse" />;
  }

  return <img src={src} alt={alt} className="h-full w-full object-contain" />;
};

export const StampLibrary = (_props: StampLibraryProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const { data: enabledData, isLoading: isCheckingEnabled } = trpc.stamp.isEnabled.useQuery();
  const isEnabled = enabledData?.enabled ?? false;
  const hasOrg = enabledData?.hasOrganization ?? false;

  const { data: aiAvailability } = trpc.stamp.aiAvailable.useQuery(undefined, {
    enabled: isEnabled,
  });
  const aiAvailable = aiAvailability?.available ?? false;

  const { data: stamps, isLoading } = trpc.stamp.list.useQuery(undefined, { enabled: isEnabled });

  const utils = trpc.useUtils();
  const { mutateAsync: deleteStamp, isPending: isDeleting } = trpc.stamp.delete.useMutation({
    onSuccess: () => utils.stamp.list.invalidate(),
  });

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(_(msg`Delete stamp "${name}"? This cannot be undone.`))) return;
    try {
      await deleteStamp({ id });
      toast({ title: _(msg`Stamp deleted`) });
    } catch {
      toast({
        title: _(msg`Couldn't delete stamp`),
        variant: 'destructive',
      });
    }
  };

  if (isCheckingEnabled) {
    return <div className="bg-muted h-32 w-full animate-pulse rounded-md" />;
  }

  // No org → stamps require an organization to live under.
  if (!hasOrg) {
    return (
      <Alert variant="warning" className="max-w-2xl">
        <Building2 className="h-4 w-4" />
        <AlertTitle>
          <Trans>Stamps require an organization</Trans>
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            <Trans>
              Stamps are managed at the organization level so every member can use the same library.
              Set up an organization to enable stamps.
            </Trans>
          </p>
          <Button size="sm" asChild>
            <a href="/org/settings">
              <Trans>Set up organization</Trans>
            </a>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Has org but the org isn't on a paid plan.
  if (!isEnabled) {
    return (
      <Alert variant="warning" className="max-w-2xl">
        <Lock className="h-4 w-4" />
        <AlertTitle>
          <Trans>Stamps are a premium feature</Trans>
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            <Trans>
              Upgrade your organization plan to upload and apply custom stamps on documents.
            </Trans>
          </p>
          <Button size="sm" asChild>
            <a href="/org/billing">
              <Trans>View plans</Trans>
            </a>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          <Trans>
            Reusable image stamps you can drop onto any document before signing. PNG, JPEG, or SVG.
          </Trans>
        </p>
        <div className="flex items-center gap-2">
          {aiAvailable && (
            <Button onClick={() => setAiOpen(true)} size="sm" variant="outline">
              <Sparkles className="mr-2 h-4 w-4" />
              <Trans>Generate with AI</Trans>
            </Button>
          )}
          <Button onClick={() => setUploadOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            <Trans>Add stamp</Trans>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-muted aspect-[3/2] animate-pulse rounded-md" />
            ))}
          </div>
        ) : !stamps || stamps.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center">
            <ImageIcon className="text-muted-foreground mx-auto h-8 w-8" />
            <p className="mt-2 text-sm font-medium">
              <Trans>No stamps yet</Trans>
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              <Trans>Upload your first stamp to get started.</Trans>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {stamps.map((stamp) => (
              <div
                key={stamp.id}
                className="bg-card group relative flex flex-col overflow-hidden rounded-md border"
              >
                <div className="bg-muted/30 flex aspect-[3/2] items-center justify-center p-3">
                  <StampPreview asset={stamp.previewAsset} alt={stamp.name} />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <p className="truncate text-sm font-medium">{stamp.name}</p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onDelete(stamp.id, stamp.name)}
                        disabled={isDeleting}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <StampUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={() => void utils.stamp.list.invalidate()}
      />

      <StampGenerateAiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        onCreated={() => void utils.stamp.list.invalidate()}
      />
    </>
  );
};
