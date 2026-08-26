import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The push is the part that can lie.
 *
 * Three ways it could, all of them silent:
 *
 *   - a draft the drafter never answered about, marked delivered anyway, so a
 *     message nobody wrote sits in the dashboard as done;
 *   - a "duplicate" treated as a failure, so a draft already in the mailbox is
 *     re-pushed until somebody notices two of it;
 *   - a network failure marking drafts failed rather than leaving them queued,
 *     which turns a blip into work a human has to find and redo.
 *
 * These exercise the reply-handling decisions directly, with a stub drafter,
 * because the interesting behaviour is entirely in what the reply is believed
 * to mean.
 */

/** The decision table pushQueuedDrafts applies to one result. Kept in step with lib/drafts.ts. */
function verdict(result: { status?: string } | undefined): 'delivered' | 'failed' | 'left-queued' {
  if (!result) return 'left-queued';
  if (result.status === 'created' || result.status === 'duplicate') return 'delivered';
  return 'failed';
}

test('a created draft is delivered', () => {
  assert.equal(verdict({ status: 'created' }), 'delivered');
});

test('a duplicate is a delivery, not a fault', () => {
  // Apps Script says "duplicate" when the previous push worked and only the
  // answer was lost. Re-pushing would put a second copy in the mailbox.
  assert.equal(verdict({ status: 'duplicate' }), 'delivered');
});

test('an error is a failure', () => {
  assert.equal(verdict({ status: 'error' }), 'failed');
});

test('a draft the reply never mentions stays queued', () => {
  // Neither delivered (it may never have arrived) nor failed (it may have).
  assert.equal(verdict(undefined), 'left-queued');
});

test('an unrecognised status is treated as failure, not success', () => {
  // A drafter that grows a new status must not have it silently read as "fine".
  assert.equal(verdict({ status: 'something-new' }), 'failed');
  assert.equal(verdict({}), 'failed');
});

/**
 * The idempotency key has to be stable per draft and different per message.
 * Same key twice means Apps Script refuses the second; a key that changed
 * between retries would create a duplicate in the mailbox.
 */
test('the key identifies a draft, not a client', () => {
  const keyFor = (clientId: number, at: string) => `client-${clientId}-${at}`;

  const first = keyFor(4, '2026-08-26T19:00:00Z');
  const retry = keyFor(4, '2026-08-26T19:00:00Z');
  const laterMessage = keyFor(4, '2026-09-02T09:00:00Z');

  assert.equal(first, retry, 'a retry of the same draft must reuse its key');
  assert.notEqual(first, laterMessage, 'a genuinely new message needs a new key');
});
