/**
 * This is the main entry point for the server which will launch the RR7 application
 * and spin up auth, api, etc.
 *
 * Note:
 *  This file will be copied to the build folder during build time.
 *  Running this file will not work without a build.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import handle from 'hono-react-router-adapter/node';

import server from './hono/server/router.js';
import * as build from './index.js';

server.use(
  serveStatic({
    root: 'build/client',
    onFound: (path, c) => {
      if (path.startsWith('./build/client/assets')) {
        // Hard cache assets with hashed file names.
        c.header('Cache-Control', 'public, immutable, max-age=31536000');
      } else {
        // Cache with revalidation for rest of static files.
        c.header('Cache-Control', 'public, max-age=0, stale-while-revalidate=86400');
      }
    },
  }),
);

const handler = handle(build, server);

const port = Number(process.env.PORT) || 3000;

serve({ fetch: handler.fetch, port });

// eslint-disable-next-line no-console
console.log(`Server listening on http://localhost:${port}`);

// Self-scheduled WorkHub inbox polling: no external cron service required —
// works identically regardless of what platform/orchestrator runs this
// container. Calls the existing /api/cron/inbox-poll endpoint over loopback
// HTTP (rather than importing the poll function directly) since this file is
// copied into the build output as plain JS, not bundled — a direct import of
// TypeScript source here risks a module-resolution failure that a plain
// `fetch` to the already-correctly-built route handler avoids entirely.
const INBOX_POLL_INTERVAL_MS = 20_000;
const cronSecret = process.env.NEXT_PRIVATE_CRON_SECRET;

if (cronSecret) {
  const pollWorkHubInbox = async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/cron/inbox-poll`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cronSecret}` },
      });

      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error(`[inbox-poll] request failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[inbox-poll] request error:', err);
    }
  };

  void pollWorkHubInbox();
  setInterval(() => void pollWorkHubInbox(), INBOX_POLL_INTERVAL_MS);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[inbox-poll] NEXT_PRIVATE_CRON_SECRET is not set — automatic WorkHub inbox polling is disabled. Set it to enable.',
  );
}
