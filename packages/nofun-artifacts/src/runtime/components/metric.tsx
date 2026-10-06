// Metric composes the ported Kobra KPI card (blocks/charts/kpi), TrendChip and Sparkline.
// Status is the Kobra Badge with the tone mapping the timeline block uses (blocks/data/timeline).
import { Badge } from "../ui/badge.tsx";
import { Sparkline } from "../ui/chart.tsx";
import { Kpi, KpiFooter, KpiHeader, KpiLabel, KpiMain, KpiTrend, KpiValue } from "../ui/kpi.tsx";
import { cn } from "../lib/cn.ts";
import type { NumberValueFormat } from "../lib/format.ts";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

const BADGE_VARIANT = {
  neutral: "neutral",
  info: "blue",
  success: "green",
  warning: "amber",
  danger: "destructive",
  primary: "default",
} as const;

export type StatusProps = {
  label: string;
  tone?: StatusTone | undefined;
  /** Muted text after the badge: a time, an owner, a count. */
  detail?: string | undefined;
  size?: "sm" | "default" | undefined;
  className?: string | undefined;
};

export function Status({
  label,
  tone = "neutral",
  detail,
  size = "default",
  className,
}: StatusProps) {
  return (
    <span data-slot="status" className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Badge variant={BADGE_VARIANT[tone]} size={size}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        {label}
      </Badge>
      {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

export type MetricProps = {
  label: string;
  /** `null` shows a muted dash: the reading is missing, not zero. With `format: "percent"`, 0.25 is 25%. */
  value: number | null;
  format?: Exclude<NumberValueFormat, "unit"> | undefined;
  currency?: string | undefined;
  /** Short suffix after the number, such as "ms" or "users". */
  unit?: string | undefined;
  maximumFractionDigits?: number | undefined;
  /** Change in percentage points: 12.4 renders +12.4%. */
  change?: number | null | undefined;
  /** A fall is good news (churn, refunds, latency): swaps the trend hues. */
  invert?: boolean | undefined;
  /** Recent values, oldest first, drawn as a sparkline. */
  trend?: number[] | undefined;
  /** Footer line, e.g. "vs last week" or the data source. */
  footer?: string | undefined;
  status?: { label: string; tone?: StatusTone | undefined } | undefined;
  className?: string | undefined;
};

export function Metric({
  label,
  value,
  format,
  currency,
  unit,
  maximumFractionDigits,
  change,
  invert,
  trend,
  footer,
  status,
  className,
}: MetricProps) {
  return (
    <Kpi className={className}>
      <KpiHeader>
        <KpiLabel>{label}</KpiLabel>
        {status ? (
          <span className="ms-auto">
            <Status label={status.label} tone={status.tone} size="sm" />
          </span>
        ) : null}
      </KpiHeader>
      <KpiMain>
        <KpiValue
          value={value}
          format={format}
          currency={currency}
          maximumFractionDigits={maximumFractionDigits}
          suffix={unit}
        />
        <KpiTrend value={change ?? null} invert={invert ?? false} size="sm" />
      </KpiMain>
      {trend && trend.length > 1 ? (
        <div className="px-(--card-spacing)">
          <Sparkline data={trend} invert={invert} label={`${label} trend`} />
        </div>
      ) : null}
      {footer ? <KpiFooter>{footer}</KpiFooter> : null}
    </Kpi>
  );
}
