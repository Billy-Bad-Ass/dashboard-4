/**
 * Module resolution hook for the test run.
 *
 * Node 22 strips TypeScript types natively, so tests import lib/*.ts directly
 * with no build step. What it does NOT do is resolve the two things the app
 * source relies on, because both are bundler conventions rather than Node ones:
 *
 *   import { getDb } from './db'          — extensionless, needs './db.ts'
 *   import { PROJECTS } from '@/config/…' — the tsconfig path alias
 *
 * Rewriting the source to use explicit .ts extensions everywhere would make it
 * inconsistent with every other Next.js file in the repo, so the test runner
 * adapts instead. This keeps `npm test` a single command with nothing compiled.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(fileURLToPath(import.meta.url), '..', '..');

export async function resolve(specifier, context, nextResolve) {
  // `@/lib/money` → <root>/lib/money.ts
  if (specifier.startsWith('@/')) {
    const candidate = resolvePath(ROOT, specifier.slice(2));
    const found = withExtension(candidate);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  // './db' → './db.ts', but only when there is no extension already.
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
    const found = withExtension(resolvePath(parent, specifier));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  return nextResolve(specifier, context);
}

function withExtension(base) {
  for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs']) {
    if (existsSync(base + ext)) return base + ext;
  }
  // A directory import resolves to its index file.
  for (const ext of ['.ts', '.tsx', '.js']) {
    const indexed = resolvePath(base, `index${ext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}
