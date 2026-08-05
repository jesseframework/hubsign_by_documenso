/**
 * Cross-process pub/sub for realtime Signature Inbox updates, consumed by the
 * SSE endpoint (`/api/inbox/events`). Events are scoped per organization so a
 * client only receives its own org's updates.
 *
 * WHY POSTGRES AND NOT AN EventEmitter
 *
 * This was an in-process `EventEmitter`, which silently did nothing in any
 * deployment running more than one Node process. Background jobs are dispatched
 * over HTTP (`LocalJobProvider.submitJobToEndpoint` POSTs to
 * `/api/jobs/...`), so the OCR job runs in whichever process serves that
 * request — publishing to *that* process's emitter while the browser's SSE
 * connection is held by another. The event went nowhere and the inbox appeared
 * frozen until a manual reload.
 *
 * Changing the transport (SSE → WebSockets) would not have helped: a socket has
 * the same process affinity. The fix has to be a bus every process can see.
 *
 * Postgres is chosen over Redis purely because it is already a hard dependency —
 * this adds no new service to run, monitor or secure. `NOTIFY` payloads are
 * capped at 8000 bytes, which is ample for these few-field events.
 */

import { env } from '../../utils/env';

export type InboxEvent = {
  /**
   * - `new`      an item was ingested
   * - `ocr`      OCR finished (succeeded or failed)
   * - `update`   a user action changed the item's status (send / archive / reprocess)
   * - `viewed`   an item was opened, so the org's unread count moved
   * - `workflow` a workflow run triggered by the item changed state
   */
  type: 'new' | 'ocr' | 'update' | 'viewed' | 'workflow';
  inboxItemId?: string;
  status?: string;
};

type Envelope = InboxEvent & { organizationId: number };

/**
 * One channel for every org rather than one per org. `LISTEN` takes an
 * identifier, so per-org channels would mean issuing LISTEN/UNLISTEN as clients
 * come and go; a single channel with the org id in the payload keeps one stable
 * connection and filters in memory.
 */
const CHANNEL = 'hubsign_inbox_events';

type Handler = (event: InboxEvent) => void;

/** Local fan-out: many SSE clients on one process share a single DB listener. */
const handlersByOrg = new Map<number, Set<Handler>>();

/**
 * Loaded lazily and via the default export: `pg` is CommonJS, so a top-level
 * `import { Client } from 'pg'` type-checks and bundles but throws at runtime
 * in the ESM server bundle ("does not provide an export named 'Client'").
 * Deferring it also keeps the driver out of the module graph until an SSE
 * client actually subscribes.
 */
type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
  on: (event: string, handler: (arg: never) => void) => void;
};

let listener: PgClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;

const MAX_RECONNECT_MS = 30_000;

const databaseUrl = () =>
  env('NEXT_PRIVATE_DIRECT_DATABASE_URL') || env('NEXT_PRIVATE_DATABASE_URL');

const dispatch = (envelope: Envelope) => {
  const { organizationId, ...event } = envelope;

  for (const handler of handlersByOrg.get(organizationId) ?? []) {
    try {
      handler(event);
    } catch (err) {
      // One bad subscriber must not stop delivery to the others.
      console.error('[inbox-events] subscriber threw:', err);
    }
  }
};

const scheduleReconnect = () => {
  if (reconnectTimer || handlersByOrg.size === 0) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (handlersByOrg.size > 0) {
      void ensureListener();
    }
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
};

/**
 * Opens (once) the dedicated LISTEN connection.
 *
 * This deliberately does NOT use the Prisma pool: a pooled connection is handed
 * back after each query, and `LISTEN` registers against the specific session
 * that issued it. The subscription has to own its connection for its lifetime.
 */
const ensureListener = async (): Promise<void> => {
  if (listener || connecting) {
    return connecting ?? Promise.resolve();
  }

  const connectionString = databaseUrl();

  if (!connectionString) {
    console.error('[inbox-events] no database URL — realtime inbox updates are disabled');
    return;
  }

  connecting = (async () => {
    const pg = await import('pg');
    // Interop: the CJS module lands on `.default` under ESM, but on the
    // namespace itself under CJS. Accept either.
    const PgClientCtor = (pg.default?.Client ?? pg.Client) as unknown as new (config: {
      connectionString: string;
    }) => PgClient;

    const client = new PgClientCtor({ connectionString });

    client.on('notification', (message: { channel: string; payload?: string }) => {
      if (message.channel !== CHANNEL || !message.payload) {
        return;
      }

      try {
        dispatch(JSON.parse(message.payload) as Envelope);
      } catch (err) {
        console.error('[inbox-events] malformed notification payload:', err);
      }
    });

    client.on('error', (err: unknown) => {
      console.error('[inbox-events] listener connection error:', err);

      // Drop the handle so the next ensureListener() rebuilds it. Subscribers
      // stay registered, so a reconnect silently resumes delivery.
      if (listener === client) {
        listener = null;
      }

      void client.end().catch(() => {});
      scheduleReconnect();
    });

    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);

    listener = client;
    reconnectDelay = 1_000;
  })()
    .catch((err) => {
      console.error('[inbox-events] failed to open listener:', err);
      listener = null;
      scheduleReconnect();
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
};

/**
 * Best-effort broadcast — never throws. Callers publish from the middle of
 * mutations and job handlers, where a misbehaving bus must not take the
 * business logic down with it.
 *
 * Fire-and-forget by design: awaiting a NOTIFY would put database latency on
 * the critical path of every inbox mutation for a purely cosmetic update.
 */
export const publishInboxEvent = (organizationId: number, event: InboxEvent): void => {
  const payload: Envelope = { organizationId, ...event };

  void (async () => {
    try {
      const { prisma } = await import('@documenso/prisma');

      // pg_notify() rather than `NOTIFY`, so the payload is a bound parameter
      // and never string-concatenated into SQL.
      await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(payload)})`;
    } catch (err) {
      console.error('[inbox-events] publish failed:', err);
    }
  })();
};

/** Subscribe to an org's inbox events. Returns an unsubscribe function. */
export const subscribeInboxEvents = (
  organizationId: number,
  handler: Handler,
): (() => void) => {
  const existing = handlersByOrg.get(organizationId) ?? new Set<Handler>();
  existing.add(handler);
  handlersByOrg.set(organizationId, existing);

  void ensureListener();

  return () => {
    const handlers = handlersByOrg.get(organizationId);
    if (!handlers) return;

    handlers.delete(handler);

    if (handlers.size === 0) {
      handlersByOrg.delete(organizationId);
    }

    // The listener connection is intentionally kept open even with no
    // subscribers: this is one idle connection, and tearing it down means
    // paying connect + LISTEN latency again the moment anyone reopens the page.
  };
};
