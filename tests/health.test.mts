import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHealth } from '../lib/heartbeat.ts';
import type { Project, Stage } from '../config/portfolio.ts';
import type { RepoPulse } from '../lib/connectors/github.ts';
import type { ProjectFinance } from '../lib/finance.ts';

function project(stage: Stage): Project {
  return {
    slug: 'p',
    name: 'P',
    tagline: '',
    repo: 'owner/p',
    stage,
    revenueModel: 'none',
    accent: '#000',
    icon: 'bolt',
    startedOn: '2026-01-01',
    vitals: [],
    gates: [],
    reality: '',
  };
}

function repo(daysAgo: number | null, ciStatus: string | null = 'success'): RepoPulse {
  return {
    repo: 'owner/p',
    exists: true,
    defaultBranch: 'main',
    commitCount: daysAgo === null ? 0 : 5,
    lastCommitAt:
      daysAgo === null ? null : new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    lastCommitMessage: 'work',
    openIssues: 0,
    openPulls: 0,
    ciStatus,
    ciUrl: null,
    sizeKb: 100,
    language: 'TypeScript',
    pushedAt: null,
  };
}

function finance(netPence = 0): ProjectFinance {
  return {
    slug: 'p',
    directSpendPence: 0,
    overheadPence: 0,
    spentPence: 0,
    grossPence: netPence,
    refundedPence: 0,
    feesPence: 0,
    netPence,
    profitPence: netPence,
    roi: null,
    daysToFirstRevenue: null,
  };
}

test('an unstarted project is idle, not unhealthy', () => {
  // Judging an idea by its commit cadence paints a red light on a slot that is
  // red by definition, and a dashboard where everything is red gets ignored.
  const { health, reason } = assessHealth(project('idea'), null, finance());
  assert.equal(health, 'idle');
  assert.match(reason, /Not started/);
});

test('a paused project is idle', () => {
  assert.equal(assessHealth(project('paused'), repo(0), finance()).health, 'idle');
});

test('recent commits and green CI is healthy', () => {
  const { health } = assessHealth(project('building'), repo(2), finance());
  assert.equal(health, 'good');
});

test('red CI is stalled regardless of commit freshness', () => {
  const { health, reason } = assessHealth(project('building'), repo(0, 'failure'), finance());
  assert.equal(health, 'stalled');
  assert.match(reason, /CI is red/);
});

test('a week without commits is a watch, three weeks is stalled', () => {
  assert.equal(assessHealth(project('building'), repo(10), finance()).health, 'watch');
  assert.equal(assessHealth(project('building'), repo(25), finance()).health, 'stalled');
});

test('no commits at all in the window is stalled', () => {
  const { health, reason } = assessHealth(project('building'), repo(null), finance());
  assert.equal(health, 'stalled');
  assert.match(reason, /No commits/);
});

test('an unreadable repository is a watch, not a false green', () => {
  const { health, reason } = assessHealth(project('building'), null, finance());
  assert.equal(health, 'watch');
  assert.match(reason, /not readable/);
});

test('a project marked earning with no net revenue is flagged', () => {
  // "Earning" is a claim in config. If the money says otherwise, the config is
  // wrong and that is worth surfacing rather than trusting.
  const { health, reason } = assessHealth(project('earning'), repo(1), finance(0));
  assert.equal(health, 'watch');
  assert.match(reason, /not positive/);

  assert.equal(assessHealth(project('earning'), repo(1), finance(5000)).health, 'good');
});
