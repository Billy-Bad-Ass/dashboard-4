/**
 * Connector contract.
 *
 * Every external system the dashboard reads — Stripe, GitHub, Cloudflare,
 * Google Calendar — implements this shape, and every one of them can be
 * missing. A dashboard that white-screens because a token is unset is useless
 * precisely when you most need it, so "unconfigured" is a first-class result
 * here rather than an exception.
 */

export type ConnectorStatus = 'ok' | 'degraded' | 'failed' | 'unconfigured';

export interface ConnectorResult<T> {
  status: ConnectorStatus;
  /** Present when status is 'ok' or 'degraded'. */
  data: T | null;
  /** Human-readable. Shown verbatim in the UI, so write it for the operator. */
  detail: string;
  latencyMs: number;
  checkedAt: string;
}

export function unconfigured<T>(detail: string): ConnectorResult<T> {
  return {
    status: 'unconfigured',
    data: null,
    detail,
    latencyMs: 0,
    checkedAt: new Date().toISOString(),
  };
}

export function ok<T>(data: T, latencyMs: number, detail = 'Connected.'): ConnectorResult<T> {
  return { status: 'ok', data, detail, latencyMs, checkedAt: new Date().toISOString() };
}

export function failed<T>(detail: string, latencyMs = 0): ConnectorResult<T> {
  return { status: 'failed', data: null, detail, latencyMs, checkedAt: new Date().toISOString() };
}

/** Wrap a call so a thrown error becomes a failed result rather than a 500. */
export async function attempt<T>(label: string, fn: () => Promise<T>): Promise<ConnectorResult<T>> {
  const started = Date.now();
  try {
    const data = await fn();
    return ok(data, Date.now() - started);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(`${label}: ${message}`, Date.now() - started);
  }
}
