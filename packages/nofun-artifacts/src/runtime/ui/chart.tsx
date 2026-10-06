// Ported from nofun-components registry/nofun-ui/blocks/charts/chart-area/chart-shell.tsx (tones, nice
// ticks, frame parts, legend, empty state: verbatim logic and classes) and charts/chart-bar/chart-bar.tsx
// (bar geometry: 24% category gap, 32px max bar, 4px top radius). Recharts is replaced by a small SVG
// renderer that follows the same "quiet axes" rules, so an artifact does not ship a 400 KB chart library.
// The tooltip reuses Kobra ChartTooltipContent's markup (components/ui/chart.tsx).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Card, CardDescription, CardTitle } from "./card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty.tsx";
import { cn } from "../lib/cn.ts";
import { IconChartAreaLine } from "../lib/icons.tsx";

/* Series and color (chart-shell.tsx) */

export type ChartTone =
  | "foreground"
  | "muted"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "success"
  | "warning"
  | "error"
  | "info";

export type ChartSeries = {
  /** Data key. */
  key: string;
  label: string;
  color?: ChartTone | undefined;
  /** Dashed stroke for lines, hatched swatch in the legend. */
  dashed?: boolean | undefined;
};

/** Mid grays first: they hold contrast on both the light and the dark card. */
export const CHART_TONE_ORDER: ChartTone[] = [
  "foreground",
  "chart-2",
  "chart-3",
  "chart-1",
  "chart-4",
];

export function toneVar(tone: ChartTone) {
  if (tone === "muted") return "var(--muted-foreground)";
  return `var(--${tone})`;
}

