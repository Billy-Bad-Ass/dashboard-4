/**
 * D1 access.
 *
 * Two things this module exists to solve:
 *
 *  1. Getting at the binding. In a Worker the D1 handle arrives on the request
 *     context, not on `process.env`, so every caller would otherwise repeat the
 *     OpenNext incantation. `getDb()` does it once.
 *
 *  2. Surviving without it. `npm run dev` with no wrangler session, a CI
 *     typecheck, a preview build before the database has been created — none of
 *     those have a D1 binding, and none of them should crash the page. When the
 *     binding is missing every read returns empty and every write throws a
 *     clearly-worded error, so a missing database looks like a missing database
 *     rather than a stack trace.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

export type Row = Record<string, unknown>;

export class NoDatabaseError extends Error {
  constructor() {
    super(
      'No D1 binding. Create the database with `wrangler d1 create bba-heartbeat`, ' +
        'put the id in wrangler.jsonc, then `npm run db:migrate:local`.',
    );
    this.name = 'NoDatabaseError';
  }
}

/** The Cloudflare env, or null when running outside a Worker. */
export function cfEnv(): CloudflareEnv | null {
  try {
    return getCloudflareContext().env as CloudflareEnv;
  } catch {
    return null;
  }
}

export function getDb(): D1Database | null {
  return cfEnv()?.DB ?? null;
}

export function getCache(): KVNamespace | null {
  return cfEnv()?.CACHE ?? null;
}

/** Read many rows. Returns `[]` when there is no database rather than throwing. */
export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = getDb();
  if (!db) return [];
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const { results } = await stmt.all<T>();
  return results ?? [];
}

/** Read one row, or null. */
export async function queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Read a single scalar. Used for counts and sums, where D1 returns
 * `{ 'sum(x)': 1200 }` and destructuring by name is fragile.
 */
export async function queryValue<T = number>(sql: string, params: unknown[] = []): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return (await stmt.first<T>()) as T | null;
}

/** Write. Throws when there is no database — a silently dropped write is worse. */
export async function execute(sql: string, params: unknown[] = []): Promise<D1Result> {
  const db = getDb();
  if (!db) throw new NoDatabaseError();
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return stmt.run();
}

/** Several statements as one D1 batch — atomic, and one round trip. */
export async function batch(
  statements: { sql: string; params?: unknown[] }[],
): Promise<D1Result[]> {
  const db = getDb();
  if (!db) throw new NoDatabaseError();
  return db.batch(
    statements.map(({ sql, params }) =>
      params?.length ? db.prepare(sql).bind(...params) : db.prepare(sql),
    ),
  );
}

/** True when the dashboard has a database to talk to. Drives the setup banner. */
export function hasDatabase(): boolean {
  return getDb() !== null;
}
