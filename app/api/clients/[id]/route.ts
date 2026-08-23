import { deleteClient, getClient, updateClient } from '@/lib/crm';
import { authorised, badRequest, json, readJson, serverError, toId, unauthorised } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (id === null) return badRequest('Bad id.');
  try {
    const client = await getClient(id);
    return client ? json(client) : json({ error: 'Not found.' }, 404);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorised(request)) return unauthorised();
  const id = toId((await params).id);
  if (id === null) return badRequest('Bad id.');

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  try {
    await updateClient(id, body);
    return json(await getClient(id));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorised(request)) return unauthorised();
  const id = toId((await params).id);
  if (id === null) return badRequest('Bad id.');
  try {
    await deleteClient(id);
    return json({ deleted: id });
  } catch (error) {
    return serverError(error);
  }
}
