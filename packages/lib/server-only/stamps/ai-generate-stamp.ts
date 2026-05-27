import sharp from 'sharp';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { env } from '../../utils/env';

/**
 * AI Studio — generate a stamp from a natural-language description.
 *
 * Slice 3 implementation strategy: Claude returns an SVG (vector) which we
 * rasterize to PNG and persist exactly like a user-uploaded stamp. This lets
 * us reuse the entire UPLOADED → DocumentData → embed-on-PDF pipeline with
 * zero new code. Layout-JSON re-edit support comes later in Slice 2.
 *
 * Calls Anthropic's Messages API with a single forced-tool to enforce
 * structured output (the SVG string).
 *
 * Bails clean if NEXT_PRIVATE_ANTHROPIC_API_KEY isn't set so the feature can
 * ship dark on deployments without a key.
 */

export const isAiStampGenerationConfigured = () =>
  Boolean(env('NEXT_PRIVATE_ANTHROPIC_API_KEY'));

export type GenerateStampOptions = {
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
  input_schema: {
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
  prompt,
  organizationName,
  primaryColor,
}: GenerateStampOptions): Promise<GeneratedStamp> => {
  const apiKey = env('NEXT_PRIVATE_ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new AppError(AppErrorCode.NOT_SETUP, {
      message: 'AI stamp generation isn\'t configured for this deployment.',
    });
  }

  const userMessage = [
    `Design a stamp matching this brief: ${prompt}`,
    organizationName ? `Organization name (use if relevant): "${organizationName}".` : null,
    primaryColor ? `Brand primary color (use if appropriate): ${primaryColor}.` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [RENDER_STAMP_TOOL],
      tool_choice: { type: 'tool', name: 'render_stamp' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[ai-stamp] Anthropic API failed:', response.status, text);

    // Surface the real Anthropic error message when present (e.g. credit
    // balance too low, rate limited, invalid model). Falls back to a
    // generic message if parsing fails.
    let detail = '';
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? '';
    } catch {
      // ignore parse failure
    }

    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: detail || `AI generation failed (${response.status}). Please try again.`,
    });
  }

  const body = (await response.json()) as {
    content: Array<{ type: string; name?: string; input?: { svg?: string; name?: string } }>;
  };

  const toolUse = body.content?.find((c) => c.type === 'tool_use' && c.name === 'render_stamp');
  if (!toolUse?.input?.svg) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'AI did not return a usable stamp. Please rephrase the prompt and try again.',
    });
  }

  const svg = sanitizeSvg(toolUse.input.svg);
  const name = (toolUse.input.name ?? '').trim().slice(0, 40) || 'AI stamp';

  // Rasterize the SVG to a high-resolution PNG so it stays sharp at any scale
  // on the PDF. 800px is a good balance — large enough for retina rendering,
  // small enough to keep the stored bytes under our 2 MB cap.
  const png = await sharp(Buffer.from(svg))
    .resize({ width: 800, withoutEnlargement: false, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, name, svg };
};
