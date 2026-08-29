/**
 * How a vital's number is written down.
 *
 * This lives in `lib/` rather than beside the register in `config/portfolio.ts`
 * or beside the tiles in the project page, and the reason is a bug rather than
 * a preference.
 *
 * `formatVital` used to be a private function in `app/projects/[slug]/page.tsx`.
 * That page is a server component and `Chart` is a client component, so the only
 * way to share the formatter was to pass it across the boundary as a prop:
 *
 *     <Chart format={(v) => formatVital(v, spec?.unit)} />
 *
 * React cannot serialise a function, so every project page threw
 * "Functions cannot be passed directly to Client Components" at render time and
 * answered 500. A client component can `import` freely, though — it just cannot
 * be *handed* a closure. So the formatter moves to a module both sides import,
 * and the prop becomes the unit itself, which is a string.
 *
 * The rule this leaves behind, worth more than the fix:
 *
 *   **Props that cross into a client component must survive `JSON.stringify`.**
 *   Pass the data the component needs to decide, not a function that decides.
 *
 * `unit` is declared here rather than in `config/portfolio.ts` so that importing
 * it does not drag the whole portfolio register — every project's prose, gates
 * and Stripe matchers — into the browser bundle.
 */

import { formatMoney } from './money';

/**
 * `gbp` means *money*, in whatever `DEFAULT_CURRENCY` is — cents today.
 *
 * The name is dated for the same reason the `amount_pence` columns are, and is
 * left alone for the same reason: see the note at the top of `lib/money.ts`.
 * Renaming it is a rename across the register, not a bug fix.
 */
export type VitalUnit = 'gbp' | 'count' | 'percent' | 'days';

/**
 * Shared by the vital tiles, the history charts and the stacked bars, so they
 * cannot disagree about what a number means.
 */
export function formatVital(value: number, unit: VitalUnit | undefined): string {
  if (unit === 'gbp') return formatMoney(value);
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  if (unit === 'days') return `${Math.round(value)}d`;
  return Math.round(value).toLocaleString('en-GB');
}
