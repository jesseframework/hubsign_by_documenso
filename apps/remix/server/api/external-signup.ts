import { Hono } from 'hono';

import { createUser } from '@documenso/lib/server-only/user/create-user';
import { alphaid } from '@documenso/lib/universal/id';
import { env } from '@documenso/lib/utils/env';
import { jobsClient } from '@documenso/lib/jobs/client';

// ── Rate limiter (in-memory) ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 signups per IP per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

export const externalSignupRoute = new Hono();

externalSignupRoute.post('/signup', async (c) => {
  // ── 1. API Token Auth ──
  const apiToken = env('NEXT_PRIVATE_EXTERNAL_SIGNUP_API_KEY');

  if (!apiToken) {
    return c.json({ error: 'External signup is not configured' }, 503);
  }

  const authHeader = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace('Bearer ', '');

  if (!authHeader || authHeader !== apiToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // ── 2. IP Restriction ──
  const allowedIPs = env('NEXT_PRIVATE_EXTERNAL_SIGNUP_ALLOWED_IPS');
  const clientIP =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    c.req.header('CF-Connecting-IP') ||
    'unknown';

  if (allowedIPs) {
    const ipList = allowedIPs.split(',').map((ip) => ip.trim());

    if (!ipList.includes(clientIP) && !ipList.includes('*')) {
      return c.json({ error: 'Forbidden: IP not allowed', ip: clientIP }, 403);
    }
  }

  // ── 3. Rate Limiting ──
  if (!checkRateLimit(clientIP)) {
    return c.json(
      { error: 'Too many requests. Please try again later.' },
      429,
    );
  }

  // ── 4. Parse & Validate Body ──
  let body: {
    name?: string;
    email?: string;
    password?: string;
    turnstileToken?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { name, email, password, turnstileToken } = body;

  if (!name || !email || !password) {
    return c.json({ error: 'Missing required fields: name, email, password' }, 400);
  }

  if (typeof name !== 'string' || name.trim().length < 1) {
    return c.json({ error: 'Name must be at least 1 character' }, 400);
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'Invalid email address' }, 400);
  }

  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  // ── 5. Bot Prevention (Turnstile) ──
  const turnstileSecret = env('NEXT_PRIVATE_TURNSTILE_SECRET_KEY');

  if (turnstileSecret) {
    if (!turnstileToken) {
      return c.json({ error: 'Turnstile verification token is required' }, 400);
    }

    try {
      const verifyResponse = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: turnstileSecret,
            response: turnstileToken,
            remoteip: clientIP,
          }),
        },
      );

      const result = (await verifyResponse.json()) as { success: boolean; 'error-codes'?: string[] };

      if (!result.success) {
        return c.json(
          {
            error: 'Turnstile verification failed',
            codes: result['error-codes'],
          },
          403,
        );
      }
    } catch {
      return c.json({ error: 'Turnstile verification service unavailable' }, 503);
    }
  }

  // ── 6. Create User ──
  try {
    // Auto-generate profile URL from name, suffixed with a random id to avoid
    // colliding with other users who share a name.
    const nameSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const url = `${nameSlug ? `${nameSlug}-` : 'user-'}${alphaid(8)}`;

    const user = await createUser({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      url,
    });

    // Send confirmation email
    await jobsClient.triggerJob({
      name: 'send.signup.confirmation.email',
      payload: {
        email: user.email,
      },
    });

    return c.json(
      {
        success: true,
        message: 'Account created successfully. Please verify your email.',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      201,
    );
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };

    if (error.code === 'PROFILE_URL_TAKEN') {
      return c.json({ error: 'Username already taken' }, 409);
    }

    if (error.message?.includes('Unique constraint') || error.message?.includes('unique')) {
      return c.json({ error: 'An account with this email already exists' }, 409);
    }

    console.error('[External Signup Error]', err);
    return c.json({ error: 'Failed to create account' }, 500);
  }
});

// Health check
externalSignupRoute.get('/health', (c) => {
  const isConfigured = !!env('NEXT_PRIVATE_EXTERNAL_SIGNUP_API_KEY');

  return c.json({
    status: 'ok',
    configured: isConfigured,
    turnstile: !!env('NEXT_PRIVATE_TURNSTILE_SECRET_KEY'),
    ipRestriction: !!env('NEXT_PRIVATE_EXTERNAL_SIGNUP_ALLOWED_IPS'),
  });
});
