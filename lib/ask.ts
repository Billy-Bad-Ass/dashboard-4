/**
 * "Ask the dashboard" — a chat interface over the portfolio's own data.
 *
 * The model does not get a dump of the database in its context. It gets tools,
 * and pulls what it needs. That matters for two reasons: the whole ledger and
 * CRM would be a lot of tokens on every turn, and more importantly a model
 * answering "what did I spend on infra in March" should run the actual query
 * rather than eyeball a JSON blob and approximate.
 *
 * The house rules from CLAUDE.md are in the system prompt, because they are
 * exactly the ways an assistant gets this domain wrong: reporting pence as
 * pounds, and turning "nothing reported this" into "zero".
 */

import Anthropic from '@anthropic-ai/sdk';
import { cfEnv, query } from './db';
import { pulse } from './heartbeat';
import { PROJECTS } from '@/config/portfolio';
import { AGENTS } from '@/config/agents';

/** Streamed back to the browser, one JSON object per SSE event. */
export type AskEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Which model answers questions.
 *
 * Opus 5 by default because a wrong answer about money is expensive in a way
 * that a slightly cheaper token price does not offset. But this is a
 * pre-revenue business paying for its own API credits, so it is a setting
 * rather than a constant: set ASK_MODEL to `claude-haiku-4-5` and the same
 * questions cost roughly a fifth as much, at some cost in judgement on the
 * harder ones. docs/IPAD.md has the actual numbers.
 */
const DEFAULT_MODEL = 'claude-opus-5';

function model(): string {
  return cfEnv()?.ASK_MODEL ?? process.env.ASK_MODEL ?? DEFAULT_MODEL;
}

/**
 * Tables the SQL tool may read. An allow-list rather than a deny-list: a new
 * table added by a migration should have to be opted in, not opted out.
 */
const READABLE_TABLES = [
  'spend',
  'revenue',
  'clients',
  'deals',
  'interactions',
  'metrics',
  'agent_runs',
  'calendar_events',
  'heartbeats',
  'settings',
];

const SCHEMA_NOTE = `
Tables you can query (SQLite / Cloudflare D1):

  spend(id, project_slug, incurred_on, amount_pence, currency, category, vendor,
        note, recurrence, ended_on, created_at)
    - project_slug is NULL for portfolio-wide overhead.
    - recurrence is 'once' | 'monthly' | 'yearly'. A monthly row is ONE row that
      recurs; it is not repeated per month. ended_on NULL means still running.
      So SUM(amount_pence) over spend is NOT total spend for recurring rows —
      use the get_finance tool for totals, which expands recurrence properly.

  revenue(id, project_slug, received_on, gross_pence, fees_pence, refunded_pence,
          currency, source, external_id, description, client_id)
    - net = gross_pence - refunded_pence - fees_pence

  clients(id, name, company, email, phone, website, status, project_slug, source,
          heat, notes, last_contact_on, next_action, next_action_on, created_at, updated_at)
    - status: prospect | contacted | engaged | current | dormant | lost
    - heat is 1 (cold) to 5 (about to sign)

  deals(id, client_id, project_slug, title, value_pence, currency, stage,
        probability, expected_on, closed_on, notes)
    - stage: lead | qualified | proposal | won | lost

  interactions(id, client_id, occurred_on, kind, summary)
  metrics(id, project_slug, metric_key, value_num, captured_at, source)
  agent_runs(id, agent, project_slug, trigger, status, started_at, finished_at,
             duration_ms, summary, artifact_url)
  calendar_events(uid, summary, starts_at, ends_at, all_day, location,
                  description, project_slug, synced_at)
  heartbeats(id, connector, status, latency_ms, detail, checked_at)
  settings(key, value)

Dates are ISO-8601 strings, so string comparison sorts correctly:
  WHERE incurred_on >= '2026-08-01'
`.trim();

