// Ported from nofun-components registry/nofun-ui/blocks/charts/number-value/number-value.tsx.
// Same variants and slots; the digit-flip animation (`animate`) is dropped since artifacts render
// a snapshot of data rather than live ticking values.
import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn.ts";
import { formatNumberValue, type NumberValueFormatOptions } from "../lib/format.ts";

const numberValue = cva("inline-flex items-baseline gap-[0.25em] align-baseline tabular-nums", {
  variants: {
    size: {
      sm: "text-sm",
      default: "text-base",
      lg: "text-2xl leading-8 font-medium tracking-tight",
      xl: "text-4xl leading-10 font-medium tracking-tight",
    },
  },
  defaultVariants: { size: "default" },
});

export type NumberValueProps = NumberValueFormatOptions &
  VariantProps<typeof numberValue> & {
    value: number;
    prefix?: ReactNode;
    suffix?: ReactNode;
    className?: string | undefined;
  };

export function NumberValue({
  value,
  prefix,
  suffix,
  size,
  className,
  ...formatOptions
}: NumberValueProps) {
  const text = formatNumberValue(value, formatOptions);
  return (
    <span data-slot="number-value" className={cn(numberValue({ size }), className)}>
      {prefix != null ? (
        <span data-slot="number-value-prefix" className="font-normal text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <span data-slot="number-value-text">{text}</span>
      {suffix != null ? (
        <span data-slot="number-value-suffix" className="font-normal text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
