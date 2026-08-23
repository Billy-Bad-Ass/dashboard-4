/**
 * Spend ledger — the write side.
 *
 * Everything else on the dashboard reads from third parties. This is the one
 * dataset only a human can produce, and it is the denominator of every ROI
 * figure on the site, so it gets a real form rather than a migration file.
 */

import { execute, query } from '@/lib/db';
import { authorised, badRequest, json, oneOf, readJson, serverError, toDate, toId, unauthorised } from '@/lib/api';
import { parseMoney } from '@/lib/money';
import { isoDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['infra', 'tooling', 'ai', 'marketing', 'contractor', 'fees', 'other'] as const;
const RECURRENCES = ['once', 'monthly', 'yearly'] as const;

export async function GET() {
  try {
    return json(await query('SELECT * FROM spend ORDER BY incurred_on DESC LIMIT 500'));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  const vendor = typeof body.vendor === 'string' ? body.vendor.trim() : '';
  if (!vendor) return badRequest('vendor is required.');

  // Accept either pence directly (from a script) or a typed string (from the
  // form). Mixing the two silently is how 100x errors happen, so the two paths
  // are explicit and a bare number is always pence.
  const amount =
    typeof body.amount_pence === 'number'
      ? Math.round(body.amount_pence)
      : typeof body.amount === 'string'
        ? parseMoney(body.amount)
        : null;
  if (amount === null || amount === 0) {
    return badRequest('Provide amount_pence (integer pence) or amount ("12.50").');
  }

  try {
    const result = await execute(
      `INSERT INTO spend (project_slug, incurred_on, amount_pence, currency, category, vendor, note, recurrence, ended_on)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        typeof body.project_slug === 'string' && body.project_slug ? body.project_slug : null,
        toDate(body.incurred_on) ?? isoDate(),
        amount,
        typeof body.currency === 'string' ? body.currency.toLowerCase() : 'gbp',
        oneOf(body.category, CATEGORIES, 'other'),
        vendor,
        typeof body.note === 'string' ? body.note : null,
        oneOf(body.recurrence, RECURRENCES, 'once'),
        toDate(body.ended_on),
      ],
    );
    return json({ id: Number(result.meta.last_row_id) }, 201);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  if (!authorised(request)) return unauthorised();
  const id = toId(new URL(request.url).searchParams.get('id') ?? undefined);
  if (id === null) return badRequest('id query parameter required.');
  try {
    await execute('DELETE FROM spend WHERE id = ?', [id]);
    return json({ deleted: id });
  } catch (error) {
    return serverError(error);
  }
}
