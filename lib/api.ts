/**
 * Shared plumbing for the write API.
 *
 * Auth model: a single shared bearer token, `DASHBOARD_TOKEN`. This is a
 * one-operator internal dashboard, and a full session/user system would be more
 * code to maintain than the thing it protects. Two consequences worth being
 * explicit about:
 *
 *  - When the secret is unset, writes are open. That is fine on a local
 *    `wrangler dev` and NOT fine on a deployed Worker, so the setup page and
 *    the API both say so loudly rather than failing closed and looking broken.
 *  - Put Cloudflare Access in front of the Worker for real protection. The
 *    token stops a stray request; Access stops a determined one.
 */

import { NextResponse } from 'next/server';
import { cfEnv } from './db';

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string): NextResponse {
  return json({ error: message }, 400);
}

export function serverError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, 500);
}

/** True when the request may write. */
export function authorised(request: Request): boolean {
  const expected = cfEnv()?.DASHBOARD_TOKEN ?? process.env.DASHBOARD_TOKEN;
  if (!expected) return true; // unset: local development
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(supplied, expected);
}

/**
 * Constant-time comparison. Overkill for a personal dashboard, but a plain
 * `===` on a secret is the kind of thing that gets copied into somewhere it
 * matters.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function unauthorised(): NextResponse {
  return json({ error: 'Bad or missing bearer token.' }, 401);
}

/** Parse a JSON body, returning null rather than throwing on malformed input. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Coerce to a positive integer, or null. Used for ids from the URL. */
export function toId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Validate that a value is one of a fixed set. */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** ISO date (YYYY-MM-DD) or null. Rejects anything else outright. */
export function toDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}
