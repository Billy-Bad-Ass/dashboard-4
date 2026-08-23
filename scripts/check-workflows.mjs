/**
 * Validates .claude/workflows/*.mjs before they are committed.
 *
 * Workflow scripts run as an async function body with `agent`, `parallel`,
 * `pipeline`, `phase`, `log`, `args`, `budget` and `workflow` injected. They
 * have no filesystem or Node API access, and `Date.now()`, `Math.random()` and
 * argless `new Date()` throw at runtime because they would break resume.
 *
 * Catching all of that here means a broken workflow fails at commit time rather
 * than twenty minutes into a scheduled run.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = '.claude/workflows';

const BANNED = [
  [/\bDate\.now\s*\(/, 'Date.now() throws in a workflow — pass timestamps in via args'],
  [/\bMath\.random\s*\(/, 'Math.random() throws in a workflow — vary the prompt by index instead'],
  [/\bnew\s+Date\s*\(\s*\)/, 'argless new Date() throws in a workflow — pass the date via args'],
  [/\brequire\s*\(/, 'no CommonJS require in a workflow'],
  [/from\s+['"]node:/, 'no Node built-ins in a workflow — there is no filesystem access'],
  [/\bprocess\.\w/, 'no process access in a workflow'],
];

const problems = [];
let checked = 0;

let files;
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith('.mjs'));
} catch {
  console.log(`No ${DIR} directory — nothing to check.`);
  process.exit(0);
}

for (const file of files) {
  const path = join(DIR, file);
  const source = await readFile(path, 'utf8');
  checked += 1;

  if (!/export\s+const\s+meta\s*=\s*\{/.test(source)) {
    problems.push(`${path}: must start with \`export const meta = { ... }\``);
  }

  for (const [pattern, message] of BANNED) {
    // Strip comments first, so documenting a rule does not trip it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (pattern.test(code)) problems.push(`${path}: ${message}`);
  }

  // A workflow that never calls agent() is not a workflow.
  if (!/\bagent\s*\(/.test(source)) {
    problems.push(`${path}: calls no agent() — this does not need to be a workflow`);
  }

  // Parse check. The body is wrapped the way the runtime wraps it, so a
  // top-level await is legal here exactly as it is there.
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (async () => { ${stripMeta(source)} })`);
  } catch (error) {
    problems.push(`${path}: syntax error — ${error.message}`);
  }
}

function stripMeta(source) {
  // The runtime evaluates meta separately; a bare `export` inside a function
  // body is a syntax error, so remove the statement before parse-checking.
  return source.replace(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\};?/, '');
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(`${checked} workflow(s) OK.`);
