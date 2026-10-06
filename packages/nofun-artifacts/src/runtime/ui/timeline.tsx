// Ported from nofun-components registry/nofun-ui/blocks/data/timeline/timeline.tsx. Classes and parts are
// verbatim; Base UI useRender on TimelineItem is replaced by a plain <li>.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Badge } from "./badge.tsx";
import { Separator } from "./separator.tsx";
import { cn } from "../lib/cn.ts";

export type TimelineOrientation = "vertical" | "horizontal";
export type TimelinePlacement = "start" | "end" | "alternate";
export type TimelineSize = "sm" | "default" | "lg";
export type TimelineDensity = "compact" | "default" | "relaxed";
export type TimelineTone = "default" | "primary" | "success" | "warning" | "error" | "info";

type TimelineContextValue = {
  orientation: TimelineOrientation;
  placement: TimelinePlacement;
};

const TimelineContext = React.createContext<TimelineContextValue>({
  orientation: "vertical",
  placement: "end",
});

/* -------------------------------------------------------------------------- */
/* Root                                                                       */
/* -------------------------------------------------------------------------- */

export type TimelineProps = React.ComponentProps<"ol"> & {
  /** Axis the line runs along. */
  orientation?: TimelineOrientation;
  /** Which side of the line the content sits on. `alternate` flips every item. */
  placement?: TimelinePlacement;
  size?: TimelineSize;
  /** Space between items. */
  density?: TimelineDensity;
};

