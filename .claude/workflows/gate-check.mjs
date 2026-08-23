export const meta = {
  name: 'gate-check',
  description: 'For one project, work out what is genuinely blocking its first pound',
  whenToUse:
    'When a project has been stuck at the same stage for weeks and you want the real blocker ' +
    'rather than the one written down.',
  phases: [
    { title: 'Investigate', detail: 'one agent per gate, reading the actual code' },
    { title: 'Rank', detail: 'order by what unblocks the most' },
  ],
};

/*
 * The gates in config/portfolio.ts are what a human wrote down. This workflow
 * checks each one against the repository, because the gate you think you are
 * blocked on and the gate you are actually blocked on are frequently different,
 * and the written list goes stale the moment work happens.
 */

const slug = args?.slug ?? args;
if (typeof slug !== 'string') {
  throw new Error('Pass a project slug: workflow("gate-check", { slug: "project-2" })');
}

const GATE_STATE = {
  type: 'object',
  required: ['gate', 'state', 'why'],
  properties: {
    gate: { type: 'string' },
    state: { type: 'string', enum: ['done', 'in-progress', 'not-started', 'blocked'] },
    why: { type: 'string', description: 'The file, config value or API response that shows this' },
    blockedBy: { type: 'string' },
    effortHours: { type: 'number' },
  },
};

phase('Investigate');

const pulse = await agent(
  `Read $DASHBOARD_URL/api/pulse and return the JSON entry for the project "${slug}",
   plus the gates listed for it in config/portfolio.ts. Return raw JSON only.`,
  { label: 'context', phase: 'Investigate' },
);

const gates = await agent(
  `From this context, list the gates for ${slug} as a JSON array of strings, nothing else:
   ${pulse}`,
  { label: 'gates', phase: 'Investigate', schema: { type: 'object', required: ['gates'], properties: { gates: { type: 'array', items: { type: 'string' } } } } },
);

const assessed = await parallel(
  (gates?.gates ?? []).map(
    (gate) => () =>
      agent(
        `Project ${slug} has this gate on its path to earning money:

           "${gate}"

         Work out its ACTUAL state by reading the repository — the code, the config, the
         workflow files, the live API responses. Do not trust the dashboard's own
         description of the project; that text is written by a human and goes stale.

         Be specific about evidence: name the file and the value you found. "It looks
         incomplete" is not a finding. "monetisationEnabled is false in
         config/site.config.ts:47" is.`,
        { label: `gate:${gate.slice(0, 24)}`, phase: 'Investigate', schema: GATE_STATE },
      ),
  ),
);

phase('Rank');

const open = assessed.filter(Boolean).filter((g) => g.state !== 'done');

const ranked = await agent(
  `These are the open gates blocking ${slug} from earning:

   ${JSON.stringify(open, null, 2)}

   Rank them by what to do first. The criterion is not effort and not importance in
   isolation — it is which one unblocks the most other gates per hour spent.

   Then state the single first action, concretely enough to start on today.
   If every gate is done, say that instead and say what is actually stopping the
   project earning, since something evidently is.`,
  { label: 'rank', phase: 'Rank' },
);

return { slug, gates: assessed.filter(Boolean), ranked };
