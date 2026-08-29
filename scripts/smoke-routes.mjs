/**
 * Boot the Worker that actually ships, and ask it for every page.
 *
 * ## Why this exists
 *
 * On 2026-08-29 every project page and `/finance` answered 500 in production,
 * for five different requests over an unknown number of days, while CI was
 * green on every commit. Nothing was broken about the checks that ran — they
 * were the wrong checks:
 *
 *   | What CI did                    | What it proves            |
 *   | ------------------------------ | ------------------------- |
 *   | `tsc --noEmit`                 | the types line up         |
 *   | `node --test`                  | the units behave          |
 *   | `next build`                   | the pages compile         |
 *   | `opennextjs-cloudflare build`  | the bundle assembles      |
 *   | *(nothing)*                    | **a page renders**        |
 *
 * The bug was `format={(v) => …}` passed from a server component to a client
 * component. That is legal TypeScript, legal React, and it compiles and bundles
 * without complaint. It fails when React tries to serialise the props, which
 * only happens when something renders the component — so the first thing that
 * ever noticed was a person clicking a link on the live site.
 *
 * The repo already had the right instinct one step earlier. `ci.yml` builds the
 * Worker bundle because "the Next build passing does not mean the thing that
 * actually ships passes". This is the next step in that same sentence: the
 * bundle assembling does not mean it serves.
 *
 * ## Why it seeds a database first
 *
 * Because the empty case is a different page. Every panel that crashed sits
 * behind a `rows.length > 0` guard, so against an empty D1 all these routes
 * return a clean 200 while carrying the same bug. `db/smoke.sql` exists to make
 * the guarded half render — see the note at the top of it.
 *
 * ## What a failure here means
 *
 * A route answered something other than 200 in the real runtime. That is the
 * production symptom, reproduced, before anybody has to click anything. The
 * wrangler output is printed on failure and the offending route is named.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Project slugs, read out of the register rather than listed here.
 *
 * A hardcoded list is a list that silently stops covering the project added
 * after it was written — and "every project page" is exactly what broke.
 * Parsed with a regex rather than imported: this script runs as plain Node
 * with no TypeScript loader, and `config/portfolio.ts` pulls in half of `lib/`.
 */
function projectSlugs() {
  const source = readFileSync(resolve(ROOT, 'config/portfolio.ts'), 'utf8');
  const slugs = [...source.matchAll(/^\s*slug:\s*'([^']+)'/gm)].map((m) => m[1]);
  if (slugs.length === 0) {
    throw new Error('No project slugs found in config/portfolio.ts — has the shape changed?');
  }
  return slugs;
}

const ROUTES = [
  '/',
  '/finance',
  '/agents',
  '/clients',
  '/calendar',
  '/setup',
  '/ask',
  ...projectSlugs().map((slug) => `/projects/${slug}`),
  // A slug the register does not know must still be a clean 404, not a crash.
  '/projects/does-not-exist',
];

/** Expected status per route. Everything not named here must answer 200. */
const EXPECTED = { '/projects/does-not-exist': 404 };

function run(command, args, label) {
  // Its own process group, so teardown can take the whole tree down.
  //
  // `wrangler dev` is a wrapper: the thing holding the port is a `workerd`
  // child. Signalling only the wrapper leaves `workerd` alive and listening,
  // and the next run of this script dies on "Address already in use" — a
  // failure that looks nothing like the bug it is supposed to be reporting.
  const child = spawn(command, args, { cwd: ROOT, stdio: 'pipe', detached: true });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, label, read: () => output };
}

/**
 * Signal the whole group, then insist.
 *
 * `SIGTERM` alone frees the port but leaves workerd's helper processes behind,
 * which accumulate one set per run. Escalating to `SIGKILL` after a grace
 * period is the difference between a script that tidies up and one that leaks
 * a handful of processes on every CI job.
 */
async function stop(child) {
  const signal = (sig) => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      // The group is already gone, which is the outcome we wanted.
    }
  };

  signal('SIGTERM');
  await new Promise((done) => setTimeout(done, 1500));
  signal('SIGKILL');
}

async function step(command, args, label) {
  process.stdout.write(`  ${label}… `);
  const { child, read } = run(command, args, label);
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    process.stdout.write('failed\n');
    console.error(read());
    process.exit(1);
  }
  process.stdout.write('ok\n');
}

async function main() {
  console.log('Route smoke test');

  // A throwaway local D1. `--local` never touches the production database.
  //
  // Dropped and rebuilt every run rather than reused. The fixture is not
  // idempotent — `revenue` has a unique index on the Stripe id, and the deals
  // reference clients by row id — so a second run against a surviving database
  // fails on the seed. A check that only passes the first time is a check
  // somebody will start ignoring on the second.
  process.stdout.write('  reset… ');
  rmSync(resolve(ROOT, '.wrangler/state/v3/d1'), { recursive: true, force: true });
  process.stdout.write('ok\n');

  await step('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bba-heartbeat', '--local'], 'migrate');
  await step(
    'npx',
    ['wrangler', 'd1', 'execute', 'bba-heartbeat', '--local', '--file=db/smoke.sql'],
    'seed',
  );

  process.stdout.write('  boot… ');
  const server = run('npx', ['wrangler', 'dev', '--port', String(PORT)], 'wrangler dev');

  const ready = await waitForReady(server, 120_000);
  if (!ready) {
    process.stdout.write('failed\n');
    console.error(server.read());
    await stop(server.child);
    process.exit(1);
  }
  process.stdout.write('ok\n\n');

  const failures = [];
  try {
    for (const route of ROUTES) {
      const want = EXPECTED[route] ?? 200;
      let status = 0;
      let body = '';
      try {
        const response = await fetch(`${BASE}${route}`, { redirect: 'manual' });
        status = response.status;
        // Only read the body on a failure — the point is the status, and these
        // pages are large.
        if (status !== want) body = (await response.text()).slice(0, 400);
      } catch (error) {
        body = String(error);
      }

      const ok = status === want;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route} → ${status}${ok ? '' : ` (expected ${want})`}`);
      if (!ok) failures.push({ route, status, want, body });
    }
  } finally {
    await stop(server.child);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} route(s) did not render:\n`);
    for (const f of failures) {
      console.error(`  ${f.route} → ${f.status}, expected ${f.want}`);
      if (f.body) console.error(`    ${f.body.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    console.error('\nWorker output:\n');
    console.error(server.read());
    process.exit(1);
  }

  console.log(`\nAll ${ROUTES.length} routes rendered.`);
  process.exit(0);
}

/**
 * Wait for wrangler to say it is listening.
 *
 * Polling the port instead would race: wrangler binds before the Worker is
 * loaded, so a request can arrive early and fail for a reason that has nothing
 * to do with the code under test.
 */
function waitForReady(server, timeoutMs) {
  return new Promise((resolveReady) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (/Ready on http/i.test(server.read())) {
        clearInterval(timer);
        resolveReady(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolveReady(false);
      }
    }, 500);
  });
}

await main();
