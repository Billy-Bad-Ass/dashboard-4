import { createClient, listClients, CLIENT_STATUSES, type ClientStatus } from '@/lib/crm';
import { authorised, badRequest, json, oneOf, readJson, serverError, unauthorised } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get('status');
  try {
    const valid = CLIENT_STATUSES.includes(status as ClientStatus)
      ? (status as ClientStatus)
      : undefined;
    return json(await listClients(valid));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('name is required.');

  try {
    const id = await createClient({
      name,
      company: str(body.company),
      email: str(body.email),
      phone: str(body.phone),
      website: str(body.website),
      status: oneOf(body.status, CLIENT_STATUSES, 'prospect'),
      project_slug: str(body.project_slug),
      source: str(body.source),
      heat: typeof body.heat === 'number' ? body.heat : 1,
      notes: str(body.notes),
      next_action: str(body.next_action),
      next_action_on: str(body.next_action_on),
    });
    return json({ id }, 201);
  } catch (error) {
    return serverError(error);
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
