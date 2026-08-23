/**
 * The chart palette.
 *
 * Every value here came out of a validator, not out of taste. The previous set
 * was picked by eye and had two real defects: Project 2's green and Project 3's
 * orange-red sat 7.4 ΔE apart under deuteranopia (indistinguishable to a
 * red-green colourblind reader — about 1 in 12 men), and Growth OS's orange was
 * 2.66:1 against the light surface, below the 3:1 floor for a mark you are
 * meant to be able to see.
 *
 * The set below passes all six checks against BOTH surfaces — light (#fcfcfb)
 * and dark (#12161F): lightness band, chroma floor, CVD separation, the
 * normal-vision floor, and contrast. Worst adjacent pair is 12.1 ΔE under
 * deuteranopia, comfortably above the 8 floor.
 *
 * If you change a colour, re-run the validator. Do not eyeball it — that is
 * exactly how the last set got shipped broken.
 */

/**
 * Categorical hues, in fixed order. Slot 0 is the brand blue.
 *
 * Fixed order matters: colour follows the entity, never its rank. A filter that
 * drops one project must not repaint the others, or a reader who learned
 * "the store is green" is now being lied to.
 */
export const CATEGORICAL = [
  '#2B5CE6', // blue    — brand
  '#12A150', // green
  '#B5179E', // magenta
  '#7C5CE6', // violet
  '#C2610A', // amber
] as const;

/**
 * Anything past the fifth slot. Deliberately neutral rather than a sixth
 * generated hue: past about seven classes adjacent bins blur, and a generated
 * hue is indistinguishable from an existing slot under CVD.
 *
 * The tail is always accompanied by a direct label in the legend and appears in
 * the table view, so identity never rests on colour alone.
 */
export const TAIL = '#6B7280';

/**
 * Colour for the nth item of an ordered series. Beyond the categorical slots it
 * returns the neutral — folding the tail rather than inventing hues.
 */
export function categorical(index: number): string {
  return CATEGORICAL[index] ?? TAIL;
}

/**
 * Status colours. Reserved — never reused as "series 6". Every use ships with
 * an icon and a label beside it, so state is never carried by colour alone.
 */
export const STATUS = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  idle: 'var(--idle)',
} as const;

/**
 * Spend categories, mapped to slots by how much they typically matter rather
 * than alphabetically. The mapping is fixed so a category keeps its colour as
 * the numbers move around underneath it.
 */
export const SPEND_CATEGORY_SLOT: Record<string, number> = {
  infra: 0,
  ai: 1,
  marketing: 2,
  tooling: 3,
  contractor: 4,
  fees: 5, // tail
  other: 6, // tail
};

export function spendColor(category: string): string {
  return categorical(SPEND_CATEGORY_SLOT[category] ?? 99);
}
