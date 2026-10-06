// Chart: the real No Fun chart blocks (blocks/charts/chart-bar, chart-area, chart-line on Recharts),
// framed by their shared shell: ChartFrame card, header with title, description, headline value and
// legend, then the plot.
import { ChartAreaPlot } from "@nofun/ui/chart-area";
import {
  ChartDescription,
  ChartFrame,
  ChartHeader,
  ChartHeading,
  ChartLegendList,
  ChartTitle,
  ChartValue,
  formatCompact,
  type ChartSeries,
} from "@nofun/ui/chart-area/chart-shell";
import { ChartBarPlot } from "@nofun/ui/chart-bar";
import { ChartLinePlot } from "@nofun/ui/chart-line";
import { formatNumberValue } from "@nofun/ui/number-value/format";

type ChartDatum = Record<string, string | number | null>;

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
  const plot = { data, xKey, series, height: height ?? 240, yFormatter: formatter, label: title };
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
      {type === "line" ? (
        <ChartLinePlot {...plot} />
      ) : type === "area" ? (
        <ChartAreaPlot {...plot} stacked={stacked} />
      ) : (
        <ChartBarPlot {...plot} stacked={stacked} />
      )}
    </ChartFrame>
  );
}
