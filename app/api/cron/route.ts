/**
 * HTTP entry point for the heartbeat.
 *
 * Cloudflare cron triggers normally arrive at a Worker's `scheduled()` handler,
 * but OpenNext owns the Worker entry point, so the tick is exposed here and the
 * custom entry in `worker/index.ts` calls it. That also makes it triggerable by
 * hand, which is how you verify a deployment without waiting ten minutes:
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