function systemPrompt(): string {
  const projects = PROJECTS.map(
    (p) => `  ${p.slug} — ${p.name}: ${p.stage}, ${p.revenueModel}. ${p.tagline}`,
  ).join('\n');

  return `You are the BBA Network heartbeat dashboard, answering questions about this
business from its own live data. The person asking is Billy, who owns it.

The portfolio:
${projects}

Agents that run automatically: ${AGENTS.map((a) => a.name).join(', ')}.

${SCHEMA_NOTE}

# How to answer

Look things up before answering. You have tools; use them rather than reasoning
from what you remember of the schema. If a question needs a number, get the
number.

Be direct and short. This is a dashboard, not an essay — two or three sentences
for a simple question. Lead with the answer, then the supporting figure. No
preamble, no "Great question", no restating what was asked.

# Rules that are not negotiable

**Money is stored in integer pence. Always convert for display.** \`500\` is £5.00,
\`1400\` is £14.00. Divide by 100 and write it with a £ and two decimals. Reporting
a pence value as pounds is a 100x error, and it is the single easiest way to
give catastrophically wrong advice here.

**Unknown is not zero.** If a connector is unconfigured or a metric has never
been captured, the answer is "nothing has reported that yet" — not "zero". Say
which one it is. A tool returning null means unreported; a tool returning 0
means measured and genuinely zero.

**Never invent a number.** If you cannot look something up, say so and say what
would need connecting. A plausible-sounding invented figure on a business
dashboard is worse than a blank, because it gets acted on.

**This portfolio currently earns nothing.** That is the true state, not a bug and
not a gap in your data. Do not soften it, do not pad it with encouragement, and
do not treat zero revenue as an anomaly to explain away. If asked how things are
going, the honest answer involves spend, burn and whether anything is being
built.

**You can only read.** You cannot add spend, edit a client, refund a payment or
move a calendar entry. If asked to change something, say which page of the
dashboard does it: /finance records spend, /clients edits the CRM, and money
movements happen in Stripe by a human.`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pulse',
    description:
      'The whole current dashboard state in one call: per-project health and vitals, ' +
      'connector status, finance totals, pipeline summary, recent agent runs and upcoming ' +
      'calendar events. Start here for any broad question ("how are we doing", "what is wrong"). ' +
      'All money fields are integer pence.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'get_finance',
    description:
      'Authoritative money totals: spend, revenue, ROI and burn, per project and for the ' +
      'portfolio. Use this rather than summing the spend table yourself — it expands recurring ' +
      'subscriptions into their actual occurrences and apportions portfolio overhead, which raw ' +
      'SQL over `spend` does not. All amounts are integer pence.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'run_sql',
    description:
      'Run one read-only SELECT against the dashboard database for anything the other tools ' +
      'do not cover — filtering, grouping, counting, date ranges. SELECT only; a LIMIT is ' +
      'applied automatically. Money columns come back as integer pence.',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A single SELECT statement. No semicolon needed.',
        },
        why: {
          type: 'string',
          description: 'Short note on what this answers, shown to the user as progress.',
        },
      },
      required: ['sql', 'why'],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * Guard the SQL tool.
 *
 * The person asking owns this data, so the threat model is not exfiltration —
 * it is a mistake, or a client note containing text shaped like an instruction.
 * Read-only and single-statement bounds both: the worst outcome of a bad query
 * is an error message.
 */
