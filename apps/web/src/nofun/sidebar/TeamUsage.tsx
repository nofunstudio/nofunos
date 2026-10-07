import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  formatResetsIn,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { useMemo } from "react";

import { ClaudeAI, OpenAI } from "../../components/Icons";
import { providerTextColorClassName } from "../../components/chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { barColor } from "../../components/usage/UsageLimits";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { personaIdOf } from "./teams";
import { teamUsageRows, type TeamUsageRow } from "./TeamUsage.logic";

function windowSummary(name: string, window: ServerProviderUsageWindow | null, now: number) {
  if (!window) return null;
  const resetsIn = formatResetsIn(window, now);
  return `${name} ${remainingPercent(window)}% left${resetsIn ? `, ${resetsIn}` : ""}`;
}

/** One window as a hairline bar of quota left and its percentage. */
function WindowMeter(props: {
  readonly label: string;
  readonly color: string;
  readonly window: ServerProviderUsageWindow | null;
}) {
  const remaining = props.window ? remainingPercent(props.window) : null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="w-3 shrink-0 text-sidebar-muted-foreground/70">{props.label}</span>
      <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
        {remaining ? (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${remaining}%`, backgroundColor: props.color }}
          />
        ) : null}
      </span>
      <span
        className={cn(
          "w-7 shrink-0 text-right tabular-nums",
          remaining !== null && remaining <= 10 && "text-destructive-foreground",
        )}
      >
        {remaining === null ? "–" : `${remaining}%`}
      </span>
    </span>
  );
}

function UsageRow({ row, now }: { readonly row: TeamUsageRow; readonly now: number }) {
  const { account } = row;
  const Glyph = account.driver === "codex" ? OpenAI : ClaudeAI;
  const name = account.displayName ?? (account.driver === "codex" ? "Codex" : "Claude");
  const summary = [
    name,
    windowSummary("5h", row.session, now),
    windowSummary("Weekly", row.weekly, now),
  ]
    .filter(Boolean)
    .join(" · ");
  const color = barColor(account.driver);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={summary}
            className="grid cursor-default grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-2"
          />
        }
      >
        <span className="flex items-center">
          <Glyph aria-hidden className={cn("size-3", providerTextColorClassName(account.driver))} />
          {row.ordinal ? (
            <span className="-mt-1.5 ml-px text-4xs leading-none font-semibold">{row.ordinal}</span>
          ) : null}
        </span>
        <WindowMeter label="5h" color={color} window={row.session} />
        <WindowMeter label="W" color={color} window={row.weekly} />
      </TooltipTrigger>
      <TooltipPopup side="right">{summary}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Subscription quota for one team's accounts, pinned under its half of the
 * sidebar: five-hour and weekly bars per Claude and Codex account. Hover a row
 * for its account and reset times; the Usage page has the full view.
 */
export function TeamUsage({ teamId }: { readonly teamId: string }) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  // `now` is taken with the rows: they re-read when a provider reports new
  // limits, and the reset countdown on hover is as fresh as that.
  const { rows, now } = useMemo(() => {
    const team = new Map(
      [...presentations].filter(
        ([, presentation]) =>
          personaIdOf(presentation.serverConfig?.environment.persona) === teamId,
      ),
    );
    return { rows: teamUsageRows(collectLimitAccounts(team)), now: Date.now() };
  }, [presentations, teamId]);
  if (rows.length === 0) return null;
  return (
    <div
      data-sidebar-team-usage={teamId}
      className="flex shrink-0 flex-col gap-1 px-3 pt-1.5 pb-2 text-3xs text-sidebar-muted-foreground"
    >
      {rows.map((row) => (
        <UsageRow key={row.account.key} row={row} now={now} />
      ))}
    </div>
  );
}
