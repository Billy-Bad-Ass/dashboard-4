/**
 * HTTP entry point for the heartbeat.
 *
 * The cron triggers do NOT come through here — they land on `scheduled()` in
 * `worker/index.ts`, which calls `runTick` directly rather than looping back
 * through HTTP. This route is the manual handle on the same tick, which is how
 * you verify a deployment without waiting ten minutes for the next one:
 *
 *   curl -H "Authorization: Bearer $DASHBOARD_TOKEN" \
 *        https://<worker>/api/cron?cadence=fast
 */

import { runTick, cadenceFor, type Cadence } from '@/lib/cron';
import { authorised, json, serverError, unauthorised } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CADENCES: Cadence[] = ['fast', 'hourly', 'daily'];

export async function GET(request: Request) {
  if (!authorised(request)) return unauthorised();

  const params = new URL(request.url).searchParams;
  const requested = params.get('cadence');
  const cron = params.get('cron');

  const cadence: Cadence = CADENCES.includes(requested as Cadence)
    ? (requested as Cadence)
    : cron
      ? cadenceFor(cron)
      : 'fast';

  try {
    return json(await runTick(cadence));
  } catch (error) {
    return serverError(error);
  }
}

export const POST = GET;
