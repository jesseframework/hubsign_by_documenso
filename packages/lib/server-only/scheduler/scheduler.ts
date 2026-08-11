/**
 * In-process scheduler for the app's recurring work.
 *
 * WHY THIS EXISTS
 *
 * Every recurring feature was built as an HTTP endpoint under `/api/cron/*`
 * expecting an external scheduler to call it. Nothing ever did — the production
 * compose file runs only `database` and `documenso` — so inbox polling,
 * scheduled workflows, signing reminders, approval chase-ups and renewal notices
 * were all silently inert in a deployment that otherwise looked healthy. A
 * design that needs ops glue nobody adds is a design that doesn't run.
 *
 * The endpoints are kept: they remain useful for manual triggering, for
 * platforms that do supply a scheduler, and for tests.
 *
 * SAFETY UNDER HORIZONTAL SCALING
 *
 * Each tick takes a Postgres *session* advisory lock before doing anything, so N
 * app instances still execute a job exactly once per interval — whoever grabs
 * the lock wins and the rest skip immediately. The lock is held on a dedicated
 * connection this module owns, because Prisma's pool hands a different
 * connection to each query and a session lock taken on one connection cannot be
 * released from another.
 *
 * Crash safety comes free: if the process dies mid-job, its connection drops and
 * Postgres releases the lock automatically. There is no stuck-lease state to
 * clean up.
 */

import { env } from '../../utils/env';

/** Distinct per job. Postgres advisory locks share one global 64-bit keyspace. */
export const SCHEDULER_LOCK_KEYS = {
  inboxPoll: 8_801_001,
  workflows: 8_801_002,
  signReminders: 8_801_003,
  approvalReminders: 8_801_004,
  subscriptionRenewals: 8_801_005,
  slaBreachSweep: 8_801_006,
} as const;

export type ScheduledJob = {
  id: string;
  lockKey: number;
  intervalMs: number;
  /** Skip this job entirely (e.g. billing jobs when billing is disabled). */
  enabled?: () => boolean;
  run: () => Promise<unknown>;
};

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
  on: (event: string, handler: (arg: never) => void) => void;
};

let lockClient: PgClient | null = null;
let connecting: Promise<void> | null = null;
const timers: Array<ReturnType<typeof setInterval>> = [];
let started = false;

const databaseUrl = () =>
  env('NEXT_PRIVATE_DIRECT_DATABASE_URL') || env('NEXT_PRIVATE_DATABASE_URL');

/**
 * Dedicated connection for advisory locks. See the header: session locks are
 * bound to the connection that took them, which a pooled client cannot promise.
 */
const ensureLockClient = async (): Promise<PgClient | null> => {
  if (lockClient) return lockClient;

  if (connecting) {
    await connecting;
    return lockClient;
  }

  const connectionString = databaseUrl();
  if (!connectionString) {
    console.error('[scheduler] no database URL — scheduled jobs are disabled');
    return null;
  }

  connecting = (async () => {
    // `pg` is CommonJS: a named top-level import bundles fine but throws at
    // runtime in the ESM server build. Load it lazily and accept either shape.
    const pg = await import('pg');
    const PgClientCtor = (pg.default?.Client ?? pg.Client) as unknown as new (config: {
      connectionString: string;
    }) => PgClient;

    const client = new PgClientCtor({ connectionString });

    client.on('error', (err: unknown) => {
      console.error('[scheduler] lock connection error:', err);
      if (lockClient === client) lockClient = null;
      void client.end().catch(() => {});
    });

    await client.connect();
    lockClient = client;
  })()
    .catch((err) => {
      console.error('[scheduler] failed to open lock connection:', err);
      lockClient = null;
    })
    .finally(() => {
      connecting = null;
    });

  await connecting;

  return lockClient;
};

/**
 * Runs `job` iff this instance wins the advisory lock. Never throws — a
 * scheduler that can crash the process on a bad tick is worse than one that
 * misses a run.
 */
const runGuarded = async (job: ScheduledJob): Promise<void> => {
  if (job.enabled && !job.enabled()) {
    return;
  }

  const client = await ensureLockClient();
  if (!client) return;

  let acquired = false;

  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [job.lockKey]);
    acquired = result.rows[0]?.locked === true;

    // Another instance is already running it, or a previous tick still is.
    if (!acquired) return;

    const startedAt = Date.now();
    await job.run();
    console.log(`[scheduler] ${job.id} completed in ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.error(`[scheduler] ${job.id} failed:`, err);
  } finally {
    if (acquired) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [job.lockKey])
        .catch((err) => console.error(`[scheduler] ${job.id} unlock failed:`, err));
    }
  }
};

/**
 * Starts every job on its interval. Idempotent — calling twice is a no-op, so a
 * hot-reloading dev server cannot stack duplicate timers.
 *
 * Set `NEXT_PRIVATE_DISABLE_SCHEDULER=true` to opt out (e.g. when running an
 * external scheduler against the `/api/cron/*` endpoints instead).
 */
export const startScheduler = (jobs: ScheduledJob[]): void => {
  if (started) return;

  if (env('NEXT_PRIVATE_DISABLE_SCHEDULER') === 'true') {
    console.log('[scheduler] disabled via NEXT_PRIVATE_DISABLE_SCHEDULER');
    return;
  }

  started = true;

  for (const job of jobs) {
    // Stagger the first tick so a cold start doesn't fire everything at once
    // and then contend on five locks simultaneously.
    const initialDelay = 15_000 + Math.floor(job.lockKey % 20) * 1_000;

    setTimeout(() => {
      void runGuarded(job);
      timers.push(setInterval(() => void runGuarded(job), job.intervalMs));
    }, initialDelay);
  }

  console.log(`[scheduler] started with ${jobs.length} job(s)`);
};

/** Stops all timers and releases the lock connection. Used by tests. */
export const stopScheduler = async (): Promise<void> => {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  started = false;

  if (lockClient) {
    await lockClient.end().catch(() => {});
    lockClient = null;
  }
};
