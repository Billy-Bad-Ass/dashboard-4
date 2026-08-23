import test from 'node:test';
import assert from 'node:assert/strict';
import { cfEnv, getDb, setWorkerEnv } from '../lib/db.ts';
import { cadenceFor } from '../lib/cron.ts';

/**
 * These tests exist because of a silent failure that ran for hours.
 *
 * Three cron triggers fired on schedule against a Worker whose entry point had
 * no `scheduled` handler, and — once that was fixed — a tick would still have
 * found no D1 binding, because OpenNext only publishes the Cloudflare context
 * inside its `fetch` handler. Both faults look identical from outside: the
 * dashboard renders, the crons show as configured, and the `heartbeats` table
 * stays empty.
 */

test('with no request context and no worker env, there is no database', () => {
  setWorkerEnv(null as never);
  assert.equal(cfEnv(), null);
  assert.equal(getDb(), null);
});

test('setWorkerEnv gives a cron tick the bindings a request would have got', () => {
  const db = { prepare: () => {} } as unknown as D1Database;
  setWorkerEnv({ DB: db } as unknown as CloudflareEnv);

  assert.equal(getDb(), db, 'the tick must see the same D1 handle a request sees');

  // Leave the module as we found it, so ordering between test files cannot
  // make a later assertion pass for the wrong reason.
  setWorkerEnv(null as never);
  assert.equal(getDb(), null);
});

test('every cron in wrangler.jsonc maps to a cadence', () => {
  // The three expressions are duplicated from wrangler.jsonc on purpose: if
  // someone edits a schedule there without teaching cadenceFor about it, the
  // tick silently downgrades to 'fast' and the daily roll-up stops happening.
  assert.equal(cadenceFor('*/10 * * * *'), 'fast');
  assert.equal(cadenceFor('17 * * * *'), 'hourly');
  assert.equal(cadenceFor('23 6 * * *'), 'daily');
});
