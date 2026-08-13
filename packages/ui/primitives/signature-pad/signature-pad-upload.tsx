import { useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { motion } from 'framer-motion';
import { UploadCloudIcon } from 'lucide-react';

import { unsafe_useEffectOnce } from '@documenso/lib/client-only/hooks/use-effect-once';
import { SIGNATURE_CANVAS_DPI } from '@documenso/lib/constants/signatures';

import { cn } from '../../lib/utils';
import { type RemoveBackgroundResult, removeSignatureBackground } from './remove-background';

const loadImage = async (file: File | undefined): Promise<HTMLImageElement> => {
  if (!file) {
    throw new Error('No file selected');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid file type');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image size should be less than 5MB');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
};

const loadImageOntoCanvas = (
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): ImageData => {
  const scale = Math.min((canvas.width * 0.8) / image.width, (canvas.height * 0.8) / image.height);

  const x = (canvas.width - image.width * scale) / 2;
  const y = (canvas.height - image.height * scale) / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(image, x, y, image.width * scale, image.height * scale);

  ctx.restore();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return imageData;
};

export type SignaturePadUploadProps = {
  className?: string;
  value: string;
  onChange: (_signatureDataUrl: string) => void;
};

export const SignaturePadUpload = ({
  className,
  value,
  onChange,
  ...props
}: SignaturePadUploadProps) => {
  const $el = useRef<HTMLCanvasElement>(null);
  const $imageData = useRef<ImageData | null>(null);
  const $fileInput = useRef<HTMLInputElement>(null);
  /**
   * The file as uploaded, kept so a toggle can redraw from it.
   *
   * Re-processing the canvas instead would compound: each pass would judge the
   * result of the last one, and turning the option off could not restore what the
   * first pass had already deleted.
   */
  const $source = useRef<HTMLImageElement | null>(null);

  /*
    On by default. Nearly every upload here is a photograph or scan of a signature
    on paper, and that paper is never wanted — it lands on the document as a white
    box over whatever it covers. The preview shows the result immediately and the
    switch is right there, so a default that occasionally guesses wrong costs one
    click rather than a bad signature on a contract.
  */
  const [removeBackground, setRemoveBackground] = useState(true);
  const [sensitivity, setSensitivity] = useState(0);
  const [outcome, setOutcome] = useState<RemoveBackgroundResult | null>(null);
  /*
    State, not `$source.current`, because a ref does not re-render.

    With the option switched off the only state write on upload was
    `setOutcome(null)` — already null, so React bailed out and the controls never
    appeared, leaving no way to switch it back on.
  */
  const [uploaded, setUploaded] = useState(false);

  /** Draw the held source onto the canvas, cutting the paper if asked. */
  const render = (options?: { enabled?: boolean; sensitivity?: number }) => {
    const canvas = $el.current;
    const image = $source.current;

    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const enabled = options?.enabled ?? removeBackground;
    const nudge = options?.sensitivity ?? sensitivity;

    const imageData = loadImageOntoCanvas(image, canvas, ctx);

    if (enabled) {
      const result = removeSignatureBackground(imageData.data, { sensitivity: nudge });
      setOutcome(result);
      ctx.putImageData(imageData, 0, 0);
    } else {
      setOutcome(null);
    }

    $imageData.current = imageData;
    onChange?.(canvas.toDataURL());
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const img = await loadImage(event.target.files?.[0]);

      if (!$el.current) return;

      $source.current = img;
      setUploaded(true);
      render();
    } catch (error) {
      console.error(error);
    }
  };

  unsafe_useEffectOnce(() => {
    // Todo: Not really sure if this is required for uploaded images.
    if ($el.current) {
      $el.current.width = $el.current.clientWidth * SIGNATURE_CANVAS_DPI;
      $el.current.height = $el.current.clientHeight * SIGNATURE_CANVAS_DPI;
    }

    if ($el.current && value) {
      const ctx = $el.current.getContext('2d');

      const { width, height } = $el.current;

      const img = new Image();

      img.onload = () => {
        ctx?.drawImage(img, 0, 0, Math.min(width, img.width), Math.min(height, img.height));

        const defaultImageData = ctx?.getImageData(0, 0, width, height) || null;

        $imageData.current = defaultImageData;
      };

      img.src = value;
    }
  });

  /** Shown only once there is something to judge the result on. */
  const hasUpload = uploaded;

  return (
    <div className={cn('relative h-full w-full', className)}>
      <canvas
        data-testid="signature-pad-upload"
        ref={$el}
        className="h-full w-full dark:hue-rotate-180 dark:invert"
        style={{ touchAction: 'none' }}
        {...props}
      />

      <input
        ref={$fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      <motion.button
        className="absolute inset-0 flex h-full w-full items-center justify-center"
        initial="initial"
        animate="animate"
        whileHover="hover"
        onClick={() => $fileInput.current?.click()}
      >
        {!value && (
          <motion.div>
            <div className="text-muted-foreground flex flex-col items-center justify-center">
              <div className="flex flex-col items-center">
                <UploadCloudIcon className="h-8 w-8" />
                <span className="text-lg font-semibold">
                  <Trans>Upload Signature</Trans>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </motion.button>

      {/*
        Overlaid rather than placed below the canvas: the tab is a fixed-aspect box
        and adding a row beneath it would resize the dialog for one tab out of
        three. Sits above the upload button so the controls are clickable.
      */}
      {hasUpload && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 bg-background/85 px-2.5 py-1.5 backdrop-blur">
          <label className="text-foreground flex cursor-pointer items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer"
              checked={removeBackground}
              onChange={(e) => {
                setRemoveBackground(e.target.checked);
                render({ enabled: e.target.checked });
              }}
            />
            <Trans>Remove background</Trans>
          </label>

          {removeBackground && (
            <label className="text-muted-foreground flex flex-1 items-center gap-1.5 text-[11px]">
              <Trans>Strength</Trans>
              <input
                type="range"
                min={-40}
                max={40}
                step={4}
                value={sensitivity}
                className="h-1 max-w-[120px] flex-1 cursor-pointer"
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSensitivity(next);
                  render({ sensitivity: next });
                }}
              />
            </label>
          )}

          {/*
            Said plainly when nothing happened, because a silent no-op is
            indistinguishable from a broken feature — and both of these reasons are
            good news rather than failures.
          */}
          {removeBackground && outcome?.applied === false && (
            <span className="text-muted-foreground text-[10px]">
              {outcome.skipped === 'already-transparent' ? (
                <Trans>Already transparent</Trans>
              ) : (
                <Trans>No clear background found — left as is</Trans>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