export function seriesTone(series: ChartSeries, index: number): ChartTone {
  return series.color ?? CHART_TONE_ORDER[index % CHART_TONE_ORDER.length]!;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Round gridline values (step 1, 2, 2.5 or 5 times a power of ten) covering min to max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export type ChartDatum = Record<string, string | number | null>;

function numberAt(row: ChartDatum, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Largest value the plot reaches. Each group of keys is summed (stacked); a lone key is itself. */
export function dataMax(data: ChartDatum[], groups: string[][]) {
  let max = 0;
  for (const row of data)
    for (const g of groups)
      max = Math.max(
        max,
        g.reduce((n, k) => n + (numberAt(row, k) ?? 0), 0),
      );
  return max;
}

/** Ticks and a snapped domain from zero to the data max. */
export function zeroTicks(data: ChartDatum[], groups: string[][], count = 4) {
  const ticks = niceTicks(0, dataMax(data, groups), count);
  return { ticks, domain: [ticks[0]!, ticks[ticks.length - 1]!] as [number, number] };
}

/** Prefers-reduced-motion, read once per render. */
export function useReducedMotion() {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/* Frame parts shared by every chart block (chart-shell.tsx) */

type DivProps = React.ComponentProps<"div">;

const frameVariants = cva("min-w-0", {
  variants: {
    variant: {
      card: "",
      plain: "rounded-none bg-transparent py-0 ring-0 [--card-spacing:0px]",
    },
  },
  defaultVariants: { variant: "card" },
});

export type ChartFrameProps = React.ComponentProps<typeof Card> &
  VariantProps<typeof frameVariants>;

export function ChartFrame({ className, size, variant, ...props }: ChartFrameProps) {
  return (
    <Card
      data-slot="chart-frame"
      size={size ?? "default"}
      className={cn(frameVariants({ variant }), className)}
      {...props}
    />
  );
}

export function ChartHeader({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="chart-header"
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export function ChartHeading({ className, ...props }: DivProps) {
  return (
    <div data-slot="chart-heading" className={cn("grid min-w-0 gap-1", className)} {...props} />
  );
}

export function ChartTitle({ className, ...props }: DivProps) {
  return <CardTitle data-slot="chart-title" className={cn("text-sm", className)} {...props} />;
}

export function ChartDescription({ className, ...props }: DivProps) {
  return (
    <CardDescription
      data-slot="chart-description"
      className={cn("text-xs", className)}
      {...props}
    />
  );
}

export function ChartValue({ className, ...props }: DivProps) {
  return (
    <div
      data-slot="chart-value"
      className={cn(
        "flex items-baseline gap-2 text-2xl leading-none font-medium tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function ChartLegendList({
  series,
  className,
  ...props
}: { series: ChartSeries[] } & Omit<React.ComponentProps<"ul">, "children">) {
  return (
    <ul
      data-slot="chart-legend"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    >
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 shrink-0 rounded-[2px] bg-(--legend-color)",
              s.dashed &&
                "h-0 w-3 rounded-none border-t-[1.5px] border-dashed border-(--legend-color) bg-transparent",
            )}
            style={{ "--legend-color": toneVar(seriesTone(s, i)) } as React.CSSProperties}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartEmpty({
  title = "No data yet",
  description = "Numbers appear here once there is something to plot.",
  className,
  ...props
}: Omit<DivProps, "title"> & { title?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <Empty
      data-slot="chart-empty"
      className={cn("h-(--chart-h) max-w-none gap-0 border border-border/70 p-4", className)}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconChartAreaLine aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription className="text-xs">{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/* SVG plot */

export type ChartPlotProps = {
  type?: "bar" | "line" | "area" | undefined;
  data: ChartDatum[];
  /** Key of the category axis. */
  xKey: string;
  series: ChartSeries[];
  /** Stack series. Without it, several bar series are grouped side by side. */
  stacked?: boolean | undefined;
  /** Plot height in px. */
  height?: number | undefined;
  valueFormatter?: ((value: number) => string) | undefined;
  /** Accessible name for the plot. */
  label?: string | undefined;
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
};

const MARGIN = { top: 8, right: 4, bottom: 22, left: 44 };
const R = 4;

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Monotone cubic interpolation (d3's curveMonotoneX), so lines never overshoot their data. */
function monotonePath(points: ReadonlyArray<readonly [number, number]>) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0]![0]},${points[0]![1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1]![0] - points[i]![0];
    dx.push(h);
    slope.push(h === 0 ? 0 : (points[i + 1]![1] - points[i]![1]) / h);
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    tangent.push(
      a * b <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b),
    );
  }
  tangent.push(slope[n - 2]!);
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${x0 + h},${y0 + tangent[i]! * h},${x1 - h},${y1 - tangent[i + 1]! * h},${x1},${y1}`;
  }
  return d;
}

function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0 || w <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

/** Plot body for bar, line and area charts, with the Kobra quiet grid, axes and tooltip. */
export function ChartPlot({
  type = "bar",
  data,
  xKey,
  series,
  stacked = false,
  height = 240,
  valueFormatter = formatCompact,
  label,
  emptyTitle,
  emptyDescription,
}: ChartPlotProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<{ index: number; x: number; y: number } | null>(null);
  const uid = React.useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const heightVar = { "--chart-h": `${height}px` } as React.CSSProperties;

  if (data.length === 0 || series.length === 0) {
    return (
      <div data-slot="chart-plot" className="min-w-0 px-(--card-spacing)" style={heightVar}>
        <ChartEmpty title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  const groups = stacked ? [series.map((s) => s.key)] : series.map((s) => [s.key]);
  const scale = zeroTicks(data, groups);
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const max = scale.domain[1] || 1;
  const y = (value: number) => MARGIN.top + innerH - (value / max) * innerH;
  const n = data.length;
  const band = n > 0 ? innerW / n : 0;
  const pointX = (i: number) =>
    type === "bar"
      ? MARGIN.left + band * i + band / 2
      : MARGIN.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));

  // Category labels thin out so they never collide (recharts' minTickGap of 16).
  const labelWidth = Math.max(...data.map((row) => String(row[xKey] ?? "").length)) * 6.4 + 16;
  const slot = type === "bar" ? band : n > 1 ? innerW / (n - 1) : innerW;
  const every = Math.max(1, Math.ceil(labelWidth / Math.max(1, slot)));

  const colors = series.map((s, i) => toneVar(seriesTone(s, i)));

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const index =
      type === "bar"
        ? Math.floor((px - MARGIN.left) / Math.max(1, band))
        : Math.round(((px - MARGIN.left) / Math.max(1, innerW)) * (n - 1));
    if (index < 0 || index >= n) return setActive(null);
    setActive({ index, x: px, y: event.clientY - rect.top });
  };

  const bars = () => {
    const gapRatio = 0.24;
    const groupW = band * (1 - gapRatio);
    const k = stacked ? 1 : series.length;
    const barW = Math.min(32, (groupW - (k - 1) * 4) / k);
    const used = barW * k + (k - 1) * 4;
    return data.map((row, i) => {
      const x0 = MARGIN.left + band * i + (band - used) / 2;
      let base = 0;
      return series.map((s, j) => {
        const value = numberAt(row, s.key) ?? 0;
        const top = base + value;
        const last = j === series.length - 1;
        const rx = stacked ? x0 : x0 + j * (barW + 4);
        const yTop = y(stacked ? top : value);
        const yBottom = y(stacked ? base : 0);
        base = stacked ? top : 0;
        const h = yBottom - yTop;
        const d =
          !stacked || last
            ? topRoundedRect(rx, yTop, barW, h, R)
            : `M${rx},${yTop}h${barW}v${h}h${-barW}Z`;
        return <path key={`${i}-${s.key}`} d={d} fill={colors[j]} />;
      });
    });
  };

  const lines = () =>
    series.map((s, j) => {
      let floor = data.map(() => 0);
      if (stacked) {
        floor = data.map((row) =>
          series.slice(0, j).reduce((sum, prev) => sum + (numberAt(row, prev.key) ?? 0), 0),
        );
      }
      const points = data.map(
        (row, i) => [pointX(i), y((numberAt(row, s.key) ?? 0) + floor[i]!)] as const,
      );
      const path = monotonePath(points);
      const fillId = `${uid}-fill-${j}`;
      const basePoints = points.map(([px], i) => [px, y(floor[i]!)] as const).toReversed();
      const baseline =
        stacked && j > 0
          ? monotonePath(basePoints).replace(/^M/, "L")
          : `L${points[points.length - 1]![0]},${y(0)}L${points[0]![0]},${y(0)}`;
      return (
        <g key={s.key}>
          {type === "area" ? (
            <>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[j]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={colors[j]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path d={`${path}${baseline}Z`} fill={`url(#${fillId})`} />
            </>
          ) : null}
          <path
            d={path}
            fill="none"
            stroke={colors[j]}
            strokeWidth={type === "line" ? 2 : 1.5}
            strokeLinecap="round"
            strokeDasharray={s.dashed ? "4 4" : undefined}
          />
          {active !== null ? (
            <circle
              cx={points[active.index]![0]}
              cy={points[active.index]![1]}
              r={3}
              fill={colors[j]}
              stroke="var(--card)"
              strokeWidth={1.5}
            />
          ) : null}
        </g>
      );
    });

  const activeRow = active === null ? null : data[active.index];
  const tooltipLeft =
    active === null ? 0 : Math.min(Math.max(8, active.x + 12), Math.max(8, width - 176));

  return (
    <div data-slot="chart-plot" className="relative min-w-0 px-(--card-spacing)" style={heightVar}>
      <div ref={ref} className="relative h-(--chart-h) w-full">
        {width > 0 ? (
          <svg
            role="img"
            aria-label={label}
            width={width}
            height={height}
            className={cn(
              "block overflow-visible text-xs",
              !reduced && "[&_path]:transition-[d] [&_path]:duration-200",
            )}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          >
            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + innerW}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--border)"
                  strokeOpacity={0.6}
                />
                <text
                  x={MARGIN.left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                  className="tabular-nums"
                >
                  {valueFormatter(tick)}
                </text>
              </g>
            ))}
            {active !== null && type === "bar" ? (
              <rect
                x={MARGIN.left + band * active.index}
                y={MARGIN.top}
                width={band}
                height={innerH}
                fill="var(--muted)"
                fillOpacity={0.5}
              />
            ) : null}
            {active !== null && type !== "bar" ? (
              <line
                x1={pointX(active.index)}
                x2={pointX(active.index)}
                y1={MARGIN.top}
                y2={MARGIN.top + innerH}
                stroke="var(--border)"
              />
            ) : null}
            {type === "bar" ? bars() : lines()}
            {data.map((row, i) =>
              i % every === 0 ? (
                <text
                  key={i}
                  x={pointX(i)}
                  y={height - 6}
                  textAnchor={
                    type !== "bar" && i === 0
                      ? "start"
                      : type !== "bar" && i === n - 1
                        ? "end"
                        : "middle"
                  }
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {String(row[xKey] ?? "")}
                </text>
              ) : null,
            )}
          </svg>
        ) : null}
        {activeRow ? (
          <div
            data-slot="chart-tooltip-content"
            className="pointer-events-none absolute top-2 z-10 grid min-w-40 items-start gap-1.5 rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-xl"
            style={{ left: tooltipLeft }}
          >
            <div className="font-medium">{String(activeRow[xKey] ?? "")}</div>
            <div className="grid gap-1.5">
              {series.map((s, j) => {
                const value = numberAt(activeRow, s.key);
                return (
                  <div key={s.key} className="flex w-full flex-wrap items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 self-center rounded-[2px] bg-(--row-color)"
                      style={{ "--row-color": colors[j] } as React.CSSProperties}
                    />
                    <span className="flex flex-1 items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {value === null ? "—" : valueFormatter(value)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* Sparkline (charts/sparkline/sparkline.tsx: same tones, auto direction, fitted domain) */

export type SparklineTone =
  | "auto"
  | "foreground"
  | "neutral"
  | "success"
  | "error"
  | "warning"
  | "info";

const SPARK_TONE: Record<Exclude<SparklineTone, "auto">, ChartTone> = {
  foreground: "foreground",
  neutral: "chart-2",
  success: "success",
  error: "error",
  warning: "warning",
  info: "info",
};

const sparklineVariants = cva("block w-full min-w-0 shrink-0 text-xs", {
  variants: {
    size: { sm: "h-6", default: "h-8", lg: "h-12" },
  },
  defaultVariants: { size: "default" },
});

export type SparklineProps = VariantProps<typeof sparklineVariants> & {
  data: number[];
  type?: "area" | "line" | "bar" | undefined;
  /** `auto` reads the series: success when it ends at or above where it started, error when below. */
  tone?: SparklineTone | undefined;
  /** A fall is good news: swaps the auto hues. */
  invert?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
};

export function Sparkline({
  data,
  type = "area",
  tone = "auto",
  invert = false,
  size,
  label,
  className,
}: SparklineProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const uid = React.useId().replace(/:/g, "");
  const rootClass = cn(sparklineVariants({ size }), className);
  if (data.length < 2) {
    return (
      <div
        role="img"
        aria-label={label ?? "No trend data"}
        data-slot="sparkline"
        data-state="empty"
        className={cn(rootClass, "flex items-center")}
      >
        <span className="w-full border-t border-dashed border-border" />
      </div>
    );
  }
  const falling = data[data.length - 1]! < data[0]!;
  const resolved: ChartTone =
    tone === "auto" ? (falling !== invert ? "error" : "success") : SPARK_TONE[tone];
  const stroke = toneVar(resolved);
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  // Never zoom a near-flat series into a wave: keep a span of at least a quarter of its level.
  const span = Math.max(hi - lo, 0.25 * Math.abs(hi)) || 1;
  const mid = (hi + lo) / 2;
  const min = mid - span * 0.55;
  const max = mid + span * 0.55;
  const h = size === "sm" ? 24 : size === "lg" ? 48 : 32;
  const m = 3;
  const x = (i: number) => 2 + ((width - 4) * i) / (data.length - 1);
  const yv = (v: number) => m + (h - 2 * m) * (1 - (v - min) / (max - min));
  const points = data.map((v, i) => [x(i), yv(v)] as const);
  const path = monotonePath(points);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      data-slot="sparkline"
      data-type={type}
      className={rootClass}
    >
      {width > 0 ? (
        <svg width={width} height={h} className="block overflow-visible">
          {type === "bar" ? (
            data.map((v, i) => {
              const bw = ((width - 4) / data.length) * 0.82;
              const bx = 2 + ((width - 4) / data.length) * i;
              const top = m + (h - 2 * m) * (1 - v / (hi * 1.05 || 1));
              return (
                <rect
                  key={i}
                  x={bx}
                  y={top}
                  width={bw}
                  height={h - m - top}
                  rx={1.5}
                  fill={stroke}
                />
              );
            })
          ) : (
            <>
              {type === "area" ? (
                <>
                  <defs>
                    <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${path}L${x(data.length - 1)},${h}L${x(0)},${h}Z`}
                    fill={`url(#${uid}-fill)`}
                  />
                </>
              ) : null}
              <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
            </>
          )}
        </svg>
      ) : null}
    </div>
  );
}
