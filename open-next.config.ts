/**
 * OpenNext Cloudflare adapter configuration.
 *
 * Required by `opennextjs-cloudflare build` — without this file the build stops
 * before doing anything, which is exactly how the first deploy of this project
 * failed.
 *
 * The configuration itself is deliberately minimal. Every page on this
 * dashboard is `export const dynamic = 'force-dynamic'`, because the whole
 * point is live numbers: a cached ROI figure is a wrong ROI figure. So there is
 * no incremental cache override to set — there is nothing worth caching at the
 * framework level, and the caching that does matter (the KV layer in front of
 * Stripe, GitHub, Cloudflare and the calendar) is in lib/heartbeat.ts where it
 * can have a sensible TTL and a stale-on-failure fallback.
 */

import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({
  // Route preloading trades cold-start CPU for warm-request latency. The cron
  // trigger keeps this Worker warm anyway, and CPU time is the metered
  // resource on the plan, so leaving it off is the cheaper side of the trade.
  routePreloadingBehavior: 'none',
});
