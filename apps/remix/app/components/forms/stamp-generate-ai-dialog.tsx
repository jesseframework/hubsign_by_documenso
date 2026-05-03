import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { Sparkles } from 'lucide-react';

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
import { Label } from '@documenso/ui/primitives/label';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { useToast } from '@documenso/ui/primitives/use-toast';

const EXAMPLE_PROMPTS = [
  'Round red APPROVED stamp with a thin border and the date placeholder',
  'Rectangular CONFIDENTIAL banner in dark blue with white text',
  'Soft circular signed-and-sealed stamp with the company name in the middle',
];

export type StampGenerateAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
};

export const StampGenerateAiDialog = ({
  open,
  onOpenChange,
  onCreated,
}: StampGenerateAiDialogProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');

  const utils = trpc.useUtils();
  const { mutateAsync: generate, isPending } = trpc.stamp.generateFromPrompt.useMutation({
    onSuccess: () => utils.stamp.list.invalidate(),
  });

  const close = () => {
    setPrompt('');
    onOpenChange(false);
  };

  const onSubmit = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 5) {
      toast({
        title: _(msg`Prompt is too short`),
        description: _(msg`Describe the stamp in a sentence or two and try again.`),
        variant: 'destructive',
      });
      return;
    }
    try {
      await generate({ prompt: trimmed });
      toast({ title: _(msg`Stamp generated`), duration: 3000 });
      onCreated?.();
      close();
    } catch (err) {
      toast({
        title: _(msg`Couldn't generate stamp`),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4" />
            <Trans>Generate stamp with AI</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Describe the stamp you want and we'll design it. The result is added to your library
              like any other stamp — drop it onto a document the same way.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="ai-prompt">
            <Trans>Describe the stamp</Trans>
          </Label>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={800}
            placeholder={_(msg`e.g. Round red APPROVED stamp with the company name and today's date`)}
            disabled={isPending}
          />

          <div>
            <p className="text-muted-foreground text-xs font-medium">
              <Trans>Try one of these</Trans>
            </p>
            <ul className="mt-1 space-y-1">
              {EXAMPLE_PROMPTS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => setPrompt(p)}
                    className="text-primary hover:underline text-xs"
                    disabled={isPending}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={isPending}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={onSubmit} loading={isPending} disabled={prompt.trim().length < 5}>
            <Sparkles className="mr-2 h-4 w-4" />
            <Trans>Generate</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
