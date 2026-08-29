/**
 * The outreach draft queue, and the push that empties it.
 *
 * The path a draft takes:
 *
 *   agent writes it  →  queued here  →  pushed to Apps Script  →  Gmail drafts
 *                                                                      ↓
 *                                                            a human presses send
 *
 * Nothing in this file can send an email, and that is the point rather than a
 * limitation. The Apps Script it posts to has no send call either. Every step
 * is reversible until a person decides otherwise.
 *
 * Why the push is outbound from here rather than a poll from Google: this
 * dashboard sits behind Cloudflare Access at Worker scope, so a script asking
 * it for work would need an Access service token plus the dashboard bearer —
 * two credentials living in a Google account. Pushing, the Worker holds the one
 * URL and Google holds nothing.
 */

import { execute, query, queryOne } from './db';
import { isoStamp } from './dates';

/** How many drafts one push carries. The Apps Script refuses more than 50. */
const BATCH = 25;

export type DraftState = 'queued' | 'delivered' | 'failed';

export interface Draft {
  id: number;
  client_id: number;
  project_slug: string | null;
  to_address: string;
  subject: string;
  body: string;
  idempotency_key: string;
  state: DraftState;
  gmail_draft_id: string | null;
  error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface DraftInput {
  clientId: number;
  projectSlug?: string | null;
  toAddress: string;
  subject: string;
  body: string;
}

/**
 * Queue one draft.
 *
 * The idempotency key pairs the client with the moment of writing. Two drafts
 * to the same practice a week apart are legitimately different messages and get
 * different keys; the same draft pushed twice because a response was lost gets
 * the same one, and Apps Script answers "duplicate" instead of creating a
 * second copy in the mailbox.
 */
export async function queueDraft(input: DraftInput): Promise<number> {
  const key = `client-${input.clientId}-${isoStamp()}`;
  const result = await execute(
    `INSERT INTO drafts (client_id, project_slug, to_address, subject, body, idempotency_key)
     VALUES (?,?,?,?,?,?)`,
    [
      input.clientId,
      input.projectSlug ?? null,
      input.toAddress,
      input.subject,
      input.body,
      key,
    ],
  );
  return Number(result.meta.last_row_id);
}

export async function listDrafts(state?: DraftState, limit = 100): Promise<Draft[]> {
  return state
    ? query<Draft>('SELECT * FROM drafts WHERE state = ? ORDER BY id DESC LIMIT ?', [state, limit])
    : query<Draft>('SELECT * FROM drafts ORDER BY id DESC LIMIT ?', [limit]);
}

export interface DraftCounts {
  queued: number;
  delivered: number;
  failed: number;
}

export async function draftCounts(): Promise<DraftCounts> {
  const rows = await query<{ state: DraftState; n: number }>(
    'SELECT state, COUNT(*) AS n FROM drafts GROUP BY state',
  );
  const counts: DraftCounts = { queued: 0, delivered: 0, failed: 0 };
  for (const row of rows) {
    if (row.state in counts) counts[row.state] = Number(row.n);
  }
  return counts;
}

export interface PushResult {
  attempted: number;
  delivered: number;
  failed: number;
  /** Why nothing was attempted, when nothing was. Never thrown: the cron must survive it. */
  problem: string | null;
}

interface DrafterReply {
  ok?: boolean;
  error?: string;
  results?: { key?: string; status?: string; draftId?: string | null; error?: string }[];
}

/**
 * Push every queued draft to the Apps Script, and record what happened.
 *
 * A draft that fails is marked `failed` with the reason rather than left
 * queued: a row that silently retries forever is how a broken deployment looks
 * exactly like an empty queue.
 */
/**
 * Record why a push failed on the drafts it failed for, without failing them.
 *
 * They stay queued — a drafter that was down at :10 is usually up at :20, and
 * marking them failed would mean a human requeuing each one by hand. But a
 * queued draft with no reason on it is indistinguishable from one waiting its
 * turn, and that is exactly how three drafts sat still for half an hour while
 * the tick reported a problem nobody stored.
 */
async function noteProblem(drafts: Draft[], problem: string): Promise<void> {
  for (const draft of drafts) {
    await execute(`UPDATE drafts SET error = ? WHERE id = ? AND state = 'queued'`, [
      problem,
      draft.id,
    ]);
  }
}

export async function pushQueuedDrafts(fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  const idle: PushResult = { attempted: 0, delivered: 0, failed: 0, problem: null };

  // queryOne, not queryValue: D1's `first()` with no column name hands back the
  // whole row, so a scalar helper would return `{ value: "https://…" }` here.
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    'gmail_drafter_url',
  ]);
  const url = row?.value;
  if (!url) {
    return {
      ...idle,
      problem:
        'no gmail_drafter_url in settings — deploy the Apps Script (docs/GMAIL-DRAFTER.md) and store its /exec URL',
    };
  }

  const queued = await query<Draft>(
    'SELECT * FROM drafts WHERE state = ? ORDER BY id ASC LIMIT ?',
    ['queued', BATCH],
  );
  if (queued.length === 0) return idle;

  let reply: DrafterReply;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        drafts: queued.map((d) => ({
          key: d.idempotency_key,
          to: d.to_address,
          subject: d.subject,
          body: d.body,
        })),
      }),
    });
    if (!response.ok) {
      const problem = `drafter answered HTTP ${response.status}`;
      await noteProblem(queued, problem);
      return { ...idle, attempted: queued.length, problem };
    }
    reply = (await response.json()) as DrafterReply;
  } catch (caught) {
    // The drafts stay queued: a network failure is not the draft's fault and
    // the next tick should try again.
    const problem = caught instanceof Error ? caught.message : String(caught);
    await noteProblem(queued, problem);
    return { ...idle, attempted: queued.length, problem };
  }

  if (!reply.ok) {
    const problem = reply.error ?? 'drafter refused';
    await noteProblem(queued, problem);
    return { ...idle, attempted: queued.length, problem };
  }

  const byKey = new Map((reply.results ?? []).map((r) => [r.key, r]));
  let delivered = 0;
  let failed = 0;

  for (const draft of queued) {
    const result = byKey.get(draft.idempotency_key);

    // A draft the reply never mentions is left queued rather than guessed at.
    // Marking it delivered would hide a draft that never arrived; marking it
    // failed would re-send one that did.
    if (!result) {
      await execute(`UPDATE drafts SET error = ? WHERE id = ?`, [
        'the drafter\'s reply never mentioned this draft — neither confirmed nor refused',
        draft.id,
      ]);
      continue;
    }

    // "duplicate" means Apps Script already made this one — the last push
    // succeeded and only the answer was lost. That is a delivery, not a fault.
    if (result.status === 'created' || result.status === 'duplicate') {
      await execute(
        `UPDATE drafts SET state = 'delivered', gmail_draft_id = ?, error = NULL, delivered_at = ?
          WHERE id = ?`,
        [result.draftId ?? null, isoStamp(), draft.id],
      );
      delivered += 1;
    } else {
      await execute(`UPDATE drafts SET state = 'failed', error = ? WHERE id = ?`, [
        result.error ?? `drafter said "${result.status ?? 'nothing'}"`,
        draft.id,
      ]);
      failed += 1;
    }
  }

  return { attempted: queued.length, delivered, failed, problem: null };
}

/** One client's drafts, newest first. Shown on the client's own page. */
export async function draftsForClient(clientId: number): Promise<Draft[]> {
  return query<Draft>('SELECT * FROM drafts WHERE client_id = ? ORDER BY id DESC', [clientId]);
}

/** Put a failed draft back in the queue, after whatever broke has been fixed. */
export async function requeueDraft(id: number): Promise<void> {
  await execute(`UPDATE drafts SET state = 'queued', error = NULL WHERE id = ? AND state = 'failed'`, [
    id,
  ]);
}

export async function getDraft(id: number): Promise<Draft | null> {
  return queryOne<Draft>('SELECT * FROM drafts WHERE id = ?', [id]);
}
