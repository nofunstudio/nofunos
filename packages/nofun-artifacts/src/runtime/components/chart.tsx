// Chart: the No Fun chart-bar/chart-area block shape (ChartFrame card, header with title, description,
// headline value and legend, then the plot), drawn by the ported SVG plot in ui/chart.tsx.
import {
  ChartDescription,
  ChartFrame,
  ChartHeader,
  ChartHeading,
  ChartLegendList,
  ChartPlot,
  ChartTitle,
  ChartValue,
  formatCompact,
  type ChartDatum,
  type ChartSeries,
} from "../ui/chart.tsx";
import { formatNumberValue } from "../lib/format.ts";

export type ChartProps = {
  type?: "bar" | "line" | "area" | undefined;
  title?: string | undefined;
  description?: string | undefined;
  /** Headline number shown under the title, already formatted ("$48.2K"). */
  value?: string | undefined;
  data: ChartDatum[];
  xKey: string;
  series: ChartSeries[];
  stacked?: boolean | undefined;
  height?: number | undefined;
  valueFormat?: "decimal" | "compact" | "currency" | "percent" | undefined;
  currency?: string | undefined;
  /** Defaults to on when there is more than one series. */
  legend?: boolean | undefined;
  /** `plain` drops the card so the chart sits on the page. */
  variant?: "card" | "plain" | undefined;
  className?: string | undefined;
};

export function Chart({
  type = "bar",
  title,
  description,
  value,
  data,
  xKey,
  series,
  stacked,
  height,
  valueFormat = "compact",
  currency,
  legend,
  variant = "card",
  className,
}: ChartProps) {
  const showLegend = legend ?? series.length > 1;
  const formatter =
    valueFormat === "compact"
      ? formatCompact
      : (n: number) =>
          formatNumberValue(n, {
            format: valueFormat,
            currency,
            notation: valueFormat === "currency" ? "compact" : undefined,
            maximumFractionDigits: valueFormat === "percent" ? 0 : 1,
          });
  const hasHeader = Boolean(title || description || value || showLegend);
  return (
    <ChartFrame variant={variant} className={className}>
      {hasHeader ? (
        <ChartHeader>
          <ChartHeading>
            {title ? <ChartTitle>{title}</ChartTitle> : null}
            {description ? <ChartDescription>{description}</ChartDescription> : null}
            {value ? <ChartValue className="mt-1">{value}</ChartValue> : null}
          </ChartHeading>
          {showLegend ? <ChartLegendList series={series} /> : null}
        </ChartHeader>
      ) : null}
      <ChartPlot
        type={type}
        data={data}
        xKey={xKey}
        series={series}
        stacked={stacked}
        height={height ?? 240}
        valueFormatter={formatter}
        label={title}
      />
    </ChartFrame>
  );
}
