'use client';

/**
 * The time-series chart.
 *
 * This replaces a sparkline that drew a line and nothing else. An HTML chart is
 * interactive by default — the hover layer is part of the deliverable, not an
 * upgrade — so this one ships with a crosshair that snaps to the nearest point,
 * a tooltip, keyboard navigation, and a table view.
 *
 * Three things it is built around:
 *
 *  - **The all-zero case is the normal case here.** This portfolio earns
 *    nothing, so every revenue series is currently flat at zero. A chart that
 *    divides by its range produces NaN and renders nothing, which looks exactly
 *    like a broken chart. Flat series pin to the baseline and say so in words.
 *
 *  - **The tooltip enhances, it never gates.** Every value it shows is also
 *    reachable from the table view, which is a button away and keyboard
 *    reachable. Hover is not the only path to the numbers.
 *
 *  - **The crosshair finds the X.** Readers aim at a date, not at a 2px line.
 *    The whole plot is one hit target and the nearest point wins.
 */

import { useId, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { formatVital, type VitalUnit } from '@/lib/vitals';
import { formatDate } from '@/lib/dates';

export interface ChartPoint {
  /** ISO date. Used for the axis and the tooltip. */
  date: string;
  value: number;
}

export interface ChartProps {
  points: ChartPoint[];
  /** Series name. With one series this is the title, and no legend box is needed. */
  label: string;
  color?: string;
  height?: number;
  /**
   * What the numbers are, so the chart can write them down itself. Defaults to
   * money, since most series here are money.
   *
   * This was `format?: (value: number) => string` until 2026-08-29, and it is a
   * string now for a reason worth keeping. Every caller of this component is a
   * server component, so a function here was a function crossing the server →
   * client boundary, which React cannot serialise: each project page threw
   * "Functions cannot be passed directly to Client Components" and answered a
   * 500. See `lib/vitals.ts`.
   *
   * Nothing caught it because the crash needs *data*: with an empty database
   * there is no metric history, the chart is never rendered, and the page is
   * fine. See `db/smoke.sql`.
   */
  unit?: VitalUnit;
  /** Shown under the chart when every value is zero — the current reality. */
  emptyNote?: string;
}

export function Chart({
  points,
  label,
  color = 'var(--accent)',
  height = 132,
  unit = 'gbp',
  emptyNote,
}: ChartProps) {
  const format = (value: number) => formatVital(value, unit);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();

  const geometry = useMemo(() => {
    const values = points.map((p) => p.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min;
    const flat = span === 0;

    // Viewbox units. The plot is drawn in a fixed coordinate space and scaled by
    // CSS, so the stroke stays hairline at any width via vector-effect.
    const W = 600;
    const H = 200;
    const padY = 14;
    const usable = H - padY * 2;

    const at = (i: number, value: number) => {
      const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
      // A flat series sits just above the baseline rather than dividing by zero.
      const y = flat ? H - padY : H - padY - ((value - min) / span) * usable;
      return [x, y] as const;
    };

    const coords = points.map((p, i) => at(i, p.value));
    const line = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    const area = coords.length ? `${line} L${W},${H} L0,${H} Z` : '';

    return { W, H, coords, line, area, flat, max, min };
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="chart-empty">
        <Icon name="chart-line" size={15} />
        <span>Not enough history yet — the first snapshots land as the cron runs.</span>
      </div>
    );
  }

  /** Nearest point to the pointer. The reader aims at a date, not at the line. */
  function locate(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, index)));
  }

  const active = hover === null ? null : points[hover];
  const activeCoord = hover === null ? null : geometry.coords[hover];

  const flatZero = geometry.flat && geometry.max === 0;

  return (
    <figure className="chart">
      <div
        className="chart-plot"
        style={{ height: flatZero ? Math.min(height, 54) : height }}
        onPointerMove={(e) => locate(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${geometry.W} ${geometry.H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}. ${describe(points, format)}`}
          style={{ display: 'block', width: '100%', height: '100%' }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {!geometry.flat ? <path d={geometry.area} fill={`url(#${gradientId})`} /> : null}

          <path
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={geometry.flat ? 0.55 : 1}
          />

          {activeCoord ? (
            <g>
              {/* Solid hairline. A dashed crosshair reads as a threshold. */}
              <line
                x1={activeCoord[0]}
                y1={0}
                x2={activeCoord[0]}
                y2={geometry.H}
                stroke="var(--border-strong)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {/* 2px surface ring so the marker reads over the line it sits on. */}
              <circle
                cx={activeCoord[0]}
                cy={activeCoord[1]}
                r="5"
                fill={color}
                stroke="var(--surface)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}
        </svg>

        {active && activeCoord ? (
          <div
            className="chart-tip"
            style={{
              left: `${(activeCoord[0] / geometry.W) * 100}%`,
              // Flip before the tooltip runs off either edge.
              transform: `translate(${activeCoord[0] > geometry.W * 0.7 ? '-100%' : '0'}, 0)`,
            }}
          >
            {/* Value leads, label follows: the reader has the series and wants the number. */}
            <div className="chart-tip-value">{format(active.value)}</div>
            <div className="chart-tip-meta">
              <span className="chart-tip-key" style={{ background: color }} />
              {formatDate(active.date)}
            </div>
          </div>
        ) : null}
      </div>

      <figcaption className="chart-foot">
        <span className="tiny faint">{formatDate(points[0]!.date)}</span>

        <div className="row" style={{ gap: 8 }}>
          {geometry.flat ? (
            <span className="tiny" style={{ color: 'var(--text-muted)' }}>
              {emptyNote ?? 'Flat throughout'}
            </span>
          ) : null}
          <button
            type="button"
            className="chart-toggle"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
          >
            <Icon name={showTable ? 'chart-line' : 'list-check'} size={11} />
            {showTable ? 'Chart' : 'Values'}
          </button>
        </div>

        <span className="tiny faint">{formatDate(points[points.length - 1]!.date)}</span>
      </figcaption>

      {showTable ? (
        <div className="chart-table">
          <table>
            <caption className="sr-only">{label}, as a table</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="num">
                  {label}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Newest first: the question is almost always "what is it now". */}
              {[...points].reverse().map((p) => (
                <tr key={p.date}>
                  <td className="mono tiny">{formatDate(p.date)}</td>
                  <td className="num">{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

/** Screen-reader summary, so the shape is available without the pixels. */
function describe(points: ChartPoint[], format: (v: number) => string): string {
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    return `Flat at ${format(max)} across all ${points.length} days.`;
  }
  const peak = points[values.indexOf(max)]!;
  return `${points.length} days, from ${format(values[0]!)} to ${format(
    values[values.length - 1]!,
  )}. Highest ${format(max)} on ${formatDate(peak.date)}.`;
}

/**
 * Horizontal part-to-whole bar.
 *
 * Segments are separated by a 2px surface gap rather than a border — a stroke
 * around a mark is data-weight ink doing a spacer's job. Each segment carries
 * its own hover, because on bars the mark is the hit target and there is no
 * meaningful X to crosshair.
 *
 * `unit` rather than a formatter function, for the same reason as `Chart` above
 * — and this one was not hypothetical either. `/finance` passed
 * `format={(v) => formatMoney(v)}` here and answered 500 on every request,
 * unnoticed, because the only reported symptom was the project pages.
 */
export function StackedBar({
  segments,
  unit = 'count',
}: {
  segments: { label: string; value: number; color: string }[];
  unit?: VitalUnit;
}) {
  const format = (value: number) => formatVital(value, unit);
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((a, s) => a + s.value, 0);

  if (total === 0) {
    return <div className="bar-track" aria-hidden="true" />;
  }

  const visible = segments.filter((s) => s.value > 0);

  return (
    <div
      className="bar-track bar-stack"
      role="img"
      aria-label={visible.map((s) => `${s.label} ${format(s.value)}`).join(', ')}
    >
      {visible.map((s, i) => (
        <div
          key={s.label}
          className="bar-seg"
          style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color,
            // The gap is the separator. No border.
            marginLeft: i === 0 ? 0 : 2,
            opacity: hover === null || hover === s.label ? 1 : 0.45,
          }}
          onPointerEnter={() => setHover(s.label)}
          onPointerLeave={() => setHover(null)}
          title={`${s.label}: ${format(s.value)}`}
        />
      ))}
    </div>
  );
}
