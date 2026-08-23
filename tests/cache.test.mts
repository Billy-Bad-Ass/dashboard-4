import test from 'node:test';
import assert from 'node:assert/strict';
import { cached } from '../lib/heartbeat.ts';
import { setWorkerEnv } from '../lib/db.ts';

/**
 * The KV read-through layer, tested against the failure it actually shipped.
 *
 * Every connector reported "failed" on every cron tick while the dashboard
 * itself looked healthy, because the cron is the only caller that passes
 * ttl 0 — and ttl 0 was the one value that broke the write. Nothing here is
 * hypothetical: each test is a fault that ran in production.
 */

interface Put {
  key: string;
  body: string;
  ttl: number | undefined;
}

function fakeKv(options: { store?: Record<string, unknown>; failPuts?: boolean } = {}) {
  const store: Record<string, unknown> = options.store ?? {};
  const puts: Put[] = [];
  const gets: string[] = [];

  const kv = {
    async get(key: string) {
      gets.push(key);
      return store[key] ?? null;
    },
    async put(key: string, body: string, opts?: { expirationTtl?: number }) {
      // The real KV rejects this outright; its documented minimum is 60.
      if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) {
        throw new Error(
          `Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least 60.`,
        );
      }
      if (options.failPuts) throw new Error('KV unavailable');
      puts.push({ key, body, ttl: opts?.expirationTtl });
      store[key] = JSON.parse(body);
    },
  };

  setWorkerEnv({ CACHE: kv } as unknown as CloudflareEnv);
  return { puts, gets, store };
}

test.afterEach(() => setWorkerEnv(null as never));

test('ttl 0 goes and looks instead of returning the cached value', async () => {
  const kv = fakeKv({ store: { stripe: { stale: true } } });
  let calls = 0;

  const result = await cached('stripe', 0, async () => {
    calls += 1;
    return { fresh: true };
  });

  assert.equal(calls, 1, 'the cron asked for fresh data and must get it');
  assert.deepEqual(result, { fresh: true });
  assert.ok(!kv.gets.includes('stripe'), 'a fresh read must not consult the hot key');
});

test('ttl 0 never writes the hot key, because KV would reject the ttl', async () => {
  const kv = fakeKv();

  await cached('stripe', 0, async () => ({ ok: true }));

  assert.deepEqual(
    kv.puts.map((p) => p.key),
    ['stripe:last'],
    'only the long-lived stale copy is written on a fresh pass',
  );
  assert.ok(kv.puts[0]!.ttl! >= 60);
});

test('a cache write that fails does not fail a load that succeeded', async () => {
  fakeKv({ failPuts: true });

  const result = await cached('stripe', 300, async () => ({ ok: true }));

  assert.deepEqual(result, { ok: true }, 'caching is an optimisation, not a dependency');
});

test('a failing loader falls back to the last known good value', async () => {
  fakeKv({ store: { 'stripe:last': { revenue: 4200 } } });

  const result = await cached('stripe', 300, async () => {
    throw new Error('Stripe timed out');
  });

  assert.deepEqual(result, { revenue: 4200 });
});

test('with nothing to fall back on, the real cause survives', async () => {
  fakeKv();

  await assert.rejects(
    () => cached('stripe', 300, async () => Promise.reject(new Error('401 no such key'))),
    // The old message named no cause at all, which is what made this bug take
    // a code read rather than a log read.
    /401 no such key/,
  );
});

test('a warm ttl serves the hot key without calling the loader', async () => {
  fakeKv({ store: { stripe: { cachedValue: 1 } } });
  let calls = 0;

  const result = await cached('stripe', 300, async () => {
    calls += 1;
    return { cachedValue: 2 };
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { cachedValue: 1 });
});
