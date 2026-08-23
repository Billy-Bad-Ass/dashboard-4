import { createDeal, deleteDeal, updateDeal, DEAL_STAGES } from '@/lib/crm';
import { authorised, badRequest, json, oneOf, readJson, serverError, toId, unauthorised } from '@/lib/api';
import { parseMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  const clientId = typeof body.client_id === 'number' ? body.client_id : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (clientId === null || !title) return badRequest('client_id and title are required.');

  const value =
    typeof body.value_pence === 'number'
      ? Math.round(body.value_pence)
      : typeof body.value === 'string'
        ? parseMoney(body.value)
        : 0;

  try {
    const id = await createDeal({
      client_id: clientId,
      title,
      value_pence: value ?? 0,
      project_slug: typeof body.project_slug === 'string' ? body.project_slug : null,
      stage: oneOf(body.stage, DEAL_STAGES, 'lead'),
      probability: typeof body.probability === 'number' ? body.probability : 10,
      expected_on: typeof body.expected_on === 'string' ? body.expected_on : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return json({ id }, 201);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  if (!authorised(request)) return unauthorised();
  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');
  const id = typeof body.id === 'number' ? body.id : null;
  if (id === null) return badRequest('id is required.');
  try {
    await updateDeal(id, body);
    return json({ updated: id });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  if (!authorised(request)) return unauthorised();
  const id = toId(new URL(request.url).searchParams.get('id') ?? undefined);
  if (id === null) return badRequest('id query parameter required.');
  try {
    await deleteDeal(id);
    return json({ deleted: id });
  } catch (error) {
    return serverError(error);
  }
}
