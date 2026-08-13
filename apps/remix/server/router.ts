import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';

import { tsRestHonoApp } from '@documenso/api/hono';
import { auth } from '@documenso/auth/server';
import { API_V2_BETA_URL } from '@documenso/lib/constants/app';
import { jobsClient } from '@documenso/lib/jobs/client';
import { SCHEDULED_JOBS } from '@documenso/lib/server-only/scheduler/jobs';
import { startScheduler } from '@documenso/lib/server-only/scheduler/scheduler';
import { openApiDocument } from '@documenso/trpc/server/open-api';

import { cspReportRoute } from './api/csp-report';
import { externalSignupRoute } from './api/external-signup';
import { filesRoute } from './api/files';
import { type AppContext, appContext } from './context';
import { CSP_REPORT_PATH } from './csp';
import { appMiddleware } from './middleware';
import { enforceHttps, securityHeaders } from './security-headers';
import { openApiTrpcServerHandler } from './trpc/hono-trpc-open-api';
import { reactRouterTrpcServer } from './trpc/hono-trpc-remix';

export interface HonoEnv {
  Variables: {
    context: AppContext;
  };
}

const app = new Hono<HonoEnv>();

/**
 * Security first, before anything does real work:
 *  - bounce plaintext requests to HTTPS
 *  - stamp the response security headers (CSP, XFO, HSTS, …)
 *
 * Registered here rather than in `main.js` so they also wrap the static asset
 * handler, which `main.js` appends after this router.
 */
app.use('*', enforceHttps);
app.use('*', securityHeaders);

/**
 * Attach session and context to requests.
 */
app.use(contextStorage());
app.use(appContext);

/**
 * RR7 app middleware.
 */
app.use('*', appMiddleware);

// Auth server.
app.route('/api/auth', auth);

// Files route.
app.route('/api/files', filesRoute);

// External signup API (secured).
app.route('/api/external', externalSignupRoute);

// CSP violation collector (unauthenticated — browsers post here with no credentials).
app.route(CSP_REPORT_PATH, cspReportRoute);

// API servers.
app.route('/api/v1', tsRestHonoApp);
app.use('/api/jobs/*', jobsClient.getApiHandler());
app.use('/api/trpc/*', reactRouterTrpcServer);

// Unstable API server routes. Order matters for these two.
app.get(`${API_V2_BETA_URL}/openapi.json`, (c) => c.json(openApiDocument));
app.use(`${API_V2_BETA_URL}/*`, async (c) => openApiTrpcServerHandler(c));

/**
 * Recurring work (inbox polling, scheduled workflows, reminders).
 *
 * Runs here rather than relying on an external scheduler hitting `/api/cron/*`:
 * nothing ever called those endpoints, so every one of these features was
 * silently doing nothing in production. A Postgres advisory lock keeps each job
 * to one execution per interval no matter how many instances are running.
 *
 * Opt out with NEXT_PRIVATE_DISABLE_SCHEDULER=true if you'd rather drive the
 * endpoints from your own scheduler.
 */
startScheduler(SCHEDULED_JOBS);

export default app;
