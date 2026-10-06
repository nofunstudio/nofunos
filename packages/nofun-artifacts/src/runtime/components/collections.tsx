// Gallery, Comparison and Timeline.
// - Gallery follows blocks/gallery/caption-mosaic: tall photo tiles on the brand radius, a slow hover
//   zoom, and the accent caption tile docked at the foot (bg-accent-brand, micro type).
// - Comparison generalizes blocks/product/compare-table from products to any columns: the Kobra Table
//   with a micro row header on wide frames, stacked cards on narrow ones, plus a "differences only"
//   toggle.
// - Timeline wraps the ported blocks/data/timeline parts.
import * as React from "react";

import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import {
  Timeline as TimelineRoot,
  TimelineBadge,
  TimelineBody,
  TimelineConnector,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineOpposite,
  TimelineSeparator,
  TimelineTime,
  TimelineTitle,
  type TimelineTone,
} from "../ui/timeline.tsx";
import { cn } from "../lib/cn.ts";
import { IconCheck, IconMinus } from "../lib/icons.tsx";

/* Gallery */

export type GalleryItem = {
  /** An https URL, a data: URI, or an absolute local image path (T3 inlines local images). */
  src: string;
  alt: string;
  caption?: string | undefined;
  href?: string | undefined;
};

export type GalleryProps = {
  items: GalleryItem[];
  columns?: number | undefined;
  aspect?: "square" | "portrait" | "landscape" | undefined;
  className?: string | undefined;
};

const ASPECT = {
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
} as const;

