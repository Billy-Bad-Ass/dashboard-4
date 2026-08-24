/**
 * The maths behind "this agent should have reported by now".
 *
 * Every case below is anchored to a fixed `now`, because a test that computes
 * its own expectations from the same cron parser it is testing proves nothing.
 * The dates are written out longhand for the same reason.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { graceFor, nextFire, parseCron, previousFire } from '../lib/schedule.ts';
import { assessFleet, statusFor, isSilent } from '../lib/fleet.ts';
import { AGENTS, type AgentSpec } from '../config/agents.ts';
import type { AgentRun } from '../lib/heartbeat.ts';

function at(iso: string): Date {
  return new Date(iso);
}

// --------------------------------------------------------------- parsing ---

test('parses the shapes actually used in config/agents.ts', () => {
  assert.deepEqual(parseCron('0 7 * * 1')?.minutes, [0]);
  assert.deepEqual(parseCron('0 7 * * 1')?.hours, [7]);
  assert.deepEqual(parseCron('0 7 * * 1')?.daysOfWeek, [1]);

  assert.deepEqual(parseCron('30 */6 * * *')?.hours, [0, 6, 12, 18]);
  assert.deepEqual(parseCron('0 8 * * 1-5')?.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.deepEqual(parseCron('0 9 1 * *')?.daysOfMonth, [1]);
  assert.deepEqual(parseCron('15 4 * * *')?.minutes, [15]);
});

test('accepts lists, ranges with steps, and both spellings of Sunday', () => {
  assert.deepEqual(parseCron('0,30 * * * *')?.minutes, [0, 30]);
  assert.deepEqual(parseCron('0 0-12/4 * * *')?.hours, [0, 4, 8, 12]);
  // Cron takes 0 and 7 for Sunday; JavaScript only knows 0.
  assert.deepEqual(parseCron('0 0 * * 7')?.daysOfWeek, [0]);
  assert.deepEqual(parseCron('0 0 * * 0,7')?.daysOfWeek, [0]);
});

test('refuses anything it cannot read rather than guessing', () => {
  assert.equal(parseCron('@daily'), null, 'aliases are not this dialect');
  assert.equal(parseCron('0 0 * *'), null, 'four fields');
  assert.equal(parseCron('0 0 0 * * *'), null, 'six fields — a seconds column');
  assert.equal(parseCron('60 0 * * *'), null, 'minute out of range');
  assert.equal(parseCron('0 24 * * *'), null, 'hour out of range');
  assert.equal(parseCron('0 0 32 * *'), null, 'day out of range');
  assert.equal(parseCron('0 0 * * MON'), null, 'names are not supported');
  assert.equal(parseCron('0 12-4 * * *'), null, 'inverted range');
  assert.equal(parseCron('0 */0 * * *'), null, 'zero step');
  assert.equal(parseCron(''), null);
});

// ------------------------------------------------------------ the fires ----

test('previousFire finds the last six-hourly tick', () => {
  // 30 */6 → 00:30, 06:30, 12:30, 18:30.
  assert.equal(
    previousFire('30 */6 * * *', at('2026-08-24T14:28:00Z'))?.toISOString(),
    '2026-08-24T12:30:00.000Z',
  );
  // Exactly on the tick counts as fired, not as still to come.
  assert.equal(
    previousFire('30 */6 * * *', at('2026-08-24T12:30:00Z'))?.toISOString(),
    '2026-08-24T12:30:00.000Z',
  );
  // A minute before the first tick of the day walks back to yesterday.
  assert.equal(
    previousFire('30 */6 * * *', at('2026-08-24T00:29:00Z'))?.toISOString(),
    '2026-08-23T18:30:00.000Z',
  );
});

test('previousFire crosses a weekend for a weekday schedule', () => {
  // 2026-08-24 is a Monday; 2026-08-23 a Sunday, 2026-08-21 a Friday.
  assert.equal(
    previousFire('0 8 * * 1-5', at('2026-08-23T12:00:00Z'))?.toISOString(),
    '2026-08-21T08:00:00.000Z',
  );
  assert.equal(
    previousFire('0 8 * * 1-5', at('2026-08-24T09:00:00Z'))?.toISOString(),
    '2026-08-24T08:00:00.000Z',
  );
});

