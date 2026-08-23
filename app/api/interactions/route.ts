import { logInteraction } from '@/lib/crm';
import { authorised, badRequest, json, readJson, serverError, toDate, unauthorised } from '@/lib/api';
import { isoDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  const clientId = typeof body.client_id === 'number' ? body.client_id : null;
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (clientId === null || !summary) return badRequest('client_id and summary are required.');

  try {
    await logInteraction(
      clientId,
      typeof body.kind === 'string' ? body.kind : 'note',
      summary,
      toDate(body.occurred_on) ?? isoDate(),
    );
    return json({ ok: true }, 201);
  } catch (error) {
    return serverError(error);
  }
}
