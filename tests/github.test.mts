import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCi, type WorkflowRun } from '../lib/connectors/github.ts';

/**
 * These exist because of a real morning. BBA Network Store showed red under
 * the verdict "CI is red on the default branch" while CI was green — the
 * connector asked GitHub for the newest run in the whole repository, and on a
 * Monday that is a scheduled agent job, not a build. Every case below is a
 * shape that used to produce the wrong colour.
 */

let nextId = 1;

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  const id = nextId++;
  return {
    workflow_id: 100,
    name: 'CI',
    head_sha: 'aaa',
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    ...over,
  };
}

test('a branch whose head commit built clean is green', () => {
  const verdict = assessCi([run(), run({ head_sha: 'old', conclusion: 'failure' })]);
  assert.equal(verdict.status, 'success');
  assert.equal(verdict.workflow, 'CI');
});

test('one failing workflow makes the commit red, whichever finished last', () => {
  // GitHub returns newest first. The green run arriving after the red one does
  // not repair it — they built the same commit.
  const verdict = assessCi([
    run({ workflow_id: 200, name: 'Lint' }),
    run({ workflow_id: 100, name: 'Build, test and generate PDFs', conclusion: 'failure' }),
  ]);
  assert.equal(verdict.status, 'failure');
  assert.equal(verdict.workflow, 'Build, test and generate PDFs');
});

test('a red run at an older commit does not outlive the push that fixed it', () => {
  const verdict = assessCi([run({ head_sha: 'new' }), run({ head_sha: 'old', conclusion: 'failure' })]);
  assert.equal(verdict.status, 'success');
});

test('a re-run supersedes the attempt it replaces', () => {
  // Same workflow, same commit, newest first. The author re-ran it for a
  // reason, and the earlier result no longer stands.
  const verdict = assessCi([run({ conclusion: 'success' }), run({ conclusion: 'failure' })]);
  assert.equal(verdict.status, 'success');
});

test('a conclusion is reported as GitHub gave it, not flattened to failure', () => {
  // `timed_out` is red enough to pick this run over its green siblings, but
  // "timed out" and "failed" send you to different places, so the dashboard
  // gets the real word.
  const verdict = assessCi([run({ workflow_id: 200 }), run({ conclusion: 'timed_out' })]);
  assert.equal(verdict.status, 'timed_out');
});

test('a build still running reports as running, not as its last colour', () => {
  const verdict = assessCi([run({ status: 'in_progress', conclusion: null })]);
  assert.equal(verdict.status, 'in_progress');
});

test('no runs is null — unknown, and never green by default', () => {
  // A branch nothing has ever built is not a passing branch. Same rule as
  // every other unreported number on this dashboard.
  for (const empty of [[], null, undefined]) {
    const verdict = assessCi(empty);
    assert.equal(verdict.status, null);
    assert.equal(verdict.url, null);
    assert.equal(verdict.workflow, null);
  }
});

test('the reported url points at the run that decided the verdict', () => {
  const red = run({ conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/red' });
  const verdict = assessCi([run({ workflow_id: 200 }), red]);
  assert.equal(verdict.url, 'https://github.com/o/r/actions/runs/red');
});