export function validateSql(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const sql = raw.trim().replace(/;+\s*$/, '');

  if (!/^select\s/i.test(sql)) return { ok: false, reason: 'Only SELECT statements are allowed.' };
  // A semicolon left after trailing ones were stripped means a second statement.
  if (sql.includes(';')) return { ok: false, reason: 'Only one statement at a time.' };

  const banned = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum)\b/i;
  const match = banned.exec(sql);
  if (match) return { ok: false, reason: `\`${match[1]}\` is not allowed — reads only.` };

  // Every identifier that looks like a table reference must be on the allow-list.
  const referenced = [...sql.matchAll(/\b(?:from|join)\s+["'`]?([a-z_][a-z0-9_]*)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
  const forbidden = referenced.find((t) => !READABLE_TABLES.includes(t));
  if (forbidden) return { ok: false, reason: `No table \`${forbidden}\`. Readable: ${READABLE_TABLES.join(', ')}.` };

  const limited = /\blimit\s+\d+/i.test(sql) ? sql : `${sql} LIMIT 200`;
  return { ok: true, sql: limited };
}

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_pulse': {
      const snapshot = await pulse();
      // Trim the parts that are large and rarely load-bearing in an answer.
      return JSON.stringify({
        generatedAt: snapshot.generatedAt,
        databaseConnected: snapshot.configured,
        lastCronMinutes: snapshot.lastCronMinutes,
        connectors: snapshot.connectors,
        finance: { ...snapshot.finance, byProject: snapshot.finance.byProject },
        pipeline: {
          ...snapshot.pipeline,
          goingCold: snapshot.pipeline.goingCold.map((c) => c.name),
          dueActions: snapshot.pipeline.dueActions.map((c) => `${c.name}: ${c.next_action}`),
        },
        projects: snapshot.projects.map((p) => ({
          slug: p.project.slug,
          name: p.project.name,
          stage: p.project.stage,
          revenueModel: p.project.revenueModel,
          reality: p.project.reality,
          gates: p.project.gates,
          health: p.health,
          healthReason: p.healthReason,
          vitals: p.vitals,
          finance: p.finance,
          repo: p.repo,
        })),
        agentRuns: snapshot.agentRuns,
        upcomingEvents: snapshot.events.slice(0, 10),
      });
    }

    case 'get_finance': {
      const snapshot = await pulse();
      return JSON.stringify({
        note: 'All amounts are integer pence. Divide by 100 for pounds.',
        ...snapshot.finance,
      });
    }

    case 'run_sql': {
      const check = validateSql(String(input.sql ?? ''));
      if (!check.ok) return JSON.stringify({ error: check.reason });
      try {
        const rows = await query(check.sql);
        return JSON.stringify({
          rowCount: rows.length,
          note:
            rows.length === 0
              ? 'No rows. That means the query matched nothing — it does not mean zero.'
              : 'Money columns are integer pence.',
          rows,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    default:
      return JSON.stringify({ error: `No tool called ${name}.` });
  }
}

function client(): Anthropic | null {
  const key = cfEnv()?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key, maxRetries: 2 });
}

/** How many tool round-trips before we stop. Bounds cost on a runaway question. */
const MAX_TURNS = 8;

export async function* askStream(history: AskMessage[]): AsyncGenerator<AskEvent> {
  const anthropic = client();
  if (!anthropic) {
    yield {
      type: 'error',
      message:
        'No ANTHROPIC_API_KEY. Add it under Cloudflare \u2192 Workers & Pages \u2192 ' +
        'bba-heartbeat \u2192 Settings \u2192 Variables and Secrets, then redeploy. Note this ' +
        'needs Claude API credits from platform.claude.com \u2014 a Pro or Max subscription ' +
        'covers the Claude app, not the API.',
    };
    return;
  }

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const stream = anthropic.messages.stream({
        model: model(),
        max_tokens: 16000,
        // Summarised thinking is shown in the UI: on a money question, seeing
        // which figures it is reconciling is most of the trust.
        thinking: { type: 'adaptive', display: 'summarized' },
        system: [
          {
            type: 'text',
            text: systemPrompt(),
            // The system prompt and tool list are byte-stable across turns, so
            // a cache breakpoint here is read on every follow-up question.
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: TOOLS,
        messages,
      });

      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (event.delta.type === 'thinking_delta') {
          yield { type: 'thinking', text: event.delta.thinking };
        }
      }

      const response = await stream.finalMessage();
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        yield { type: 'done' };
        return;
      }

      const calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      // Run them concurrently and return every result in ONE user message —
      // splitting them across messages trains the model out of parallel calls.
      const results = await Promise.all(
        calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
          const input = (call.input ?? {}) as Record<string, unknown>;
          try {
            return {
              type: 'tool_result',
              tool_use_id: call.id,
              content: await runTool(call.name, input),
            };
          } catch (error) {
            return {
              type: 'tool_result',
              tool_use_id: call.id,
              content: error instanceof Error ? error.message : String(error),
              is_error: true,
            };
          }
        }),
      );

      // Progress lines are emitted after the batch resolves rather than before
      // it: a generator cannot yield from inside the Promise.all callbacks, and
      // the tools here return fast enough that the ordering is not worth
      // restructuring the loop for.
      for (const call of calls) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        yield {
          type: 'tool',
          name: call.name,
          detail: typeof input.why === 'string' ? input.why : describeTool(call.name),
        };
      }

      messages.push({ role: 'user', content: results });
    }

    yield {
      type: 'error',
      message: `Gave up after ${MAX_TURNS} rounds of lookups. Try a narrower question.`,
    };
  } catch (error) {
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function describeTool(name: string): string {
  return (
    {
      get_pulse: 'Reading the live dashboard state',
      get_finance: 'Working out the money',
      run_sql: 'Querying the database',
    }[name] ?? name
  );
}
