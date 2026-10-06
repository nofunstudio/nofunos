// Ported from nofun-components registry/nofun-ui/blocks/charts/number-value/format.ts (verbatim logic).

export type NumberValueFormat = "decimal" | "currency" | "percent" | "compact" | "unit";

export type NumberValueFormatOptions = {
  /** `percent` follows Intl: 0.25 renders as 25%. */
  format?: NumberValueFormat | undefined;
  currency?: string | undefined;
  unit?: string | undefined;
  unitDisplay?: "short" | "narrow" | "long" | undefined;
  notation?: "standard" | "compact" | undefined;
  signDisplay?: "auto" | "always" | "exceptZero" | "negative" | "never" | undefined;
  locale?: string | undefined;
  minimumFractionDigits?: number | undefined;
  maximumFractionDigits?: number | undefined;
};

/** Pure formatter behind `NumberValue`, exported for tooltips, axis ticks and labels. */
export function formatNumberValue(
  value: number,
  {
    format = "decimal",
    currency = "USD",
    unit,
    unitDisplay = "short",
    notation,
    signDisplay,
    locale = "en-US",
    minimumFractionDigits,
    maximumFractionDigits,
  }: NumberValueFormatOptions = {},
): string {
  const options: Intl.NumberFormatOptions = {};
  if (signDisplay !== undefined) options.signDisplay = signDisplay;
  if (minimumFractionDigits !== undefined) options.minimumFractionDigits = minimumFractionDigits;
  if (maximumFractionDigits !== undefined) options.maximumFractionDigits = maximumFractionDigits;
  if (notation) {
    options.notation = notation;
    if (notation === "compact" && maximumFractionDigits === undefined)
      options.maximumFractionDigits = 1;
  }
  if (format === "currency") {
    options.style = "currency";
    options.currency = currency;
  } else if (format === "percent") {
    options.style = "percent";
  } else if (format === "compact") {
    options.notation = "compact";
    if (maximumFractionDigits === undefined) options.maximumFractionDigits = 1;
  } else if (format === "unit" && unit) {
    options.style = "unit";
    options.unit = unit;
    options.unitDisplay = unitDisplay;
  }
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Bad currency/unit/locale input never breaks a dashboard.
    return String(value);
  }
}
