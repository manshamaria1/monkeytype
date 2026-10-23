import { useId, useMemo, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Draw as small markers instead of a line (e.g. errors). */
  markers?: boolean;
  /** Use the secondary (right) axis. */
  secondary?: boolean;
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  yLabel?: string;
  y2Label?: string;
  ariaLabel: string;
  formatValue?: (v: number, s: Series) => string;
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** Lightweight responsive SVG line chart with a hover readout. */
export default function LineChart({ labels, series, height = 200, yLabel, y2Label, ariaLabel, formatValue }: Props) {
  const W = 800;
  const H = height;
  const pad = { l: 44, r: series.some((s) => s.secondary) ? 40 : 14, t: 12, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const id = useId();

  const { max1, max2 } = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const s of series) for (const v of s.values) if (v !== null) s.secondary ? (b = Math.max(b, v)) : (a = Math.max(a, v));
    return { max1: niceMax(a * 1.05), max2: Math.max(4, niceMax(b)) };
  }, [series]);

  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number, secondary?: boolean) => pad.t + (1 - v / (secondary ? max2 : max1)) * (H - pad.t - pad.b);

  if (n === 0) return <div className="chart-empty">No data to chart yet.</div>;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(n / 10));

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby={id} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <title id={id}>{ariaLabel}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t * max1)} y2={y(t * max1)} className="chart-grid" />
            <text x={pad.l - 6} y={y(t * max1) + 4} textAnchor="end" className="chart-tick">
              {Math.round(t * max1)}
            </text>
            {series.some((s) => s.secondary) && (
              <text x={W - pad.r + 6} y={y(t * max2, true) + 4} className="chart-tick">
                {Math.round(t * max2)}
              </text>
            )}
          </g>
        ))}
        {labels.map((l, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="chart-tick">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) =>
          s.markers ? (
            <g key={s.name}>
              {s.values.map((v, i) =>
                v ? <circle key={i} cx={x(i)} cy={y(v, s.secondary)} r={4} fill={s.color} /> : null,
              )}
            </g>
          ) : s.values.filter((v) => v !== null).length === 1 ? (
            <g key={s.name}>
              {s.values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v, s.secondary)} r={5} fill={s.color} />))}
            </g>
          ) : (
            <polyline
              key={s.name}
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? "6 5" : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              points={s.values
                .map((v, i) => (v === null ? null : `${x(i)},${y(v, s.secondary)}`))
                .filter(Boolean)
                .join(" ")}
            />
          ),
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="chart-hover" />}
        {yLabel && (
          <text x={12} y={pad.t + (H - pad.t - pad.b) / 2} transform={`rotate(-90 12 ${pad.t + (H - pad.t - pad.b) / 2})`} textAnchor="middle" className="chart-axis">
            {yLabel}
          </text>
        )}
        {y2Label && (
          <text x={W - 6} y={pad.t + (H - pad.t - pad.b) / 2} transform={`rotate(90 ${W - 6} ${pad.t + (H - pad.t - pad.b) / 2})`} textAnchor="middle" className="chart-axis">
            {y2Label}
          </text>
        )}
      </svg>
      <figcaption className="chart-legend">
        {hover !== null ? (
          <>
            <span className="chart-legend-label">{labels[hover]}</span>
            {series.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} /> {s.name}: {s.values[hover] === null ? "-" : formatValue ? formatValue(s.values[hover]!, s) : Math.round(s.values[hover]!)}
              </span>
            ))}
          </>
        ) : (
          series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} /> {s.name}
            </span>
          ))
        )}
      </figcaption>
    </figure>
  );
}
