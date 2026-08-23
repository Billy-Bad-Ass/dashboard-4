/**
 * Where the agent fleet reports in.
 *
 * Scheduled GitHub Actions POST here at the start and end of a run, which is
 * what turns .github/workflows from "files that claim to run" into an
 * orchestration console that shows what actually happened. See
 * docs/AGENTS.md for the contract.
 */

import { execute, query } from '@/lib/db';
import { authorised, badRequest, json, oneOf, readJson, serverError, unauthorised } from '@/lib/api';
import { isoStamp } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const STATUSES = ['queued', 'running', 'ok', 'failed', 'skipped'] as const;
const TRIGGERS = ['cron', 'manual', 'github', 'webhook'] as const;

export async function GET() {
  try {
    return json(await query('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 200'));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  const body = await readJson(request);
  if (!body) return badRequest('Body must be JSON.');

  const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
  if (!agent) return badRequest('agent is required.');

  const status = oneOf(body.status, STATUSES, 'ok');
  const startedAt = typeof body.started_at === 'string' ? body.started_at : isoStamp();
  // A terminal status with no finish time is a run that will look stuck
  // forever, so one is filled in rather than left null.
  const finishedAt =
    typeof body.finished_at === 'string'
      ? body.finished_at
      : status === 'ok' || status === 'failed' || status === 'skipped'
        ? isoStamp()
        : null;

  try {
    const result = await execute(
      `INSERT INTO agent_runs (agent, project_slug, trigger, status, started_at, finished_at, duration_ms, summary, artifact_url)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        agent,
        typeof body.project_slug === 'string' ? body.project_slug : null,
        oneOf(body.trigger, TRIGGERS, 'manual'),
        status,
        startedAt,
        finishedAt,
        typeof body.duration_ms === 'number'
          ? body.duration_ms
          : finishedAt
            ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
            : null,
        typeof body.summary === 'string' ? body.summary.slice(0, 2000) : null,
        typeof body.artifact_url === 'string' ? body.artifact_url : null,
      ],
    );
    return json({ id: Number(result.meta.last_row_id) }, 201);
  } catch (error) {
    return serverError(error);
  }
}
