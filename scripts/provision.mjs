/**
 * Create the Cloudflare resources and write their ids into wrangler.jsonc.
 *
 * Shared by `npm run setup` (interactive, local) and the "Set up the dashboard"
 * GitHub Action (headless, one button). Keeping the logic here rather than in
 * either caller means the iPad path and the terminal path cannot drift.
 *
 * Idempotent. A resource that already exists is the normal state on a second
 * run, not a failure — what matters is whether the id ends up in the config.
 * When a resource exists but its id is unknown (Cloudflare declines to reprint
 * it), the id is fetched from the list endpoint instead.
 *
 * Writes `ready=true|false` to $GITHUB_OUTPUT so the workflow knows whether the
 * later steps can run.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const D1_NAME = 'bba-heartbeat';
const KV_BINDING = 'CACHE';
const R2_NAME = 'bba-heartbeat-archive';

function run(command) {
  try {
    return execSync(`${command} 2>&1`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // wrangler exits non-zero for "already exists", which is not an error here.
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}

let config = readFileSync('wrangler.jsonc', 'utf8');
const notes = [];

/** Pull an id out of wrangler's JSON output, whatever shape it printed in. */
function findId(text, pattern) {
  return pattern.exec(text ?? '')?.[1] ?? null;
}

// --- D1 ---------------------------------------------------------------------

const D1_PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID';

if (config.includes(D1_PLACEHOLDER)) {
  const created = run(`npx wrangler d1 create ${D1_NAME}`);
  let id = findId(created, /"?database_id"?\s*[:=]\s*"?([0-9a-f-]{36})/i);

  if (!id) {
    // Already exists, or the create output did not echo the id. Either way the
    // list endpoint knows it.
    const listed = run('npx wrangler d1 list --json');
    try {
      const databases = JSON.parse(listed.slice(listed.indexOf('[')));
      id = databases.find((d) => d.name === D1_NAME)?.uuid ?? null;
    } catch {
      id = findId(listed, new RegExp(`${D1_NAME}[^]*?([0-9a-f]{8}-[0-9a-f-]{27})`, 'i'));
    }
  }

  if (id) {
    config = config.replace(D1_PLACEHOLDER, id);
    notes.push(`D1 database ready (${id})`);
  } else {
    notes.push('D1 database COULD NOT be resolved — check the token has D1:Edit');
  }
} else {
  notes.push('D1 database already configured');
}

// --- KV ---------------------------------------------------------------------

const KV_PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';

if (config.includes(KV_PLACEHOLDER)) {
  const created = run(`npx wrangler kv namespace create ${KV_BINDING}`);
  let id = findId(created, /"?id"?\s*[:=]\s*"?([0-9a-f]{32})/i);

  if (!id) {
    const listed = run('npx wrangler kv namespace list');
    try {
      const namespaces = JSON.parse(listed.slice(listed.indexOf('[')));
      // wrangler names it "<worker>-<binding>"; match on the binding suffix so
      // a renamed worker does not break the lookup.
      id =
        namespaces.find((n) => n.title === KV_BINDING || n.title?.endsWith(`-${KV_BINDING}`))?.id ??
        null;
    } catch {
      id = findId(listed, /([0-9a-f]{32})/i);
    }
  }

  if (id) {
    config = config.replace(KV_PLACEHOLDER, id);
    notes.push(`KV namespace ready (${id})`);
  } else {
    notes.push('KV namespace COULD NOT be resolved — check the token has Workers KV:Edit');
  }
} else {
  notes.push('KV namespace already configured');
}

// --- R2 ---------------------------------------------------------------------

const bucket = run(`npx wrangler r2 bucket create ${R2_NAME}`);
if (/already (exists|owned)/i.test(bucket)) {
  notes.push('R2 bucket already exists');
} else if (/created/i.test(bucket)) {
  notes.push('R2 bucket created');
} else {
  // R2 is only used for report archives, so a failure here should not stop the
  // deploy. Say so rather than failing the run.
  notes.push('R2 bucket not created — the dashboard runs without it');
}

// --- Write it back ----------------------------------------------------------

writeFileSync('wrangler.jsonc', config);

const ready = !config.includes('REPLACE_WITH_');

console.log(notes.map((n) => `  ${n}`).join('\n'));
console.log(ready ? '\nStorage is ready.' : '\nStorage is INCOMPLETE — see above.');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Storage\n\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`,
  );
}

// A missing id means the deploy would fail with a confusing binding error, so
// stop here with a clear one instead.
if (!ready) process.exit(1);
