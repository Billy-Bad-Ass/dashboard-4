/**
 * Custom Worker entry point.
 *
 * OpenNext generates a Worker that handles `fetch`. It does not generate a
 * `scheduled` handler, so this wraps it: HTTP requests pass straight through to
 * the Next.js app, and cron triggers run the heartbeat directly rather than
 * looping back through the HTTP layer.
 *
 * Wire it up by pointing wrangler.jsonc's `main` at the build output of this
 * file once you need the native cron path. Until then the cron trigger can hit
 * /api/cron over HTTP, which is simpler and costs one extra request every ten
 * minutes — a rounding error against the plan's included requests.
 *
 * This file is excluded from `npm run typecheck` (see tsconfig.json) because it
 * imports the OpenNext build output, which does not exist until `npm run
 * cf:build` has run. Typechecking it in CI would fail on a clean checkout.
 */

// The import below resolves only after `npm run cf:build`.
import handler from '../.open-next/worker.js';
import { runTick, cadenceFor } from '../lib/cron';

export default {
  fetch: handler.fetch,

  async scheduled(event: ScheduledController, _env: CloudflareEnv, ctx: ExecutionContext) {
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
