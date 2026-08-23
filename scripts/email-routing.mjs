/**
 * Set up Cloudflare Email Routing through the REST API.
 *
 * Run by .github/workflows/email-routing.yml, which is where the token setup
 * and teardown are documented.
 *
 * What it can and cannot do:
 *
 *   CAN   create the destination address, enable routing, add the MX and SPF
 *         records, and create the forwarding rules.
 *   CANNOT verify the destination address. Cloudflare emails a confirmation
 *         link to the destination and a human has to click it. Rules created
 *         before that click exist but do not deliver.
 *
 * So this gets you from about twenty clicks to one, and says clearly which one
 * is left.
 *
 * Idempotent: an address or rule that already exists is the expected state on a
 * second run, not an error.
 */

const API = 'https://api.cloudflare.com/client/v4';

const token = process.env.CF_TOKEN;
const zoneName = process.env.ZONE;
const forwardTo = process.env.FORWARD_TO;
const prefixes = (process.env.ADDRESSES ?? '')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);
const catchAll = process.env.CATCH_ALL === 'true';

const notes = [];
let needsVerification = false;
let failed = false;

function note(icon, text) {
  notes.push(`${icon} ${text}`);
  console.log(`${icon} ${text}`);
}

/**
 * Cloudflare returns HTTP 200 with `success: false` for a lot of business-logic
 * failures, so checking response.ok alone reports a rejected call as fine.
 */
async function cf(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, errors: [{ message: `${response.status} with a non-JSON body` }] };
  }

  return {
    ok: response.ok && body.success !== false,
    status: response.status,
    result: body.result,
    errors: body.errors ?? [],
  };
}

/** True when the error list says "this already exists", which is not a failure. */
function alreadyExists(errors) {
  return errors.some((e) =>
    /already exist|duplicate|already been created|already added/i.test(e.message ?? ''),
  );
}

function describe(errors) {
  return errors.map((e) => `${e.code ? `[${e.code}] ` : ''}${e.message}`).join('; ') || 'unknown error';
}

// --- Resolve the zone -------------------------------------------------------

const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
if (!zones.ok || !zones.result?.length) {
  note('❌', `Cannot find the zone ${zoneName}: ${describe(zones.errors)}`);
  note('  ', 'Check the token has Zone Resources -> Include -> that specific zone.');
  process.exit(1);
}
const zoneId = zones.result[0].id;
const accountId = process.env.CF_ACCOUNT_ID || zones.result[0].account?.id;
note('✅', `Zone ${zoneName} found`);

if (!accountId) {
  note('❌', 'No account id — set CLOUDFLARE_ACCOUNT_ID as a repository secret.');
  process.exit(1);
}

// --- Destination address ----------------------------------------------------

const existing = await cf(`/accounts/${accountId}/email/routing/addresses?per_page=50`);
const known = (existing.result ?? []).find(
  (a) => a.email?.toLowerCase() === forwardTo.toLowerCase(),
);

if (known?.verified) {
  note('✅', `${forwardTo} is already verified as a destination`);
} else if (known) {
  note('⚠️', `${forwardTo} exists as a destination but is NOT verified yet`);
  needsVerification = true;
} else {
  const created = await cf(`/accounts/${accountId}/email/routing/addresses`, {
    method: 'POST',
    body: JSON.stringify({ email: forwardTo }),
  });
  if (created.ok || alreadyExists(created.errors)) {
    note('✅', `Destination ${forwardTo} added — Cloudflare has emailed it a verification link`);
    needsVerification = true;
  } else {
    note('❌', `Could not add ${forwardTo}: ${describe(created.errors)}`);
    failed = true;
  }
}

// --- Enable routing (adds the MX and SPF records) ---------------------------

const settings = await cf(`/zones/${zoneId}/email/routing`);
if (settings.result?.enabled) {
  note('✅', 'Email routing already enabled');
} else {
  // The DNS-creating variant. Without it the rules exist but no mail arrives,
  // because nothing tells the internet where to deliver.
  let enabled = await cf(`/zones/${zoneId}/email/routing/dns`, { method: 'POST' });
  if (!enabled.ok) {
    enabled = await cf(`/zones/${zoneId}/email/routing/enable`, { method: 'POST' });
  }
  if (enabled.ok || alreadyExists(enabled.errors)) {
    note('✅', 'Email routing enabled and MX/SPF records added');
  } else {
    note('❌', `Could not enable routing: ${describe(enabled.errors)}`);
    note('  ', 'Usually means the token is missing Zone -> DNS -> Edit.');
    failed = true;
  }
}

// --- Forwarding rules -------------------------------------------------------

const rules = await cf(`/zones/${zoneId}/email/routing/rules?per_page=50`);
const haveRuleFor = new Set(
  (rules.result ?? []).flatMap((r) =>
    (r.matchers ?? [])
      .filter((m) => m.field === 'to')
      .map((m) => String(m.value).toLowerCase()),
  ),
);

for (const prefix of prefixes) {
  const address = `${prefix}@${zoneName}`;
  if (haveRuleFor.has(address)) {
    note('✅', `${address} already routed`);
    continue;
  }
  const rule = await cf(`/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    body: JSON.stringify({
      name: `${prefix} -> ${forwardTo}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: address }],
      actions: [{ type: 'forward', value: [forwardTo] }],
    }),
  });
  if (rule.ok || alreadyExists(rule.errors)) {
    note('✅', `${address} -> ${forwardTo}`);
  } else {
    note('❌', `Could not route ${address}: ${describe(rule.errors)}`);
    failed = true;
  }
}

// --- Catch-all --------------------------------------------------------------

if (catchAll) {
  const result = await cf(`/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'catch-all',
      enabled: true,
      matchers: [{ type: 'all' }],
      actions: [{ type: 'forward', value: [forwardTo] }],
    }),
  });
  if (result.ok) {
    note('✅', `Catch-all -> ${forwardTo} (a typo'd address still reaches you)`);
  } else {
    note('⚠️', `Catch-all not set: ${describe(result.errors)}`);
  }
}

// --- Summary ----------------------------------------------------------------

const summary = [
  '## Email routing',
  '',
  ...notes.map((n) => `- ${n}`),
  '',
];

if (needsVerification) {
  summary.push(
    '### One thing left, and it has to be you',
    '',
    `**Open ${forwardTo} and click the verification link Cloudflare just sent.**`,
    'Subject is something like "Verify your email address". Check spam if it is not there.',
    '',
    'Until you click it, the rules above exist but deliver nothing. Cloudflare will not',
    'let anyone — including this workflow — verify an inbox on your behalf, which is the',
    'correct behaviour: otherwise anyone could forward your mail somewhere else.',
    '',
    `Then test it: email **${prefixes[0] ?? 'support'}@${zoneName}** from your phone and`,
    'check it arrives.',
    '',
  );
} else if (!failed) {
  summary.push(
    '### Done',
    '',
    `Send a test email to **${prefixes[0] ?? 'support'}@${zoneName}** to confirm.`,
    '',
  );
}

summary.push(
  '### Now delete the token',
  '',
  '`CF_SETUP_TOKEN` is much wider than the deploy token and has done its job.',
  'Delete it in Cloudflare (API Tokens) and here (Settings -> Secrets and variables',
  '-> Actions). Leaving it costs nothing today and everything on a bad day.',
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
}

process.exit(failed ? 1 : 0);
