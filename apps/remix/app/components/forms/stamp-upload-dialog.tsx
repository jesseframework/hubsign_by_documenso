import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ImageIcon, UploadCloud, X } from 'lucide-react';
import { ErrorCode, useDropzone } from 'react-dropzone';
import { useForm } from 'react-hook-form';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { putFile } from '@documenso/lib/universal/upload/put-file';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
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

const STAMP_MAX_BYTES = 2 * 1024 * 1024;

const ZStampUploadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: msg`Please enter a name for the stamp.`.id })
    .max(80),
});

type TStampUploadSchema = z.infer<typeof ZStampUploadSchema>;

export type StampUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export const StampUploadDialog = ({
  open,
  onOpenChange,
  onCreated,
}: StampUploadDialogProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<TStampUploadSchema>({
    resolver: zodResolver(ZStampUploadSchema),
    defaultValues: { name: '' },
  });

  const { mutateAsync: createUploaded } = trpc.stamp.createUploaded.useMutation();
  const utils = trpc.useUtils();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/svg+xml': ['.svg'],
    },
    maxSize: STAMP_MAX_BYTES,
    multiple: false,
    onDropAccepted: ([f]) => {
      setFile(f);
      const url = URL.createObjectURL(f);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      // Auto-fill the name from the filename if the user hasn't typed one yet.
      if (!form.getValues('name')) {
        form.setValue('name', f.name.replace(/\.[^.]+$/, '').slice(0, 80));
      }
    },
    onDropRejected: ([f]) => {
      const code = f.errors[0]?.code;
      const message = match(code)
        .with(ErrorCode.FileTooLarge, () => _(msg`That image is too large (max 2 MB).`))
        .with(ErrorCode.FileInvalidType, () => _(msg`Stamps must be PNG, JPEG, or SVG.`))
        .otherwise(() => _(msg`We couldn't accept that file.`));
      toast({ title: _(msg`Upload rejected`), description: message, variant: 'destructive' });
    },
  });

  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    form.reset();
    onOpenChange(false);
  };

  const onSubmit = async ({ name }: TStampUploadSchema) => {
    if (!file) {
      toast({
        title: _(msg`Pick an image first`),
        description: _(msg`Drop a PNG, JPEG, or SVG file in the upload box above.`),
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      // Reuse the existing universal uploader so the bytes go to S3 (when
      // configured) or the database otherwise.
      const { type, data } = await putFile(file);
      await createUploaded({
        name,
        fileType: type,
        fileData: data,
      });
      await utils.stamp.list.invalidate();
      toast({ title: _(msg`Stamp added`), duration: 3000 });
      onCreated?.();
      close();
    } catch (err) {
      console.error('[stamps] upload failed:', err);
      toast({
        title: _(msg`Couldn't save stamp`),
        description: _(msg`Something went wrong while uploading. Please try again.`),
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Add a stamp</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Upload an image to use as a stamp on your documents. PNG, JPEG, and SVG up to 2 MB.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div
              {...getRootProps()}
              className={`flex min-h-[160px] cursor-pointer items-center justify-center rounded-md border-2 border-dashed p-4 transition-colors ${
                isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
              }`}
            >
              <input {...getInputProps()} />
              {previewUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={previewUrl}
                    alt="Stamp preview"
                    className="max-h-32 max-w-full object-contain"
                  />
                  <p className="text-muted-foreground text-xs">
                    <Trans>Click or drop another file to replace.</Trans>
                  </p>
                </div>
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-2 text-center">
                  <UploadCloud className="h-8 w-8" />
                  <p className="text-sm">
                    <Trans>Drop an image here, or click to browse.</Trans>
                  </p>
                  <p className="text-xs">
                    <Trans>PNG · JPEG · SVG · 2 MB max</Trans>
                  </p>
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans>Stamp name</Trans>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={_(msg`e.g. Approved`)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close} disabled={isUploading}>
                <Trans>Cancel</Trans>
              </Button>
              <Button type="submit" loading={isUploading} disabled={!file}>
                <Trans>Save stamp</Trans>
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
