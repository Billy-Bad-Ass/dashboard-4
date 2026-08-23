/**
 * Inline Font Awesome icon.
 *
 * Renders from the vendored path data in lib/icons.generated.ts, so there is no
 * icon font, no CDN request and nothing to flash while a webfont loads.
 *
 * An unknown name renders nothing rather than throwing — a typo in an icon name
 * should cost you a missing glyph, not a blank page.
 */

import { ICONS } from '@/lib/icons.generated';

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  /**
   * Icons are decorative by default and hidden from screen readers. Pass a
   * title only when the icon is the sole carrier of meaning.
   */
  title?: string;
}

export function Icon({ name, size = 15, className, title }: IconProps) {
  const icon = ICONS[name];
  if (!icon) return null;

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={icon.path} />
    </svg>
  );
}
