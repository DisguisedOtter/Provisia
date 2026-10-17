'use client';

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SeriesPoint {
  t: string | number | Date;
  v: number | null | undefined;
}

/**
 * Small single-series area chart for VPS usage. One hue per metric (never categorical colour),
 * 2px line, recessive grid, crosshair + tooltip on hover, values in text tokens.
 * `max` fixes the y scale (e.g. 100 for CPU %, memory limit for RAM).
 */
export function UsageChart({
  data,
  max,
  unit = '',
  format,
  className,
  height = 140,
  hue = 'sky',
  label,
}: {
  data: SeriesPoint[];
  max?: number;
  unit?: string;
  format?: (v: number) => string;
  className?: string;
  height?: number;
  hue?: 'sky' | 'violet' | 'emerald' | 'amber';
  label: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { top: 8, right: 8, bottom: 20, left: 36 };

  const points = useMemo(
    () =>
      data
        .map((p) => ({ x: new Date(p.t).getTime(), y: p.v ?? null }))
        .filter((p) => Number.isFinite(p.x))
        .sort((a, b) => a.x - b.x),
    [data],
  );

  const stroke = {
    sky: 'stroke-sky-600 dark:stroke-sky-400',
    violet: 'stroke-violet-600 dark:stroke-violet-400',
    emerald: 'stroke-emerald-600 dark:stroke-emerald-400',
    amber: 'stroke-amber-600 dark:stroke-amber-400',
  }[hue];
  const fill = {
    sky: 'fill-sky-600 dark:fill-sky-400',
    violet: 'fill-violet-600 dark:fill-violet-400',
    emerald: 'fill-emerald-600 dark:fill-emerald-400',
    amber: 'fill-amber-600 dark:fill-amber-400',
  }[hue];

  if (points.length < 2) {
    return (
      <div
        className={cn(
          'grid place-items-center rounded-md border border-dashed text-muted-foreground text-xs',
          className,
        )}
        style={{ height }}
      >
        {label}: —
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const values = points.map((p) => p.y).filter((v): v is number => v !== null);
  const yMax = max ?? Math.max(1, ...values) * 1.1;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const sx = (x: number) => pad.left + ((x - minX) / Math.max(1, maxX - minX)) * innerW;
  const sy = (y: number) => pad.top + innerH - (Math.min(y, yMax) / yMax) * innerH;
  const fmt = format ?? ((v: number) => `${Math.round(v)}${unit}`);

  let d = '';
  let area = '';
  let open = false;
  for (const p of points) {
    if (p.y === null) {
      open = false;
      continue;
    }
    const cmd = open ? 'L' : 'M';
    d += `${cmd}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)} `;
    open = true;
  }
  const first = points.find((p) => p.y !== null);
  const last = [...points].reverse().find((p) => p.y !== null);
  if (first && last) {
    area = `${d} L${sx(last.x).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${sx(first.x).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
  }

  const ticks = [0, 0.5, 1].map((f) => f * yMax);
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(maxX - minX > 36 * 3600_000 ? { day: '2-digit', month: 'short' } : {}),
  });
  const hp = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    points.forEach((p, i) => {
      const dist = Math.abs(sx(p.x) - x);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    setHover(best);
  }

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title>{label}</title>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopOpacity="0.25"
              className={cn(fill, '[stop-color:currentColor]')}
            />
            <stop offset="100%" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tv) => (
          <g key={tv}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={sy(tv)}
              y2={sy(tv)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={sy(tv) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {fmt(tv)}
            </text>
          </g>
        ))}
        <text x={pad.left} y={height - 5} className="fill-muted-foreground text-[10px]">
          {timeFmt.format(minX)}
        </text>
        <text
          x={width - pad.right}
          y={height - 5}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {timeFmt.format(maxX)}
        </text>
        {area ? <path d={area} className={fill} opacity={0.12} /> : null}
        <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" className={stroke} />
        {hp && hp.y !== null ? (
          <g>
            <line
              x1={sx(hp.x)}
              x2={sx(hp.x)}
              y1={pad.top}
              y2={pad.top + innerH}
              className="stroke-muted-foreground/50"
              strokeDasharray="3 3"
            />
            <circle
              cx={sx(hp.x)}
              cy={sy(hp.y)}
              r={4}
              className={cn(fill, 'stroke-background')}
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      {hp && hp.y !== null ? (
        <div
          className="pointer-events-none absolute top-1 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-sm"
          style={{
            left: `${(sx(hp.x) / width) * 100}%`,
            transform: sx(hp.x) > width / 2 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <div className="text-muted-foreground">{timeFmt.format(hp.x)}</div>
          <div className="font-medium tabular-nums">{fmt(hp.y)}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal meter for disk / bandwidth quotas. */
export function UsageMeter({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number | null | undefined;
  limit: number | null | undefined;
  format: (v: number) => string;
}) {
  const pct = used != null && limit ? Math.min(100, (used / limit) * 100) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used != null ? format(used) : '—'}
          {limit ? ` / ${format(limit)}` : ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct !== null && pct > 90
              ? 'bg-red-500'
              : pct !== null && pct > 75
                ? 'bg-amber-500'
                : 'bg-sky-600 dark:bg-sky-400',
          )}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
