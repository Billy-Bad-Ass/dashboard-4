/**
 * A sparkline, in inline SVG.
 *
 * No chart library: the whole need is one polyline and a filled area, and a
 * charting dependency would be larger than the rest of this app's JavaScript.
 *
 * The flat-line case is handled explicitly. Every value being zero — which is
 * the current state of every revenue series in this portfolio — must draw a
 * visible line along the bottom, not a divide-by-zero producing NaN in the path
 * and an invisible chart that looks like a rendering bug.
 */

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw the area under the line. */
  fill?: boolean;
  label?: string;
}

export function Sparkline({
  values,
  width = 220,
  height = 44,
  color = 'var(--accent)',
  fill = true,
  label,
}: SparklineProps) {
  if (values.length < 2) {
    return <div className="tiny faint">Not enough history yet.</div>;
  }

  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min;
  const pad = 2;
  const usableHeight = height - pad * 2;

  const points = values.map((value, i) => {
    const x = (i / (values.length - 1)) * width;
    // A flat series pins to the bottom rather than dividing by zero.
    const y = span === 0 ? height - pad : height - pad - ((value - min) / span) * usableHeight;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const allZero = max === 0 && min === 0;
  const id = `spark-${Math.abs(hash(values.join(','))).toString(36)}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'block', opacity: allZero ? 0.45 : 1 }}
    >
      {fill && !allZero ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Stable id source. Math.random would break hydration. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

/** Horizontal stacked bar — used for pipeline and spend breakdowns. */
export function StackedBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <div className="bar-track" aria-hidden="true" />;
  }
  return (
    <div className="bar-track" style={{ display: 'flex' }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            className="bar-fill"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
    </div>
  );
}
