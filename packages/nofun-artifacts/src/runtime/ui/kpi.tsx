// Ported from nofun-components registry/nofun-ui/blocks/charts/kpi/kpi.tsx: the Kpi card parts verbatim.
// KpiProgress, KpiChart (recharts) and KpiSkeleton are left out; Metric draws its trend with Sparkline.
import type { ComponentProps, ReactNode } from "react";
import { Card } from "./card.tsx";
import { cn } from "../lib/cn.ts";
import { NumberValue, type NumberValueProps } from "./number-value.tsx";
import { TrendChip, type TrendChipProps } from "./trend-chip.tsx";

/** Card shell. Compose KpiHeader, KpiMain, KpiProgress, KpiChart and KpiFooter inside. */
export function Kpi({
  className,
  size = "default",
  ...props
}: ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <Card
      data-slot="kpi"
      size={size}
      className={cn("gap-3 has-data-[slot=kpi-footer]:pb-0", className)}
      {...props}
    />
  );
}

export function KpiHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-header"
      className={cn("flex h-6 items-center gap-2 px-(--card-spacing)", className)}
      {...props}
    />
  );
}

export function KpiIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="kpi-icon"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function KpiLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-label"
      className={cn("min-w-0 truncate text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Pushes to the end of the header: a menu button, a link, a toggle. */
export function KpiActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-actions"
      className={cn("ms-auto flex items-center gap-1", className)}
      {...props}
    />
  );
}

/** Value row: KpiValue, KpiTrend, an inline KpiChart. Fixed 32px so every KPI lines up. */
export function KpiMain({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-main"
      className={cn(
        "flex min-h-8 items-center justify-between gap-3 px-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export type KpiValueProps = Omit<NumberValueProps, "value" | "size"> & {
  /** `null` or `undefined` shows a muted dash: the reading is missing, not zero. */
  value?: number | null;
  size?: NumberValueProps["size"];
  children?: ReactNode;
};

export function KpiValue({ value, children, size = "lg", ...format }: KpiValueProps) {
  if (children != null) {
    return (
      <span
        data-slot="kpi-value"
        className="text-2xl leading-8 font-medium tracking-tight tabular-nums"
      >
        {children}
      </span>
    );
  }
  if (value == null) {
    return (
      <span
        data-slot="kpi-value"
        data-empty=""
        className="text-2xl leading-8 font-medium text-muted-foreground"
      >
        <span aria-hidden>{"—"}</span>
        <span className="sr-only">No data</span>
      </span>
    );
  }
  return (
    <span data-slot="kpi-value" className="inline-flex">
      <NumberValue value={value} size={size} {...format} />
    </span>
  );
}

/** The trend chip, sized for a KPI. Renders nothing when there is no change to report. */
export function KpiTrend({
  value,
  ...props
}: Omit<TrendChipProps, "value"> & { value?: number | null }) {
  if (value == null) return null;
  return <TrendChip value={value} {...props} />;
}

/** Muted "from $41,120" comparison. */
export function KpiFrom({
  value,
  label = "from",
  className,
  ...format
}: Omit<NumberValueProps, "size" | "prefix" | "suffix"> & { label?: ReactNode }) {
  return (
    <span
      data-slot="kpi-from"
      className={cn("text-sm whitespace-nowrap text-muted-foreground", className)}
    >
      {label} <NumberValue value={value} {...format} size="sm" className="text-foreground/80" />
    </span>
  );
}

export function KpiFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-footer"
      className={cn(
        "flex min-h-10 items-center gap-2 border-t bg-muted/50 px-(--card-spacing) py-2.5 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A designed "nothing here yet" for a whole KPI value row. */
export function KpiEmpty({
  className,
  children = "No data for this period",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="kpi-empty"
      className={cn(
        "flex min-h-8 items-center px-(--card-spacing) text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
