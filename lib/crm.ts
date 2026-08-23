/**
 * The client database — current and prospective.
 *
 * The design decision worth knowing: prospects and clients share one table and
 * differ only by `status`. When a prospect signs, its row changes status and
 * keeps every interaction that led there. Two tables would mean either copying
 * the history or losing it, and the history is the part that tells you which
 * outreach actually works.
 */

import { execute, query, queryOne, queryValue } from './db';
import { isoDate, addDays } from './dates';
import type { Pence } from './money';

export const CLIENT_STATUSES = [
  'prospect',
  'contacted',
  'engaged',
  'current',
  'dormant',
  'lost',
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Stages that still count toward the weighted pipeline. */
const OPEN_STAGES: DealStage[] = ['lead', 'qualified', 'proposal'];

export const STATUS_META: Record<ClientStatus, { label: string; tone: string; hint: string }> = {
  prospect: { label: 'Prospect', tone: 'neutral', hint: 'Identified. Not approached yet.' },
  contacted: { label: 'Contacted', tone: 'info', hint: 'Outreach sent, no reply yet.' },
  engaged: { label: 'Engaged', tone: 'warn', hint: 'In conversation. This is where deals live or die.' },
  current: { label: 'Current', tone: 'good', hint: 'Has paid or signed.' },
  dormant: { label: 'Dormant', tone: 'neutral', hint: 'Was current. Nothing recent.' },
  lost: { label: 'Lost', tone: 'bad', hint: 'Said no, or went silent past the point of pretending.' },
};

export interface Client {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: ClientStatus;
  project_slug: string | null;
  source: string | null;
  heat: number;
  notes: string | null;
  last_contact_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: number;
  client_id: number;
  project_slug: string | null;
  title: string;
  value_pence: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expected_on: string | null;
  closed_on: string | null;
  notes: string | null;
}

export interface Interaction {
  id: number;
  client_id: number;
  occurred_on: string;
  kind: string;
  summary: string;
}

export interface ClientWithDeals extends Client {
  deals: Deal[];
  /** Sum of open deal values, unweighted. */
  openValuePence: Pence;
}

export async function listClients(status?: ClientStatus): Promise<ClientWithDeals[]> {
  const clients = status
    ? await query<Client>(
        'SELECT * FROM clients WHERE status = ? ORDER BY heat DESC, updated_at DESC',
        [status],
      )
    : await query<Client>('SELECT * FROM clients ORDER BY heat DESC, updated_at DESC');

  if (clients.length === 0) return [];

  const deals = await query<Deal>('SELECT * FROM deals ORDER BY value_pence DESC');
  const byClient = new Map<number, Deal[]>();
  for (const deal of deals) {
    const list = byClient.get(deal.client_id) ?? [];
    list.push(deal);
    byClient.set(deal.client_id, list);
  }

  return clients.map((client) => {
    const own = byClient.get(client.id) ?? [];
    return {
      ...client,
      deals: own,
      openValuePence: own
        .filter((d) => OPEN_STAGES.includes(d.stage))
        .reduce((a, d) => a + d.value_pence, 0),
    };
  });
}

export async function getClient(id: number): Promise<ClientWithDeals | null> {
  const client = await queryOne<Client>('SELECT * FROM clients WHERE id = ?', [id]);
  if (!client) return null;
  const deals = await query<Deal>(
    'SELECT * FROM deals WHERE client_id = ? ORDER BY value_pence DESC',
    [id],
  );
  return {
    ...client,
    deals,
    openValuePence: deals
      .filter((d) => OPEN_STAGES.includes(d.stage))
      .reduce((a, d) => a + d.value_pence, 0),
  };
}

export async function clientInteractions(id: number): Promise<Interaction[]> {
  return query<Interaction>(
    'SELECT * FROM interactions WHERE client_id = ? ORDER BY occurred_on DESC, id DESC LIMIT 100',
    [id],
  );
}

export interface PipelineSummary {
  /** Every open deal, added up at face value. */
  openPence: Pence;
  /** The same deals multiplied by their probability. The honest number. */
  weightedPence: Pence;
  wonPence: Pence;
  lostPence: Pence;
  counts: Record<ClientStatus, number>;
  dealCounts: Record<DealStage, number>;
  totalClients: number;
  /** Clients with no contact inside the cold threshold, worst first. */
  goingCold: Client[];
  /** Actions with a date on or before today. */
  dueActions: Client[];
}

export async function loadPipeline(): Promise<PipelineSummary> {
  const coldDays = Number(
    (await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      'cold_after_days',
    ]))?.value ?? 21,
  );
  const coldBefore = isoDate(addDays(new Date(), -coldDays));
  const today = isoDate();

  const [clients, deals, goingCold, dueActions] = await Promise.all([
    query<Client>('SELECT status FROM clients'),
    query<Deal>('SELECT * FROM deals'),
    query<Client>(
      `SELECT * FROM clients
        WHERE status IN ('contacted','engaged','current')
          AND (last_contact_on IS NULL OR last_contact_on < ?)
        ORDER BY COALESCE(last_contact_on, created_at) ASC LIMIT 20`,
      [coldBefore],
    ),
    query<Client>(
      `SELECT * FROM clients
        WHERE next_action_on IS NOT NULL AND next_action_on <= ?
          AND status NOT IN ('lost')
        ORDER BY next_action_on ASC LIMIT 20`,
      [today],
    ),
  ]);

  const counts = Object.fromEntries(CLIENT_STATUSES.map((s) => [s, 0])) as Record<
    ClientStatus,
    number
  >;
  for (const c of clients) {
    if (c.status in counts) counts[c.status] += 1;
  }

  const dealCounts = Object.fromEntries(DEAL_STAGES.map((s) => [s, 0])) as Record<
    DealStage,
    number
  >;
  let open = 0;
  let weighted = 0;
  let won = 0;
  let lost = 0;
  for (const deal of deals) {
    if (deal.stage in dealCounts) dealCounts[deal.stage] += 1;
    if (OPEN_STAGES.includes(deal.stage)) {
      open += deal.value_pence;
      weighted += Math.round((deal.value_pence * clamp(deal.probability, 0, 100)) / 100);
    } else if (deal.stage === 'won') {
      won += deal.value_pence;
    } else {
      lost += deal.value_pence;
    }
  }

  return {
    openPence: open,
    weightedPence: weighted,
    wonPence: won,
    lostPence: lost,
    counts,
    dealCounts,
    totalClients: clients.length,
    goingCold,
    dueActions,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface ClientInput {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: ClientStatus;
  project_slug?: string | null;
  source?: string | null;
  heat?: number;
  notes?: string | null;
  next_action?: string | null;
  next_action_on?: string | null;
}

export async function createClient(input: ClientInput): Promise<number> {
  const result = await execute(
    `INSERT INTO clients
       (name, company, email, phone, website, status, project_slug, source, heat, notes,
        next_action, next_action_on)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.name,
      input.company ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.website ?? null,
      input.status ?? 'prospect',
      input.project_slug ?? null,
      input.source ?? null,
      clamp(input.heat ?? 1, 1, 5),
      input.notes ?? null,
      input.next_action ?? null,
      input.next_action_on ?? null,
    ],
  );
  return Number(result.meta.last_row_id);
}

/**
 * Partial update. Only the columns present in `patch` are touched, and the
 * allow-list is explicit rather than derived from the object keys — this is fed
 * straight from an HTTP body, and building SQL from caller-supplied key names
 * is how you get a column called `1=1`.
 */
const CLIENT_COLUMNS = [
  'name',
  'company',
  'email',
  'phone',
  'website',
  'status',
  'project_slug',
  'source',
  'heat',
  'notes',
  'last_contact_on',
  'next_action',
  'next_action_on',
] as const;

export async function updateClient(id: number, patch: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const column of CLIENT_COLUMNS) {
    if (column in patch) {
      sets.push(`${column} = ?`);
      params.push(patch[column] ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
  params.push(id);
  await execute(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteClient(id: number): Promise<void> {
  await execute('DELETE FROM clients WHERE id = ?', [id]);
}

/**
 * Log an interaction and advance the client's last-contact date in one batch.
 * Logging a call and leaving the client looking cold is the single easiest way
 * for a CRM to become untrustworthy, so these two writes are never separated.
 */
export async function logInteraction(
  clientId: number,
  kind: string,
  summary: string,
  occurredOn = isoDate(),
): Promise<void> {
  await execute(
    'INSERT INTO interactions (client_id, occurred_on, kind, summary) VALUES (?,?,?,?)',
    [clientId, occurredOn, kind, summary],
  );
  await execute(
    `UPDATE clients
        SET last_contact_on = MAX(COALESCE(last_contact_on, ''), ?),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?`,
    [occurredOn, clientId],
  );
}

export async function createDeal(input: {
  client_id: number;
  title: string;
  value_pence: number;
  project_slug?: string | null;
  stage?: DealStage;
  probability?: number;
  expected_on?: string | null;
  notes?: string | null;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO deals (client_id, project_slug, title, value_pence, stage, probability, expected_on, notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.client_id,
      input.project_slug ?? null,
      input.title,
      input.value_pence,
      input.stage ?? 'lead',
      clamp(input.probability ?? 10, 0, 100),
      input.expected_on ?? null,
      input.notes ?? null,
    ],
  );
  return Number(result.meta.last_row_id);
}

const DEAL_COLUMNS = [
  'title',
  'value_pence',
  'stage',
  'probability',
  'expected_on',
  'closed_on',
  'notes',
  'project_slug',
] as const;

export async function updateDeal(id: number, patch: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const column of DEAL_COLUMNS) {
    if (column in patch) {
      sets.push(`${column} = ?`);
      params.push(patch[column] ?? null);
    }
  }
  if (sets.length === 0) return;
  // A deal moved to won or lost gets today's date automatically unless one was
  // supplied — an open-ended "won" with no close date breaks every cycle-time
  // number later.
  if (patch.stage === 'won' || patch.stage === 'lost') {
    if (!('closed_on' in patch)) {
      sets.push('closed_on = ?');
      params.push(isoDate());
    }
  }
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
  params.push(id);
  await execute(`UPDATE deals SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteDeal(id: number): Promise<void> {
  await execute('DELETE FROM deals WHERE id = ?', [id]);
}

export async function clientCount(): Promise<number> {
  return (await queryValue<number>('SELECT COUNT(*) FROM clients')) ?? 0;
}
