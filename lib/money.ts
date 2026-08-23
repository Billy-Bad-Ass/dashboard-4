/**
 * Money.
 *
 * Every amount in this codebase is an integer of minor units — pence for GBP.
 * `500` is £5.00. This matches Project-2, and it is not negotiable: the failure
 * mode of getting it wrong is being out by 100x on a number you then make
 * decisions from.
 *
 * Nothing here touches floats until the final formatting step, and that step
 * only ever divides by 100.
 */

export type Pence = number;

const SYMBOLS: Record<string, string> = {
  gbp: '£',
  usd: '$',
  eur: '€',
};

export function symbolFor(currency: string): string {
  return SYMBOLS[currency.toLowerCase()] ?? currency.toUpperCase() + ' ';
}

/** `500` → `"£5.00"`. Always two decimals; this is money, not a measurement. */
export function formatMoney(pence: Pence, currency = 'gbp'): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const body = `${symbolFor(currency)}${(abs / 100).toFixed(2)}`;
  return negative ? `-${body}` : body;
}

/**
 * Compact form for tiles where the exact pennies are noise: `£1.2k`, `£45`.
 * Falls back to the exact form below £1000 so small real numbers stay readable —
 * at this stage of the business every pound is worth seeing in full.
 */
export function formatMoneyCompact(pence: Pence, currency = 'gbp'): string {
  const abs = Math.abs(pence);
  if (abs < 100_000) return formatMoney(pence, currency);
  const sign = pence < 0 ? '-' : '';
  const thousands = abs / 100_000;
  if (thousands < 1000) return `${sign}${symbolFor(currency)}${trim(thousands)}k`;
  return `${sign}${symbolFor(currency)}${trim(thousands / 1000)}m`;
}

function trim(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toString();
}

/** Parse a typed-in amount ("12.50", "£12.50", "12") to pence. */
export function parseMoney(input: string): Pence | null {
  const cleaned = input.replace(/[£$€,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // toFixed before rounding: 19.99 * 100 is 1998.9999999999998 in binary float.
  return Math.round(Number(value.toFixed(2)) * 100);
}

/**
 * Return on investment as a percentage.
 *
 * Deliberately returns `null` rather than 0 or Infinity when nothing has been
 * spent: "no ROI yet" and "0% ROI" are different statements, and a dashboard
 * that renders the second when it means the first is lying.
 */
export function roiPercent(returnedPence: Pence, spentPence: Pence): number | null {
  if (spentPence <= 0) return null;
  return ((returnedPence - spentPence) / spentPence) * 100;
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** Whole days between two ISO dates, floor. Negative if `to` is before `from`. */
export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
