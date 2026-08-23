/**
 * One-command setup.
 *
 * Replaces about fifteen manual steps: creates the D1 database, the KV
 * namespace and the R2 bucket, writes their ids into wrangler.jsonc, applies
 * the migrations, seeds, and then walks through the secrets one at a time
 * explaining what each is for and where to get it.
 *
 * Everything is idempotent. Re-running after a half-finished attempt picks up
 * where it stopped rather than erroring on things that already exist, which is
 * the state most people are actually in when they re-run a setup script.
 *
 *   npm run setup
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, output: stdout });

const ESC = '[';
const c = {
  bold: (s) => `${ESC}1m${s}${ESC}0m`,
  dim: (s) => `${ESC}2m${s}${ESC}0m`,
  green: (s) => `${ESC}32m${s}${ESC}0m`,
  yellow: (s) => `${ESC}33m${s}${ESC}0m`,
  red: (s) => `${ESC}31m${s}${ESC}0m`,
  blue: (s) => `${ESC}36m${s}${ESC}0m`,
};

const tick = c.green('OK');
const cross = c.red('!!');
const dot = c.dim('--');

const TOTAL = 6;

function heading(n, text) {
  console.log(`\n${c.blue(`[${n}/${TOTAL}]`)} ${c.bold(text)}`);
}

/** Run a command and return stdout, or null if it failed. */
function tryRun(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

async function ask(question, fallback = '') {
  const answer = (await rl.question(`${question} `)).trim();
  return answer || fallback;
}

async function confirm(question) {
  const answer = (await ask(`${question} ${c.dim('[y/N]')}`)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}

// ---------------------------------------------------------------------------

console.log(c.bold('\nBBA Network heartbeat -- setup\n'));
console.log('This creates your Cloudflare storage, wires it up and loads your secrets.');
console.log(c.dim('Nothing here is destructive. Safe to re-run if it stops half way.\n'));

// --- 1. Cloudflare login ----------------------------------------------------

heading(1, 'Cloudflare account');

const whoami = tryRun('npx wrangler whoami 2>&1');
if (!whoami || /not authenticated|log in/i.test(whoami)) {
  console.log(`${dot} Not logged in. A browser window will open.`);
  const result = spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.log(`${cross} Login failed. Run ${c.bold('npx wrangler login')} yourself, then re-run this.`);
    process.exit(1);
  }
}

const account = tryRun('npx wrangler whoami 2>&1') ?? '';
const accountId = /([0-9a-f]{32})/.exec(account)?.[1] ?? null;
console.log(`${tick} Logged in${accountId ? ` ${c.dim(`(account ${accountId})`)}` : ''}`);

// --- 2. Storage -------------------------------------------------------------

heading(2, 'Creating storage');

let config = readFileSync('wrangler.jsonc', 'utf8');

/**
 * Create a resource and write its id into wrangler.jsonc.
 *
 * A resource that already exists is not an error — that is the normal state on
 * a second run. What matters is whether the id ended up in the config.
 */
function provision(label, command, idPattern, placeholder) {
  if (!config.includes(placeholder)) {
    console.log(`${tick} ${label} ${c.dim('already configured')}`);
    return;
  }

  const output = tryRun(`${command} 2>&1`);
  const id = output ? idPattern.exec(output)?.[1] : null;

  if (id) {
    config = config.replace(placeholder, id);
    console.log(`${tick} ${label} created ${c.dim(id)}`);
    return;
  }

  if (output && /already exists/i.test(output)) {
    console.log(`${c.yellow('!')} ${label} exists, but its id is not in wrangler.jsonc.`);
    console.log(`   ${c.dim('Find it in the Cloudflare dashboard and paste it in by hand.')}`);
    return;
  }

  console.log(`${cross} ${label} failed:`);
  const detail = (output ?? 'no output').split('\n').slice(0, 4);
  console.log(c.dim(detail.map((line) => `   ${line}`).join('\n')));
}

provision(
  'D1 database',
  'npx wrangler d1 create bba-heartbeat',
  /"?database_id"?\s*[:=]\s*"?([0-9a-f-]{36})/i,
  'REPLACE_WITH_D1_DATABASE_ID',
);

provision(
  'KV namespace',
  'npx wrangler kv namespace create CACHE',
  /"?id"?\s*[:=]\s*"?([0-9a-f]{32})/i,
  'REPLACE_WITH_KV_NAMESPACE_ID',
);

const bucket = tryRun('npx wrangler r2 bucket create bba-heartbeat-archive 2>&1') ?? '';
if (/already (exists|owned)/i.test(bucket)) {
  console.log(`${tick} R2 bucket ${c.dim('already exists')}`);
} else if (/created/i.test(bucket)) {
  console.log(`${tick} R2 bucket created`);
} else {
  console.log(`${c.yellow('!')} R2 bucket -- check it by hand; the dashboard runs without it`);
}

writeFileSync('wrangler.jsonc', config);

const stillMissing = config.includes('REPLACE_WITH_');
if (stillMissing) {
  console.log(`\n${c.yellow('!')} wrangler.jsonc still has placeholders. Fill them in before deploying.`);
}

// --- 3. Schema --------------------------------------------------------------

heading(3, 'Setting up the database');

if (stillMissing) {
  console.log(`${dot} Skipped -- no database id yet.`);
} else {
  const steps = [
    ['Schema', 'npx wrangler d1 migrations apply bba-heartbeat --remote'],
    ['Seed data', 'npx wrangler d1 execute bba-heartbeat --remote --file=db/seed.sql'],
  ];
  for (const [label, command] of steps) {
    // Newer wrangler prompts before touching a remote database; older versions
    // reject the flag that skips it, so fall back to the bare command.
    const output = tryRun(`${command} --yes 2>&1`) ?? tryRun(`${command} 2>&1`);
    if (output && !/\berror\b/i.test(output)) {
      console.log(`${tick} ${label} applied`);
    } else {
      console.log(`${c.yellow('!')} ${label}: run ${c.bold(command)} yourself if this looks wrong`);
    }
  }
}

// --- 4. Secrets -------------------------------------------------------------

heading(4, 'Secrets');

console.log('Each of these is optional -- the dashboard runs without any of them and');
console.log(`shows what is missing on ${c.bold('/setup')}. Press Enter to skip one.\n`);

const SECRETS = [
  {
    name: 'ANTHROPIC_API_KEY',
    what: 'Powers the Ask page and the scheduled agents.',
    where: 'console.anthropic.com -> API keys -> Create key',
  },
  {
    name: 'STRIPE_SECRET_KEY',
    what: 'Revenue, refunds and balance.',
    where:
      'Stripe -> Developers -> API keys -> Create restricted key.\n' +
      '     Tick READ on Charges, Balance, Products, Disputes. Nothing else.\n' +
      '     Make sure you are in LIVE mode, not test.',
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    what: 'Worker traffic -- what the 5 a month is buying.',
    where:
      'Cloudflare -> your icon (top right) -> API Tokens -> Create Token ->\n' +
      '     Custom token -> Account -> Account Analytics -> Read. Only that.',
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    what: 'Which account the analytics query targets.',
    where: accountId ? `detected as ${accountId}, press Enter to accept` : 'the hex string in your Cloudflare dashboard URL',
    suggested: accountId,
  },
  {
    name: 'CALENDAR_ICS_URL',
    what: 'Read-only feed for bbacentralworkspace@gmail.com.',
    where:
      'calendar.google.com -> gear -> Settings -> click the calendar on the left ->\n' +
      '     scroll to "Secret address in iCal format". Treat it like a password.',
  },
  {
    name: 'DASHBOARD_TOKEN',
    what: 'Guards every write endpoint. Generated for you if you skip it.',
    where: 'generated automatically',
    generate: true,
  },
];

const devVars = [];

for (const secret of SECRETS) {
  console.log(`\n   ${c.bold(secret.name)}`);
  console.log(`   ${c.dim(secret.what)}`);
  console.log(`   ${c.dim(`Get it: ${secret.where}`)}`);

  let value = await ask(`   ${c.blue('>')}`, secret.suggested ?? '');

  if (!value && secret.generate) {
    value = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    console.log(`   ${tick} Generated one for you.`);
  }

  if (!value) {
    console.log(`   ${dot} Skipped.`);
    continue;
  }

  devVars.push(`${secret.name}=${value}`);

  const result = spawnSync('npx', ['wrangler', 'secret', 'put', secret.name], {
    input: `${value}\n`,
    encoding: 'utf8',
    shell: true,
  });

  if (result.status === 0) {
    console.log(`   ${tick} Saved to Cloudflare.`);
  } else {
    // Secrets cannot be set on a Worker that has never been deployed. Keeping
    // the value locally means a re-run after deploying finishes the job.
    console.log(`   ${c.yellow('!')} Saved locally only -- deploy first, then re-run this.`);
  }
}

// --- 5. Local development file ---------------------------------------------

heading(5, 'Local development');

if (devVars.length === 0) {
  console.log(`${dot} Nothing to write -- no secrets entered.`);
} else if (existsSync('.dev.vars') && !(await confirm('.dev.vars already exists. Overwrite it?'))) {
  console.log(`${dot} Left alone.`);
} else {
  writeFileSync(
    '.dev.vars',
    `# Written by npm run setup. Gitignored. Same values as the Worker secrets.\n${devVars.join('\n')}\n`,
  );
  console.log(`${tick} Wrote .dev.vars ${c.dim(`(${devVars.length} values)`)}`);
}

// --- 6. Deploy --------------------------------------------------------------

heading(6, 'Deploy');

if (stillMissing) {
  console.log(`${cross} Cannot deploy -- wrangler.jsonc still has placeholders.`);
} else if (await confirm('Deploy to Cloudflare now?')) {
  const result = spawnSync('npm', ['run', 'cf:deploy'], { stdio: 'inherit', shell: true });
  console.log(
    result.status === 0
      ? `\n${tick} ${c.bold('Deployed.')}`
      : `\n${cross} Deploy failed. Run ${c.bold('npm run cf:deploy')} to see why.`,
  );
} else {
  console.log(`${dot} Skipped. Run ${c.bold('npm run cf:deploy')} when ready.`);
}

// --- What is left -----------------------------------------------------------

const token = devVars.find((v) => v.startsWith('DASHBOARD_TOKEN='))?.split('=')[1];

console.log(c.bold('\n\nWhat is left for you\n'));

console.log(`   ${c.bold('1.')} Open the dashboard and check ${c.bold('/setup')} -- it lists anything still missing.`);

console.log(`\n   ${c.bold('2.')} ${c.yellow('Lock it down.')} Until you do, anyone with the URL can read your finances.`);
console.log('      Cloudflare -> Zero Trust -> Access -> Applications -> Add an application');
console.log('      -> Self-hosted -> point it at your worker URL -> policy: Emails -> your address.');
console.log(c.dim('      Free up to 50 users, on the plan you already pay for.'));

console.log(`\n   ${c.bold('3.')} Let the agents report in. In Project-1, Project-2 and Project-4 on`);
console.log('      GitHub -> Settings -> Secrets and variables -> Actions, add to each:');
console.log(c.dim('        DASHBOARD_URL       your worker URL'));
console.log(c.dim(`        DASHBOARD_TOKEN     ${token ?? 'the value you set above'}`));
console.log(c.dim('        ANTHROPIC_API_KEY   your key'));

console.log(c.dim('\n   Full detail and troubleshooting: docs/RUNBOOK.md\n'));

rl.close();
