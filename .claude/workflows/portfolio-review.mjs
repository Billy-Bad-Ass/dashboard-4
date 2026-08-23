export const meta = {
  name: 'portfolio-review',
  description: 'Review every project in parallel, verify each finding, then synthesise one action',
  whenToUse:
    'The weekly portfolio review, or any time you want a grounded read on where the business ' +
    'actually is rather than where the last report said it was.',
  phases: [
    { title: 'Read', detail: 'one analyst per project, plus one on the money' },
    { title: 'Verify', detail: 'adversarially check every finding against the data' },
    { title: 'Synthesise', detail: 'one ranked action list' },
  ],
};

/*
 * The shape here is deliberate: findings are verified before they are ranked,
 * not after. A plausible-but-wrong reading of a pre-revenue portfolio ("Project
 * 2 is earning") leads to exactly the wrong decision, and it is cheap to check
 * against an API that returns the real number.
 */

const PROJECTS = ['project-1', 'project-2', 'project-3', 'project-4'];

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'evidence', 'impact'],
        properties: {
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'The specific number or file that supports it' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          projectSlug: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT = {
  type: 'object',
  required: ['holds', 'why'],
  properties: {
    holds: { type: 'boolean' },
    why: { type: 'string' },
    correction: { type: 'string', description: 'The accurate version, if the claim was wrong' },
  },
};

phase('Read');

const reads = await pipeline(
  [...PROJECTS.map((slug) => ({ kind: 'project', slug })), { kind: 'money', slug: null }],

  (item) =>
    agent(
      item.kind === 'money'
        ? `Read $DASHBOARD_URL/api/pulse and the spend ledger at $DASHBOARD_URL/api/spend.
           Report on the money only: net revenue, total spend, burn rate, ROI per project.
           Amounts are in pence — 1400 is £14.00. Flag anything that looks mis-attributed
           or any recurring cost that may have stopped without an ended_on date.
           Zero revenue is the expected state; do not treat it as an anomaly, treat the
           spend side as the story.`
        : `Read $DASHBOARD_URL/api/pulse and find the entry for ${item.slug}.
           Then read config/portfolio.ts for that project's gates and stated reality.
           Report on: whether it is actually being built (commits, CI), which gates have
           moved since the last report in docs/reports/, and which gate has been stuck
           longest. Do not report revenue findings — another agent owns those.`,
      {
        label: item.kind === 'money' ? 'read:money' : `read:${item.slug}`,
        phase: 'Read',
        schema: FINDINGS,
      },
    ),

  // Each read's findings go straight to verification without waiting for the
  // other reads — a slow project analysis should not hold up a fast one.
  (read, item) =>
    parallel(
      (read?.findings ?? []).map(
        (finding) => () =>
          agent(
            `Try to REFUTE this claim about the BBA Network portfolio:

             Claim: ${finding.claim}
             Offered evidence: ${finding.evidence}

             Check it against the live data at $DASHBOARD_URL/api/pulse and the
             repository. Default to holds=false when you cannot confirm the specific
             number. A claim that is directionally true but numerically wrong does not
             hold — give the correction.`,
            { label: `verify:${item.slug ?? 'money'}`, phase: 'Verify', schema: VERDICT },
          ).then((verdict) => ({ ...finding, verdict })),
      ),
    ),
);

const survived = reads
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict?.holds);

const refuted = reads
  .flat()
  .filter(Boolean)
  .filter((f) => f && !f.verdict?.holds);

log(`${survived.length} findings held, ${refuted.length} refuted`);

phase('Synthesise');

const report = await agent(
  `Write the weekly BBA Network portfolio review from these verified findings.

   ${JSON.stringify(survived, null, 2)}

   These claims were REFUTED during verification and must not appear in the report,
   except where the correction itself is the finding:
   ${JSON.stringify(refuted.map((f) => ({ claim: f.claim, correction: f.verdict?.correction })), null, 2)}

   Structure: what changed, money, build velocity, gates, then exactly ONE
   recommendation with the number that supports it. Report pounds, from pence.
   If nothing changed this week, say so in the first line rather than padding.

   Write it to docs/reports/portfolio-<today's date>.md and return the path.`,
  { label: 'synthesise', phase: 'Synthesise' },
);

return { report, held: survived.length, refuted: refuted.length };
