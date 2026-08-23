/**
 * A metric tile.
 *
 * The one rule this component enforces: a value that is genuinely unknown
 * renders as `—` in muted type, never as `0`. On a pre-revenue dashboard the
 * difference between "we measured it and it is zero" and "nothing has reported
 * this yet" is most of the information, and a component that collapses them
 * makes the whole page untrustworthy.
 */

import { Icon } from './Icon';

export interface TileProps {
  label: string;
  /** Pre-formatted. Null renders the unknown state. */
  value: string | null;
  icon?: string;
  /** Small line under the value: comparison, target, or explanation. */
  foot?: React.ReactNode;
  /** Direction of travel, when there is a previous value to compare against. */
  trend?: 'up' | 'down' | null;
  /** Whether `up` is good. A rising refund rate is not good news. */
  higherIsBetter?: boolean;
  accent?: string;
}

export function Tile({
  label,
  value,
  icon,
  foot,
  trend = null,
  higherIsBetter = true,
  accent,
}: TileProps) {
  const good = trend === null ? null : (trend === 'up') === higherIsBetter;

  return (
    <div className="card">
      <div className="tile-label">
        {icon ? <Icon name={icon} size={13} /> : null}
        {label}
      </div>
      <div className={`tile-value${value === null ? ' muted' : ''}`} style={accent ? { color: accent } : undefined}>
        {value ?? '—'}
      </div>
      {foot ? (
        <div className="tile-foot">
          {trend ? (
            <Icon
              name={trend === 'up' ? 'arrow-trend-up' : 'arrow-trend-down'}
              size={12}
              className={good ? 'up' : 'down'}
            />
          ) : null}
          <span>{foot}</span>
        </div>
      ) : null}
    </div>
  );
}
