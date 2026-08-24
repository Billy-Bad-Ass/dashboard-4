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
  /** Its fire has passed but the grace period has not. Not late yet. */
  | 'due'
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
  due: 4,
  ok: 5,
  unscheduled: 6,
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
  /**
   * How long this agent has been quiet, in ms — time since its last run, or
   * since its missed fire when there has never been one. Null when it is not
   * a finding. This, not severity, is what "longest silent" means.
   */
  silentForMs: number | null;
  /** One sentence saying what is true, for the row and the tile foot. */
  detail: string;
}

export interface FleetSummary {
  statuses: FleetStatus[];
  /** Every agent carrying a schedule. */
  scheduled: number;
  /** Scheduled agents that have reported since their last fire. */
  reporting: number;
  /** Scheduled agents whose fire has passed but whose grace has not. */
  due: number;
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
  // Sorted here rather than trusted from the caller. SQL tie-breaking on equal
  // `started_at` is not defined by the query, and agent-portfolio-review.yml
  // posts its `running` row and its terminal row with the identical stamp — so
  // picking whichever came back first would flip a healthy weekly agent to
  // `stalled` an hour after every successful review.
  const mine = runs
    .filter((run) => run.agent === agent.name)
    .sort((a, b) => cmp(a.started_at, b.started_at) || b.id - a.id);
  const last = mine[0] ?? null;

  if (agent.schedule === null) {
    return {
      agent,
      state: 'unscheduled',
      last,
      dueAt: null,
      nextAt: null,
      lateByMs: null,
      silentForMs: null,
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
      silentForMs: null,
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
        silentForMs: now.getTime() - new Date(last.started_at).getTime(),
        detail: `A run posted \`${last.status}\` and never posted a finish. It is not running — nothing has closed it out.`,
      };
    }

    // Inside the grace window but nothing has reported for THIS fire yet. It is
    // not late, and it is also not evidence that anything is working, so it
    // does not count towards "reporting" — that tile going up on the strength
    // of a fire that has not been answered would be the same false comfort
    // this module exists to remove.
    if (!reportedSinceDue) {
      return {
        agent,
        state: 'due',
        last,
        dueAt,
        nextAt,
        lateByMs: null,
        silentForMs: null,
        detail: `Due at ${iso(dueAt)} and not reported yet — still inside the grace period, so not late.`,
      };
    }

    return {
      agent,
      state: 'ok',
      last,
      dueAt,
      nextAt,
      lateByMs: null,
      silentForMs: null,
      detail: 'Reported since its last scheduled fire.',
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
    silentForMs:
      last === null ? lateByMs : now.getTime() - new Date(last.started_at).getTime(),
    detail:
      state === 'never'
        ? `${agent.scheduleHuman}, and no run has ever been recorded. The schedule last fired at ${iso(dueAt)}.`
        : `Silent since its last run. It should have reported at ${iso(dueAt)}.`,
  };
}

function cmp(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
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

  // `statuses` is sorted by severity for display. "Longest silent" is a
  // different question and needs its own ordering, or a two-hour `never`
  // outranks a six-day `overdue` and the headline quotes the shorter silence.
  const longest = [...silent].sort((a, b) => (b.silentForMs ?? 0) - (a.silentForMs ?? 0));

  return {
    statuses,
    scheduled: scheduled.length,
    reporting: scheduled.filter((s) => s.state === 'ok').length,
    due: scheduled.filter((s) => s.state === 'due').length,
    silent: silent.length,
    failures: runs.filter((run) => run.status === 'failed').length,
    worst: longest[0] ?? null,
  };
}

function isTerminal(run: AgentRun): boolean {
  return run.status === 'ok' || run.status === 'failed' || run.status === 'skipped';
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
