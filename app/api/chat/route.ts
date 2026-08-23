/**
 * Streaming endpoint for "ask the dashboard".
 *
 * Server-Sent Events rather than a JSON response: answers involve several tool
 * round-trips and can take twenty seconds, and a spinner for twenty seconds
 * feels broken. Streaming also keeps the request well inside the Worker's
 * response deadline, which a buffered reply would not be guaranteed to do.
 *
 * One event per line as `data: {json}`, matching the AskEvent union in lib/ask.ts.
 */

import { askStream, type AskMessage } from '@/lib/ask';
import { authorised, badRequest, readJson, unauthorised } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Turns kept per request. Long enough to follow up, short enough to bound cost. */
const MAX_HISTORY = 20;

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson<{ messages?: unknown }>(request);
  if (!body || !Array.isArray(body.messages)) {
    return badRequest('Body must be JSON with a `messages` array.');
  }

  const history: AskMessage[] = body.messages
    .filter(
      (m): m is AskMessage =>
        typeof m === 'object' &&
        m !== null &&
        (('role' in m && (m as AskMessage).role === 'user') ||
          (m as AskMessage).role === 'assistant') &&
        typeof (m as AskMessage).content === 'string' &&
        (m as AskMessage).content.trim() !== '',
    )
    .slice(-MAX_HISTORY);

  if (history.length === 0) return badRequest('No usable messages.');
  // The API rejects a conversation that does not open with a user turn, which
  // the slice above can produce if it lands mid-exchange.
  while (history.length > 0 && history[0]!.role !== 'user') history.shift();
  if (history.length === 0) return badRequest('History must contain a user message.');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of askStream(history)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        // The generator handles its own errors; this is the last resort so the
        // browser gets a terminated stream with a reason rather than a hang.
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this some proxies buffer the whole response and defeat the point.
      'X-Accel-Buffering': 'no',
    },
  });
}
