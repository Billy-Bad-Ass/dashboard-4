/**
 * The Worker entry point.
 *
 * OpenNext generates a Worker that handles `fetch` and nothing else. Cloudflare
 * delivers cron triggers to `scheduled()`, so without this wrapper the three
 * triggers in wrangler.jsonc fire into a Worker that has no handler for them —
 * which is exactly what happened: the crons ran on time for hours and the
 * `heartbeats` table stayed empty. A cron with nowhere to land fails silently,
 * so `main` must point here, never at `.open-next/worker.js`.
 *
 * Two things this file has to get right:
 *
 *  1. **Re-export OpenNext's named exports.** They are Durable Object classes.
 *     `export *` forwards them and deliberately does not forward `default`,
 *     which is the export we are replacing. Dropping them would break the
 *     bindings that reference them by class name.
 *
 *  2. **Hand the bindings to the tick.** OpenNext publishes `env` through an
 *     AsyncLocalStorage store its `fetch` handler opens. Nothing opens it here,
 *     so `getCloudflareContext()` throws and D1 reads as absent — the tick would
 *     run, find no database, and record its own failure. `setWorkerEnv()` is the
 *     way in; see the note in lib/db.ts.
 *
 * This file is excluded from `npm run typecheck` (see tsconfig.json) because it
 * imports the OpenNext build output, which does not exist until `npm run
 * cf:build` has run. Typechecking it on a clean checkout would fail.
 */

// Both imports resolve only after `npm run cf:build`.
import handler from '../.open-next/worker.js';
export * from '../.open-next/worker.js';

import { runTick, cadenceFor } from '../lib/cron';
import { setWorkerEnv } from '../lib/db';

export default {
  fetch: handler.fetch,

  async scheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    setWorkerEnv(env);

    // waitUntil keeps the tick alive past the handler returning, so a slow
    // third-party API cannot cause a half-finished poll.
    ctx.waitUntil(
      runTick(cadenceFor(event.cron)).catch((error: unknown) => {
        // Nothing to report to, so log it — Workers observability captures it.
        console.error('heartbeat tick failed', error);
      }),
    );
  },
};