test('previousFire walks back a whole month for a monthly schedule', () => {
  assert.equal(
    previousFire('0 9 1 * *', at('2026-08-24T14:00:00Z'))?.toISOString(),
    '2026-08-01T09:00:00.000Z',
  );
  assert.equal(
    previousFire('0 9 1 * *', at('2026-08-01T08:59:00Z'))?.toISOString(),
    '2026-07-01T09:00:00.000Z',
  );
});

test('nextFire is strictly after now', () => {
  assert.equal(
    nextFire('30 */6 * * *', at('2026-08-24T12:30:00Z'))?.toISOString(),
    '2026-08-24T18:30:00.000Z',
  );
  // Friday afternoon → Monday morning.
  assert.equal(
    nextFire('0 8 * * 1-5', at('2026-08-21T12:00:00Z'))?.toISOString(),
    '2026-08-24T08:00:00.000Z',
  );
});

test('day-of-month and day-of-week are OR-ed when both are narrowed', () => {
  // The rule that surprises everybody: `0 0 1 * 1` fires on the 1st AND on
  // every Monday, not only on Mondays that fall on the 1st.
  const spec = '0 0 1 * 1';
  // 2026-09-08 is a Tuesday, so the last fire was Monday the 7th.
  assert.equal(previousFire(spec, at('2026-09-08T12:00:00Z'))?.toISOString(), '2026-09-07T00:00:00.000Z');
  // 2026-09-01 is a Tuesday — matched only by the day-of-month half.
  assert.equal(previousFire(spec, at('2026-09-01T12:00:00Z'))?.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('grace never exceeds half the interval between fires', () => {
  // Hourly-or-longer schedules get the full hour.
  assert.equal(graceFor('30 */6 * * *', at('2026-08-24T14:00:00Z')), 60 * 60_000);
  // A twenty-minute schedule cannot have an hour of grace, or it would never
  // be flagged at all.
  assert.equal(graceFor('*/20 * * * *', at('2026-08-24T14:00:00Z')), 10 * 60_000);
});

// ----------------------------------------------------------- the verdict ---

function agent(over: Partial<AgentSpec> = {}): AgentSpec {
  return {
    name: 'test-agent',
    scope: 'portfolio',
    repo: 'owner/repo',
    projectSlug: null,
    owns: '',
    schedule: '30 */6 * * *',
    scheduleHuman: 'Every 6 hours',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'a.yml',
    icon: 'robot',
    ...over,
  };
}

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 1,
    agent: 'test-agent',
    project_slug: null,
    trigger: 'cron',
    status: 'ok',
    started_at: '2026-08-24T12:31:00Z',
    finished_at: '2026-08-24T12:35:00Z',
    duration_ms: 240_000,
    summary: null,
    artifact_url: null,
    ...over,
  };
}

const NOW = at('2026-08-24T14:28:00Z');

test('an agent that reported since its last fire is ok', () => {
  const status = statusFor(agent(), [run()], NOW);
  assert.equal(status.state, 'ok');
  assert.equal(isSilent(status.state), false);
  assert.equal(status.lateByMs, null);
});

test('a FAILED run still counts as reporting — failing is not silence', () => {
  // This is the distinction the console was missing in the other direction:
  // a red run is a run. It shows up under failures, not under silence.
  const status = statusFor(agent(), [run({ status: 'failed' })], NOW);
  assert.equal(status.state, 'ok');
});

test('an agent that has never reported is a finding, not a dash', () => {
  const status = statusFor(agent(), [], NOW);
  assert.equal(status.state, 'never');
  assert.equal(isSilent(status.state), true);
  assert.equal(status.dueAt?.toISOString(), '2026-08-24T12:30:00.000Z');
  // ~2 hours late.
  assert.ok(status.lateByMs !== null && status.lateByMs > 60 * 60_000);
});

test('an agent that used to report and went quiet is overdue, not never', () => {
  // The last run predates the fire it should have reported.
  const status = statusFor(agent(), [run({ started_at: '2026-08-23T18:31:00Z' })], NOW);
  assert.equal(status.state, 'overdue');
  assert.equal(status.last?.started_at, '2026-08-23T18:31:00Z');
});

test('a fire inside the grace period is not yet late', () => {
  // 12:30 fire, checked at 13:00 — half an hour in, grace is an hour.
  const status = statusFor(agent(), [], at('2026-08-24T13:00:00Z'));
  assert.equal(status.state, 'ok');
});

test('a start with no finish is stalled, not running', () => {
  // Exactly the spend-auditor row: queued, and nothing ever closed it out.
  const status = statusFor(
    agent({ name: 'spend-auditor', schedule: '0 9 1 * *' }),
    [run({ agent: 'spend-auditor', status: 'queued', finished_at: null, duration_ms: null, started_at: '2026-08-01T09:01:00Z' })],
    NOW,
  );
  assert.equal(status.state, 'stalled');
  assert.equal(isSilent(status.state), true);
});

test('a queued run posted minutes ago is still in flight', () => {
  const status = statusFor(
    agent(),
    [run({ status: 'queued', finished_at: null, started_at: '2026-08-24T14:20:00Z' })],
    NOW,
  );
  assert.equal(status.state, 'ok');
});

test('an event-triggered agent is never overdue', () => {
  const status = statusFor(agent({ schedule: null, trigger: 'github' }), [], NOW);
  assert.equal(status.state, 'unscheduled');
  assert.equal(isSilent(status.state), false);
  assert.equal(status.dueAt, null);
});

test('an unreadable schedule says so instead of passing silently', () => {
  const status = statusFor(agent({ schedule: '@hourly' }), [], NOW);
  assert.equal(status.state, 'unreadable');
  // Not counted as silence: the fault is the registry, not the agent.
  assert.equal(isSilent(status.state), false);
});

test('runs belonging to another agent do not count as this one reporting', () => {
  const status = statusFor(agent(), [run({ agent: 'somebody-else' })], NOW);
  assert.equal(status.state, 'never');
});

// ------------------------------------------------------------ the fleet ----

test('assessFleet counts silence separately from failure', () => {
  const summary = assessFleet([], NOW, [
    agent({ name: 'a' }),
    agent({ name: 'b' }),
    agent({ name: 'c', schedule: null }),
  ]);
  assert.equal(summary.scheduled, 2);
  assert.equal(summary.reporting, 0);
  assert.equal(summary.silent, 2);
  assert.equal(summary.failures, 0, 'nothing ran, so nothing failed — and that is not reassuring');
  assert.equal(summary.worst?.agent.name !== undefined, true);
});

test('assessFleet sorts the worst first', () => {
  const summary = assessFleet(
    [run({ agent: 'reporting' })],
    NOW,
    [agent({ name: 'reporting' }), agent({ name: 'quiet' })],
  );
  assert.equal(summary.statuses[0]?.agent.name, 'quiet');
  assert.equal(summary.statuses[0]?.state, 'never');
  assert.equal(summary.reporting, 1);
  assert.equal(summary.silent, 1);
});

test('the real fleet is entirely readable', () => {
  // Guards the registry itself: a typo'd cron would otherwise show up as a
  // grey "cannot be checked" badge that is easy to scroll past.
  for (const spec of AGENTS) {
    if (spec.schedule === null) continue;
    assert.notEqual(parseCron(spec.schedule), null, `${spec.name}: ${spec.schedule}`);
  }
});

test('every registered agent has somewhere to be looked at', () => {
  for (const spec of AGENTS) {
    assert.ok(spec.workflow.length > 0, `${spec.name} has no defining file`);
    assert.ok(
      spec.platform === 'github-actions' || spec.platform === 'cloudflare-cron',
      `${spec.name} has an unknown platform`,
    );
    // A Worker cron has no Actions page, so the console must not build one.
    if (spec.platform === 'cloudflare-cron') {
      assert.ok(!spec.workflow.endsWith('.yml'), `${spec.name} is not a workflow file`);
    }
  }
});