export function Gallery({ items, columns = 3, aspect = "portrait", className }: GalleryProps) {
  const cols = Math.max(1, Math.min(4, Math.round(columns)));
  return (
    <ul
      data-slot="gallery"
      className={cn("m-0 grid list-none gap-3 p-0", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, max(150px, calc((100% - ${cols - 1} * 0.75rem) / ${cols}))), 1fr))`,
      }}
    >
      {items.map((item, index) => {
        const tile = (
          <>
            <img
              src={item.src}
              alt={item.alt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-(--ease-out) motion-reduce:transition-none [@media(hover:hover)]:group-hover/photo:scale-[1.04]"
            />
            {item.caption ? (
              <span className="micro absolute inset-x-0 bottom-0 flex flex-col justify-between gap-4 bg-accent-brand p-3 text-[0.66rem] text-accent-brand-foreground">
                <span>{item.caption}</span>
                <span aria-hidden="true" className="h-px w-8 bg-current" />
              </span>
            ) : null}
          </>
        );
        return (
          <li
            key={`${item.src}-${index}`}
            className={cn(
              "group/photo relative overflow-hidden rounded-brand bg-surface-product ring-1 ring-foreground/10",
              ASPECT[aspect],
            )}
          >
            {item.href ? (
              <a
                href={item.href}
                className="absolute inset-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {tile}
              </a>
            ) : (
              tile
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* Comparison */

export type ComparisonValue = string | number | boolean | null;

export type ComparisonColumn = {
  title: string;
  subtitle?: string | undefined;
  badge?: string | undefined;
  /** Marks the recommended option. */
  highlight?: boolean | undefined;
};

export type ComparisonRow = { label: string; values: ComparisonValue[] };

export type ComparisonProps = {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  caption?: string | undefined;
  /** Offer a "Differences only" toggle. Default true when there are more than three rows. */
  diffToggle?: boolean | undefined;
  className?: string | undefined;
};

function ComparisonCell({ value }: { value: ComparisonValue }) {
  if (value === true) return <IconCheck aria-label="Yes" className="size-4 text-success" />;
  if (value === false)
    return <IconMinus aria-label="No" className="size-4 text-muted-foreground" />;
  if (value === null || value === "") return <span className="text-muted-foreground">—</span>;
  return <>{typeof value === "number" ? value.toLocaleString("en-US") : value}</>;
}

function ColumnHead({ column }: { column: ComparisonColumn }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base leading-tight text-foreground [text-transform:var(--nf-display-transform)]">
          {column.title}
        </span>
        {column.badge ? (
          <Badge size="sm" variant={column.highlight ? "default" : "secondary"}>
            {column.badge}
          </Badge>
        ) : null}
      </div>
      {column.subtitle ? (
        <span className="text-sm text-muted-foreground">{column.subtitle}</span>
      ) : null}
    </div>
  );
}

export function Comparison({ columns, rows, caption, diffToggle, className }: ComparisonProps) {
  const [diffOnly, setDiffOnly] = React.useState(false);
  const showToggle = diffToggle ?? rows.length > 3;
  const lines = diffOnly
    ? rows.filter((row) => new Set(row.values.map((value) => JSON.stringify(value))).size > 1)
    : rows;
  return (
    <section
      aria-label={caption ?? "Comparison"}
      data-slot="comparison"
      className={cn("@container grid min-w-0 gap-3", className)}
    >
      {caption || showToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {caption ? <p className="micro m-0 text-muted-foreground">{caption}</p> : <span />}
          {showToggle ? (
            <Button
              size="xs"
              variant={diffOnly ? "default" : "outline"}
              aria-pressed={diffOnly}
              onClick={() => setDiffOnly((on) => !on)}
            >
              Differences only
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="hidden @min-[560px]:block">
        <Table aria-label={caption ?? "Comparison"}>
          <TableHeader className="bg-transparent">
            <TableRow>
              <TableHead className="w-36">
                <span className="sr-only">Attribute</span>
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.title}
                  scope="col"
                  className={cn(
                    "h-auto py-4 align-top whitespace-normal",
                    column.highlight && "bg-accent-brand-soft",
                  )}
                >
                  <ColumnHead column={column} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((row) => (
              <TableRow key={row.label}>
                <TableHead
                  scope="row"
                  className="micro h-auto py-3 align-top font-normal whitespace-normal text-muted-foreground"
                >
                  {row.label}
                </TableHead>
                {columns.map((column, i) => (
                  <TableCell
                    key={column.title}
                    className={cn(
                      "h-auto py-3 align-top whitespace-normal text-foreground",
                      column.highlight && "bg-accent-brand-soft/60",
                    )}
                  >
                    <ComparisonCell value={row.values[i] ?? null} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0 @min-[560px]:hidden">
        {columns.map((column, i) => (
          <li
            key={column.title}
            className={cn(
              "grid gap-3 rounded-brand border border-border p-4",
              column.highlight && "border-foreground/40 bg-accent-brand-soft",
            )}
          >
            <ColumnHead column={column} />
            <dl className="m-0 grid gap-2 border-t border-border pt-3">
              {lines.map((row) => (
                <div key={row.label} className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
                  <dt className="micro text-muted-foreground">{row.label}</dt>
                  <dd className="m-0 tabular text-foreground">
                    <ComparisonCell value={row.values[i] ?? null} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* Timeline */

export type TimelineEntry = {
  title: string;
  time?: string | undefined;
  body?: string | undefined;
  tone?: TimelineTone | undefined;
  badge?: string | undefined;
  /** Marks the current step. */
  current?: boolean | undefined;
  /** Not happened yet: dashed connector. */
  pending?: boolean | undefined;
};

export type TimelineProps = {
  items: TimelineEntry[];
  orientation?: "vertical" | "horizontal" | undefined;
  /** Put times on the other side of the line (vertical only). */
  opposite?: boolean | undefined;
  size?: "sm" | "default" | "lg" | undefined;
  className?: string | undefined;
};

export function Timeline({
  items,
  orientation = "vertical",
  opposite = false,
  size = "default",
  className,
}: TimelineProps) {
  const useOpposite = opposite && orientation === "vertical";
  return (
    <TimelineRoot orientation={orientation} size={size} className={className}>
      {items.map((item, index) => (
        <TimelineItem key={`${item.title}-${index}`} current={item.current}>
          {useOpposite && item.time ? <TimelineOpposite>{item.time}</TimelineOpposite> : null}
          <TimelineSeparator>
            <TimelineIndicator tone={item.current ? "primary" : (item.tone ?? "default")} />
            <TimelineConnector
              dashed={item.pending}
              tone={item.pending ? "default" : (item.tone ?? "default")}
            />
          </TimelineSeparator>
          <TimelineContent>
            <TimelineHeader>
              <TimelineTitle>{item.title}</TimelineTitle>
              {item.badge ? (
                <TimelineBadge tone={item.tone ?? "default"}>{item.badge}</TimelineBadge>
              ) : null}
              {!useOpposite && item.time ? <TimelineTime>{item.time}</TimelineTime> : null}
            </TimelineHeader>
            {item.body ? <TimelineBody>{item.body}</TimelineBody> : null}
          </TimelineContent>
        </TimelineItem>
      ))}
    </TimelineRoot>
  );
}
