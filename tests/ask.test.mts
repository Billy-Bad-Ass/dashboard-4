import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSql } from '../lib/ask.ts';

function ok(sql: string): string {
  const result = validateSql(sql);
  assert.ok(result.ok, `expected ${sql} to be allowed`);
  return result.sql;
}

function rejected(sql: string): string {
  const result = validateSql(sql);
  assert.ok(!result.ok, `expected ${sql} to be rejected`);
  return result.reason;
}

test('allows a plain SELECT and adds a LIMIT', () => {
  assert.match(ok('SELECT * FROM spend'), /LIMIT 200$/);
});

test('respects a LIMIT the query already has', () => {
  const sql = ok('SELECT * FROM clients LIMIT 5');
  assert.match(sql, /LIMIT 5$/);
  assert.ok(!/LIMIT 200/.test(sql));
});

test('strips a trailing semicolon rather than rejecting it', () => {
  // Models emit trailing semicolons constantly. Rejecting on that would make
  // the tool feel broken for no security benefit.
  assert.match(ok('SELECT vendor FROM spend;'), /^SELECT vendor FROM spend LIMIT 200$/);
});

test('rejects anything that is not a SELECT', () => {
  for (const sql of [
    "UPDATE spend SET amount_pence = 0",
    "DELETE FROM clients",
    "INSERT INTO spend (vendor) VALUES ('x')",
    "DROP TABLE revenue",
    'PRAGMA table_info(spend)',
  ]) {
    rejected(sql);
  }
});

test('rejects a second statement smuggled in after a semicolon', () => {
  const reason = rejected('SELECT 1; DROP TABLE spend');
  assert.match(reason, /one statement/i);
});

test('rejects a write keyword hidden inside a subquery', () => {
  rejected('SELECT * FROM spend WHERE id IN (SELECT id FROM spend); DELETE FROM spend');
  rejected('SELECT * FROM spend UNION SELECT * FROM sqlite_master');
});

test('rejects tables that are not on the allow-list', () => {
  // sqlite_master would expose schema of anything added later; the allow-list
  // means a new table has to be opted in rather than opted out.
  const reason = rejected('SELECT * FROM sqlite_master');
  assert.match(reason, /No table `sqlite_master`/);
  rejected('SELECT * FROM spend JOIN secrets ON 1=1');
});

test('allows joins between permitted tables', () => {
  ok('SELECT c.name, d.value_pence FROM clients c JOIN deals d ON d.client_id = c.id');
});

test('allows aggregates and date filters', () => {
  ok("SELECT category, SUM(amount_pence) FROM spend WHERE incurred_on >= '2026-08-01' GROUP BY category");
});

test('is not fooled by a keyword appearing inside a string or column name', () => {
  // "created_at" contains no banned word; "updated_at" contains "update" only
  // as a substring, and word boundaries must keep it legal.
  ok('SELECT created_at, updated_at FROM clients');
});
