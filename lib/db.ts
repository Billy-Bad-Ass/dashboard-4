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
      'No D1 binding. Run the "Set up the dashboard" workflow in the repository\'s ' +
        'Actions tab \u2014 it creates the database and wires it up. With a terminal: ' +
        '`npm run setup`.',
    );
    this.name = 'NoDatabaseError';
  }
}

/**
 * The env handed to us by a non-request invocation, or null.
 *
 * OpenNext publishes the Cloudflare context through an AsyncLocalStorage store
 * that only its `fetch` handler ever opens. A cron trigger arrives at
 * `scheduled()` instead, so `getCloudflareContext()` throws there and every
 * binding — D1 included — reads as absent. That is not theoretical: it is why
 * the `heartbeats` table sat empty while three cron triggers fired on schedule.
 *
 * The store's global is installed as a getter-only property, so it cannot be
 * populated from outside. This module-level fallback is the way in. It is only
 * consulted when the real context is missing, so a request never sees it.
 */
let workerEnv: CloudflareEnv | null = null;

/**
 * Hand the bindings to code running outside a request — `scheduled()`, and
 * nothing else today. Called once per invocation by `worker/index.ts`.
 */
export function setWorkerEnv(env: CloudflareEnv): void {
  workerEnv = env;
}

/** The Cloudflare env, or null when running outside a Worker. */
export function cfEnv(): CloudflareEnv | null {
  try {
    return (getCloudflareContext().env as CloudflareEnv) ?? workerEnv;
  } catch {
    return workerEnv;
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
