import sharp from 'sharp';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { AiBridgeError, callAiBridge } from '../ai/bridge';
import { isAiConfiguredForOrg, resolveAiApiKey } from '../ai/resolve-ai-key';

/**
 * AI Studio — generate a stamp from a natural-language description.
 *
 * Slice 3 implementation strategy: Claude returns an SVG (vector) which we
 * rasterize to PNG and persist exactly like a user-uploaded stamp. This lets
 * us reuse the entire UPLOADED → DocumentData → embed-on-PDF pipeline with
 * zero new code. Layout-JSON re-edit support comes later in Slice 2.
 *
 * Runs through the WorkHub AI bridge with a single forced tool call to enforce
 * structured output (the SVG string), vendor-pinned to Anthropic because the
 * prompt is tuned for Claude's SVG output. Bails clean if the bridge isn't
 * configured, so the feature can ship dark.
 */

/** The AI key is per-organization, configured on the AI Credits screen. */
export const isAiStampGenerationConfigured = (organizationId: number | null) =>
  isAiConfiguredForOrg(organizationId);

export type GenerateStampOptions = {
  /** Whose AI key to bill this against. */
  organizationId: number;
  prompt: string;
  /** Optional context the model can fold into the design. */
  organizationName?: string;
  primaryColor?: string;
};

export type GeneratedStamp = {
  /** Re-encoded PNG bytes ready to persist. */
  png: Buffer;
  /** Suggested name derived from the prompt. */
  name: string;
  /** Raw SVG returned by the model — stored for provenance / re-edit later. */
  svg: string;
};

const SYSTEM_PROMPT = `You design clean, professional document stamps.
Output ONE valid SVG that:
- has a viewBox (200×200 default unless the prompt clearly says rectangular, then 320×160)
- uses standard fonts (Arial, Helvetica, Times) — no @import or <style> with web fonts
- contains no <script>, no external <image href> references, no foreignObject
- uses plain SVG primitives (rect, circle, ellipse, path, text, line, polygon)
- has a transparent background unless the prompt says otherwise
- is high-contrast and reads at small sizes
- represents one stamp impression — no decorations beyond the stamp itself
Always call the render_stamp tool with the SVG string and a short "name" (under 40 chars).
Do NOT respond with any text outside the tool call.`;

const RENDER_STAMP_TOOL = {
  name: 'render_stamp',
  description: 'Submit the final SVG for the stamp.',
  // `parameters`, not Anthropic's `input_schema` — the bridge takes one neutral
  // shape and translates per vendor.
  parameters: {
    type: 'object' as const,
    required: ['svg', 'name'],
    properties: {
      svg: {
        type: 'string' as const,
        description: 'A complete, self-contained <svg>...</svg> document.',
      },
      name: {
        type: 'string' as const,
        description: 'Short display name for the stamp (under 40 chars).',
      },
    },
  },
};

/**
 * Reject SVGs that contain things sharp/librsvg might honor unsafely or that
 * we explicitly told the model to avoid. Cheap sanity check on top of librsvg
 * already dropping <script> and external resources at render time.
 */
const sanitizeSvg = (svg: string) => {
  const lower = svg.toLowerCase();
  if (lower.includes('<script')) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'AI returned an SVG containing a script tag — refusing to render.',
    });
  }
  if (/<image[^>]+href\s*=\s*["']?https?:/i.test(svg)) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'AI returned an SVG with an external image reference — refusing to render.',
    });
  }
  if (lower.includes('<foreignobject')) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'AI returned an SVG with foreignObject — refusing to render.',
    });
  }
  return svg.trim();
};

export const generateStampFromPrompt = async ({
  organizationId,
  prompt,
  organizationName,
  primaryColor,
}: GenerateStampOptions): Promise<GeneratedStamp> => {
  const apiKey = await resolveAiApiKey(organizationId);
  if (!apiKey) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message:
        'AI stamp generation isn\'t set up — an organization admin needs to add an AI key on the AI Credits screen.',
    });
  }

  const userMessage = [
    `Design a stamp matching this brief: ${prompt}`,
    organizationName ? `Organization name (use if relevant): "${organizationName}".` : null,
    primaryColor ? `Brand primary color (use if appropriate): ${primaryColor}.` : null,
  ]
    .filter(Boolean)
    .join('\n');

  let result;
  try {
    result = await callAiBridge({
      apiKey,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      tools: [RENDER_STAMP_TOOL],
      toolChoice: { name: RENDER_STAMP_TOOL.name },
      model: 'claude-sonnet-4-6',
      vendor: 'anthropic',
      maxTokens: 4000,
    });
  } catch (err) {
    // This used to deliberately surface the vendor's own text — the comment
    // here named "credit balance too low" as a case worth passing through.
    // That is precisely the message that reads, to a user, as their HubSign
    // credits being gone. The bridge maps it; the raw text stays in its log.
    if (err instanceof AiBridgeError) {
      throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: err.userMessage });
    }
    throw err;
  }

  const call = result.toolCalls.find((toolCall) => toolCall.name === RENDER_STAMP_TOOL.name);

  let input: { svg?: string; name?: string } = {};
  try {
    input = call ? (JSON.parse(call.arguments) as { svg?: string; name?: string }) : {};
  } catch {
    // Falls through to the "no usable stamp" message below.
  }

  if (!input.svg) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'AI did not return a usable stamp. Please rephrase the prompt and try again.',
    });
  }

  const svg = sanitizeSvg(input.svg);
  const name = (input.name ?? '').trim().slice(0, 40) || 'AI stamp';

  // Rasterize the SVG to a high-resolution PNG so it stays sharp at any scale
  // on the PDF. 800px is a good balance — large enough for retina rendering,
  // small enough to keep the stored bytes under our 2 MB cap.
  const png = await sharp(Buffer.from(svg))
    .resize({ width: 800, withoutEnlargement: false, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, name, svg };
};
