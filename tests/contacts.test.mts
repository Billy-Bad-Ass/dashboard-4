import test from 'node:test';
import assert from 'node:assert/strict';
import { splitByEmailability } from '../lib/crm.ts';
import type { Client } from '../lib/crm.ts';

/**
 * "Who can I email about this project" has to answer honestly.
 *
 * The failure this guards against is the one CLAUDE.md opens with, wearing a
 * different hat: a contact with no address must not quietly vanish from the
 * list, because a short list reads as "there is nobody" when the truth is
 * "there is somebody you cannot reach". The second failure is mailing the same
 * person twice off a duplicated row.
 */

function client(over: Partial<Client>): Client {
  return {
    id: 1,
    name: 'Someone',
    company: null,
    email: null,
    phone: null,
    website: null,
    status: 'prospect',
    project_slug: 'project-1',
    source: null,
    heat: 1,
    notes: null,
    last_contact_on: null,
    next_action: null,
    next_action_on: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

test('a contact with no address is counted, not dropped', () => {
  const split = splitByEmailability([
    client({ id: 1, name: 'Reachable', email: 'a@example.com' }),
    client({ id: 2, name: 'No address' }),
    client({ id: 3, name: 'Blank address', email: '   ' }),
  ]);

  assert.equal(split.all.length, 3);
  assert.deepEqual(
    split.emailable.map((c) => c.name),
    ['Reachable'],
  );
  assert.deepEqual(
    split.missingEmail.map((c) => c.name),
    ['No address', 'Blank address'],
  );
});

test('addresses are deduped case-insensitively, first occurrence wins', () => {
  const split = splitByEmailability([
    client({ id: 1, email: 'Ann@Example.com' }),
    client({ id: 2, email: 'ann@example.com' }),
    client({ id: 3, email: ' bob@example.com ' }),
  ]);

  assert.deepEqual(split.addresses, ['Ann@Example.com', 'bob@example.com']);
  // Both rows still show — two people may genuinely share an inbox.
  assert.equal(split.emailable.length, 3);
});

test('an empty set is empty everywhere, not undefined anywhere', () => {
  const split = splitByEmailability([]);
  assert.deepEqual(split, { all: [], emailable: [], missingEmail: [], addresses: [] });
});
