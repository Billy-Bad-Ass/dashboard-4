/**
 * The BBA mark, inlined.
 *
 * Taken from the brand pack's bba-mark-color SVGs. It is inline rather than an
 * <img> for one reason: the mark has to change colour with the theme, and the
 * stack lines are `currentColor` while the centre bar and the dot stay brand
 * blue in both themes. An <img> cannot do that without shipping two files and
 * a media query.
 */

export function Logo({ height = 26 }: { height?: number }) {
  return (
    <svg viewBox="12 16 114 64" height={height} fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="3.4">
        <line x1="33.2" y1="20" x2="54.8" y2="20" />
        <line x1="22.6" y1="27" x2="65.4" y2="27" />
        <line x1="17.5" y1="34" x2="70.5" y2="34" />
        <line x1="14.8" y1="41" x2="73.2" y2="41" />
        <line x1="14.8" y1="55" x2="73.2" y2="55" />
        <line x1="17.5" y1="62" x2="70.5" y2="62" />
        <line x1="22.6" y1="69" x2="65.4" y2="69" />
        <line x1="33.2" y1="76" x2="54.8" y2="76" />
      </g>
      <line x1="14" y1="48" x2="112" y2="48" stroke="var(--brand-blue)" strokeWidth="3.4" />
      <rect x="116" y="44" width="8" height="8" fill="var(--brand-blue)" />
    </svg>
  );
}
