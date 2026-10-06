// Ported verbatim from nofun-components registry/nofun-ui/blocks/charts/trend-chip/trend-chip.tsx.
// Only imports changed (Tabler icons are inline SVG stand-ins).
import type { ReactNode } from "react";
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "../lib/icons.tsx";
import { Badge } from "./badge.tsx";
import { cn } from "../lib/cn.ts";
import { formatNumberValue, type NumberValueFormat } from "../lib/format.ts";

export type TrendDirection = "up" | "down" | "flat";

/** The sign of a number decides direction. Anything within `threshold` of zero is flat. */
export function trendDirection(value: number, threshold = 0): TrendDirection {
  if (!Number.isFinite(value) || Math.abs(value) <= threshold) return "flat";
  return value > 0 ? "up" : "down";
}

export type TrendChipProps = {
  /** The change. With `format: 'percent'` (the default) this is in percentage points: 12.4 renders +12.4%. */
  value: number;
  format?: Exclude<NumberValueFormat, "unit">;
  currency?: string;
  locale?: string;
  maximumFractionDigits?: number;
  /** Changes at or below this size read as flat. */
  threshold?: number;
  /** A fall is good news (churn, refunds, load time): swaps the hues, never the arrow. */
  invert?: boolean;
  size?: "sm" | "default" | "lg";
  /** Show the sign. Default true; the arrow is the second channel, not a replacement. */
  signed?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Replace the arrow, or `false` to drop it. */
  indicator?: ReactNode | false;
  className?: string;
};

const variantFor = {
  good: "green",
  bad: "destructive",
  flat: "neutral",
} as const;

const word = { up: "Up", down: "Down", flat: "No change" } as const;

export function TrendChip({
  value,
  format = "percent",
  currency,
  locale,
  maximumFractionDigits = 1,
  threshold = 0,
  invert = false,
  size = "default",
  signed = true,
  prefix,
  suffix,
  indicator,
  className,
}: TrendChipProps) {
  const direction = trendDirection(value, threshold);
  const tone = direction === "flat" ? "flat" : (direction === "up") !== invert ? "good" : "bad";
  const magnitude = Math.abs(value);
  const text = formatNumberValue(format === "percent" ? magnitude / 100 : magnitude, {
    format,
    currency,
    locale,
    maximumFractionDigits,
    signDisplay: "never",
  });
  const sign = !signed || direction === "flat" ? "" : direction === "up" ? "+" : "−";

  const Icon =
    direction === "up" ? IconArrowUpRight : direction === "down" ? IconArrowDownRight : IconMinus;

  return (
    <Badge
      data-slot="trend-chip"
      data-direction={direction}
      data-tone={tone}
      variant={variantFor[tone]}
      size={size === "sm" ? "sm" : "default"}
      className={cn("tabular-nums", size === "lg" && "h-7 gap-1.5 px-2.5 text-base", className)}
    >
      {indicator === false
        ? null
        : (indicator ?? (
            <Icon
              aria-hidden
              data-slot="trend-chip-indicator"
              className={cn(size === "lg" && "size-4!")}
            />
          ))}
      <span className="sr-only">{word[direction]} </span>
      {prefix != null ? <span data-slot="trend-chip-prefix">{prefix}</span> : null}
      <span data-slot="trend-chip-value">
        {sign}
        {text}
      </span>
      {suffix != null ? <span data-slot="trend-chip-suffix">{suffix}</span> : null}
    </Badge>
  );
}