function Timeline({
  className,
  orientation = "vertical",
  placement = "end",
  size = "default",
  density = "default",
  ...props
}: TimelineProps) {
  const value = React.useMemo(() => ({ orientation, placement }), [orientation, placement]);
  return (
    <TimelineContext.Provider value={value}>
      <ol
        data-slot="timeline"
        data-orientation={orientation}
        data-placement={placement}
        data-size={size}
        data-density={density}
        className={cn(
          "group/timeline m-0 list-none p-0 text-sm [--tl-opposite:5.5rem]",
          orientation === "horizontal" &&
            "grid grid-flow-col auto-cols-[minmax(11rem,1fr)] overflow-x-auto overscroll-x-contain pb-1",
          className,
        )}
        {...props}
      />
    </TimelineContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Item                                                                       */
/* -------------------------------------------------------------------------- */

const endAligned =
  "[&>[data-slot=timeline-content]]:text-end [&>[data-slot=timeline-content]]:[--tl-justify:flex-end] [&>[data-slot=timeline-opposite]]:text-start";
const startAligned =
  "[&>[data-slot=timeline-content]]:text-start [&>[data-slot=timeline-opposite]]:text-end [&>[data-slot=timeline-opposite]]:[--tl-justify:flex-end]";

const itemVariants = cva("group/item relative grid min-w-0 text-sm [--tl-justify:flex-start]", {
  variants: {
    layout: {
      "vertical-end": `grid-cols-[auto_minmax(0,1fr)] gap-x-3 [grid-template-areas:'sep_content'] has-[>[data-slot=timeline-opposite]]:grid-cols-[var(--tl-opposite)_auto_minmax(0,1fr)] has-[>[data-slot=timeline-opposite]]:[grid-template-areas:'opp_sep_content'] ${startAligned}`,
      "vertical-start": `grid-cols-[minmax(0,1fr)_auto] gap-x-3 [grid-template-areas:'content_sep'] has-[>[data-slot=timeline-opposite]]:grid-cols-[minmax(0,1fr)_auto_var(--tl-opposite)] has-[>[data-slot=timeline-opposite]]:[grid-template-areas:'content_sep_opp'] ${endAligned}`,
      "vertical-alternate": `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 [grid-template-areas:'opp_sep_content'] even:[grid-template-areas:'content_sep_opp'] ${startAligned} even:[&>[data-slot=timeline-content]]:text-end even:[&>[data-slot=timeline-content]]:[--tl-justify:flex-end] even:[&>[data-slot=timeline-opposite]]:text-start even:[&>[data-slot=timeline-opposite]]:[--tl-justify:flex-start]`,
      "horizontal-end":
        "grid-rows-[auto_auto_1fr] gap-y-3 [grid-template-areas:'opp''sep''content']",
      "horizontal-start":
        "grid-rows-[1fr_auto_auto] gap-y-3 [grid-template-areas:'content''sep''opp']",
      "horizontal-alternate":
        "grid-rows-[1fr_auto_1fr] gap-y-3 [grid-template-areas:'opp''sep''content'] even:[grid-template-areas:'content''sep''opp']",
    },
  },
});

export type TimelineItemProps = React.ComponentProps<"li"> & {
  /** Marks the current step for assistive tech. */
  current?: boolean | undefined;
  /** Fade and rise in on mount. Use for items appended after first paint. */
  enter?: boolean | undefined;
};

function TimelineItem({ className, current, enter, ...props }: TimelineItemProps) {
  const { orientation, placement } = React.useContext(TimelineContext);
  return (
    <li
      data-slot="timeline-item"
      aria-current={current ? "step" : undefined}
      className={cn(
        itemVariants({ layout: `${orientation}-${placement}` }),
        enter &&
          "transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none motion-reduce:starting:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Separator, indicator, connector                                            */
/* -------------------------------------------------------------------------- */

function TimelineSeparator({ className, ...props }: React.ComponentProps<"div">) {
  const { orientation } = React.useContext(TimelineContext);
  return (
    <div
      data-slot="timeline-separator"
      aria-hidden="true"
      className={cn(
        "flex [grid-area:sep]",
        orientation === "vertical" ? "flex-col items-center" : "flex-row items-center",
        className,
      )}
      {...props}
    />
  );
}

const indicatorVariants = cva(
  "relative z-10 flex shrink-0 items-center justify-center rounded-full border bg-background transition-colors duration-150 ease-out motion-reduce:transition-none group-data-[size=sm]/timeline:size-5 group-data-[size=default]/timeline:size-6 group-data-[size=lg]/timeline:size-8 [&>svg]:size-3.5 group-data-[size=sm]/timeline:[&>svg]:size-3 group-data-[size=lg]/timeline:[&>svg]:size-4 [&>[data-slot=avatar]]:size-full",
  {
    variants: {
      tone: {
        default: "border-border text-muted-foreground",
        primary: "border-primary bg-primary text-primary-foreground",
        success: "border-success/35 bg-success/10 text-success",
        warning: "border-warning/35 bg-warning/10 text-warning",
        error: "border-error/35 bg-error/10 text-error",
        info: "border-info/35 bg-info/10 text-info",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export type TimelineIndicatorProps = React.ComponentProps<"span"> &
  VariantProps<typeof indicatorVariants>;

/** A dot when empty, otherwise holds an icon or an Avatar. */
function TimelineIndicator({ className, tone, children, ...props }: TimelineIndicatorProps) {
  return (
    <span
      data-slot="timeline-indicator"
      data-tone={tone ?? "default"}
      className={cn(indicatorVariants({ tone }), className)}
      {...props}
    >
      {children ?? <span className="size-1.5 rounded-full bg-current" />}
    </span>
  );
}

const connectorTone: Record<TimelineTone, string> = {
  default: "bg-foreground/20",
  primary: "bg-primary/60",
  success: "bg-success/40",
  warning: "bg-warning/40",
  error: "bg-error/40",
  info: "bg-info/40",
};

export type TimelineConnectorProps = Omit<React.ComponentProps<typeof Separator>, "orientation"> & {
  tone?: TimelineTone | undefined;
  /** Dashed for steps that have not happened yet. */
  dashed?: boolean | undefined;
};

function TimelineConnector({
  className,
  tone = "default",
  dashed,
  ...props
}: TimelineConnectorProps) {
  const { orientation } = React.useContext(TimelineContext);
  return (
    <Separator
      data-slot="timeline-connector"
      orientation={orientation}
      className={cn(
        "flex-1 group-last/item:invisible",
        orientation === "vertical" ? "min-h-3" : "min-w-3 self-auto",
        connectorTone[tone],
        dashed &&
          (orientation === "vertical"
            ? "bg-transparent! [background-image:linear-gradient(to_bottom,var(--color-border)_50%,transparent_50%)] [background-size:1px_6px]"
            : "bg-transparent! [background-image:linear-gradient(to_right,var(--color-border)_50%,transparent_50%)] [background-size:6px_1px]"),
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Content parts                                                              */
/* -------------------------------------------------------------------------- */

function TimelineContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-content"
      className={cn(
        "grid min-w-0 content-start gap-1 [grid-area:content]",
        "pt-px group-data-[size=sm]/timeline:text-xs group-data-[size=lg]/timeline:pt-1",
        "group-data-[orientation=vertical]/timeline:group-data-[density=compact]/timeline:pb-3",
        "group-data-[orientation=vertical]/timeline:group-data-[density=default]/timeline:pb-6",
        "group-data-[orientation=vertical]/timeline:group-data-[density=relaxed]/timeline:pb-9",
        "group-data-[orientation=horizontal]/timeline:pe-4 group-data-[orientation=horizontal]/timeline:text-start",
        className,
      )}
      {...props}
    />
  );
}

/** The other side of the line: dates, version numbers, quarter labels. */
function TimelineOpposite({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-opposite"
      className={cn(
        "min-w-0 text-xs text-muted-foreground [grid-area:opp] group-data-[size=lg]/timeline:text-sm",
        "pt-1 group-data-[orientation=horizontal]/timeline:pt-0 group-data-[orientation=horizontal]/timeline:text-start",
        className,
      )}
      {...props}
    />
  );
}

function TimelineHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-header"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 [justify-content:var(--tl-justify)]",
        className,
      )}
      {...props}
    />
  );
}

function TimelineTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-title"
      className={cn(
        "font-medium text-foreground group-data-[size=lg]/timeline:text-base",
        className,
      )}
      {...props}
    />
  );
}

function TimelineTime({ className, ...props }: React.ComponentProps<"time">) {
  return (
    <time
      data-slot="timeline-time"
      className={cn(
        "text-xs whitespace-nowrap text-muted-foreground tabular-nums group-data-[size=lg]/timeline:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function TimelineBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="timeline-body"
      className={cn("text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

const badgeVariant = {
  default: "neutral",
  primary: "default",
  success: "green",
  warning: "amber",
  error: "destructive",
  info: "blue",
} as const;

function TimelineBadge({
  tone = "default",
  size = "sm",
  ...props
}: Omit<React.ComponentProps<typeof Badge>, "variant"> & { tone?: TimelineTone }) {
  return <Badge data-slot="timeline-badge" variant={badgeVariant[tone]} size={size} {...props} />;
}

/** Designed empty state. Render it as the only child of Timeline. */
function TimelineEmpty({
  className,
  children = "Nothing has happened yet.",
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="timeline-empty"
      className={cn(
        "rounded-lg border border-dashed border-foreground/15 px-4 py-6 text-center text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </li>
  );
}

export {
  Timeline,
  TimelineEmpty,
  TimelineItem,
  TimelineSeparator,
  TimelineIndicator,
  TimelineConnector,
  TimelineContent,
  TimelineOpposite,
  TimelineHeader,
  TimelineTitle,
  TimelineTime,
  TimelineBody,
  TimelineBadge,
};
