/**
 * The whole dashboard state as JSON.
 *
 * Exists so an agent, a script or a phone widget can read the same numbers the
 * UI shows without scraping HTML. `?fresh=1` bypasses the KV cache — use it
 * sparingly, it costs four third-party API calls.
 */

import { pulse } from '@/lib/heartbeat';
import { json, serverError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    return json(await pulse({ fresh }));
  } catch (error) {
    return serverError(error);
  }
}
