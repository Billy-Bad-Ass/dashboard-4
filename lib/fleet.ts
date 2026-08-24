/**
 * The fleet's actual state, as opposed to the fleet's registered state.
 *
 * `config/agents.ts` says what should run. `agent_runs` says what reported.
 * This module is the difference between the two, which is where every finding
 * the console was missing lives:
 *
 *   - an agent that has never reported once
 *   - an agent that used to report and has gone quiet
 *   - a run that posted a start and never posted a finish
 *
 * None of those is a failure, so a console counting failures showed zero and
 * called it "Nothing failing". The distinction that matters on this dashboard
 * is not passing versus failing — it is *heard from* versus *not heard from*,
 * and the second one has to read as loudly as the first.
 */

import { AGENTS, type AgentSpec } from '@/config/agents';
import type { AgentRun } from './heartbeat';
import { graceFor, nextFire, previousFire, STALLED_AFTER_MS } from './schedule';

export type FleetState =
  /** Reported at or since its last scheduled fire. */
  | 'ok'
  /** Ran before, but nothing since the fire it should have reported. */
  | 'overdue'
  /** Scheduled, and no run has ever been recorded. */
  | 'never'
  /** A start posted; no finish ever did. */
  | 'stalled'
  /** Event-triggered. There is no schedule to be late for. */
  | 'unscheduled'
  /** The registered cron expression could not be read. */
  | 'unreadable';

/** Worst first. Drives both the ordering and which state wins a tie. */
const SEVERITY: Record<FleetState, number> = {
  never: 0,
  overdue: 1,
  stalled: 2,
  unreadable: 3,
  ok: 4,
  unscheduled: 5,
};

/** States that are a finding rather than a fact. */
const SILENT: FleetState[] = ['never', 'overdue', 'stalled'];

export interface FleetStatus {
  agent: AgentSpec;
  state: FleetState;
  /** The most recent run for this agent, or null if there has never been one. */
  last: AgentRun | null;
  /** When the schedule should last have fired. Null when there is no schedule. */
  dueAt: Date | null;
  /** When it fires next. Null when there is no schedule. */
  nextAt: Date | null;
  /** How long past its due time, in ms. Null unless overdue or never. */
  lateByMs: number | null;
  /** One sentence saying what is true, for the row and the tile foot. */
  detail: string;
}

export interface FleetSummary {
  statuses: FleetStatus[];
  /** Every agent carrying a schedule. */
  scheduled: number;
  /** Scheduled agents that have reported since their last fire. */
  reporting: number;
  /** Scheduled agents that are overdue, never-run, or stalled. */
  silent: number;
  /** Failed runs inside the recorded window. */
  failures: number;
  /** The worst silent agent, for the headline. Null when the fleet is quiet-clean. */
  worst: FleetStatus | null;
}

export function isSilent(state: FleetState): boolean {
  return SILENT.includes(state);
}

/**
 * Classify one agent against the runs it has recorded.
 *
 * `runs` may be the whole table; only this agent's rows are read, newest
 * first, which is the order `pulse()` and the API already return.
 */
export function statusFor(agent: AgentSpec, runs: AgentRun[], now: Date = new Date()): FleetStatus {
  const mine = runs.filter((run) => run.agent === agent.name);
  const last = mine[0] ?? null;

  if (agent.schedule === null) {
    return {
      agent,
      state: 'unscheduled',
      last,
      dueAt: null,
      nextAt: null,
      lateByMs: null,
      detail: last
        ? 'Event-triggered. It has fired before.'
        : 'Event-triggered — nothing to be late for.',
    };
  }

  const dueAt = previousFire(agent.schedule, now);
  const nextAt = nextFire(agent.schedule, now);

  if (!dueAt) {
    return {
      agent,
      state: 'unreadable',
      last,
      dueAt: null,
      nextAt,
      lateByMs: null,
      detail: `The registered schedule \`${agent.schedule}\` could not be read, so this agent cannot be checked for lateness.`,
    };
  }

  const lateByMs = now.getTime() - dueAt.getTime();
  const grace = graceFor(agent.schedule, now);
  const withinGrace = lateByMs <= grace;

  // Anything reported at or after the last fire means the schedule is alive,
  // whatever the run's outcome — a failed run is still a run that reported.
  const reportedSinceDue = mine.some((run) => new Date(run.started_at).getTime() >= dueAt.getTime());

  if (reportedSinceDue || withinGrace) {
    const stalled =
      last !== null &&
      !isTerminal(last) &&
      now.getTime() - new Date(last.started_at).getTime() > STALLED_AFTER_MS;

    if (stalled && last) {
      return {
        agent,
        state: 'stalled',
        last,
        dueAt,
        nextAt,
        lateByMs: null,
        detail: `A run posted \`${last.status}\` and never posted a finish. It is not running — nothing has closed it out.`,
      };
    }

    return {
      agent,
      state: 'ok',
      last,
      dueAt,
      nextAt,
      lateByMs: null,
      detail: last
        ? `Reported since its last scheduled fire.`
        : `Due now — inside the grace period, so not yet late.`,
    };
  }

  const state: FleetState = last === null ? 'never' : 'overdue';

  return {
    agent,
    state,
    last,
    dueAt,
    nextAt,
    lateByMs,
    detail:
      state === 'never'
        ? `${agent.scheduleHuman}, and no run has ever been recorded. The schedule last fired at ${iso(dueAt)}.`
        : `Silent since its last run. It should have reported at ${iso(dueAt)}.`,
  };
}

/** The whole fleet, worst first. */
export function assessFleet(
  runs: AgentRun[],
  now: Date = new Date(),
  agents: AgentSpec[] = AGENTS,
): FleetSummary {
  const statuses = agents
    .map((agent) => statusFor(agent, runs, now))
    .sort(
      (a, b) =>
        SEVERITY[a.state] - SEVERITY[b.state] || (b.lateByMs ?? 0) - (a.lateByMs ?? 0),
    );

  const scheduled = statuses.filter((s) => s.agent.schedule !== null);
  const silent = scheduled.filter((s) => isSilent(s.state));

  return {
    statuses,
    scheduled: scheduled.length,
    reporting: scheduled.filter((s) => s.state === 'ok').length,
    silent: silent.length,
    failures: runs.filter((run) => run.status === 'failed').length,
    worst: silent[0] ?? null,
  };
}

function isTerminal(run: AgentRun): boolean {
  return run.status === 'ok' || run.status === 'failed' || run.status === 'skipped';
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
