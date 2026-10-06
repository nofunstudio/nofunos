import type { EnvironmentId } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { PanelRightOpenIcon } from "lucide-react";

import type { ChatFileAttachment } from "~/types";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { nofunArtifactAttachment } from "./artifactDisplay";
import { NoFunMark } from "./NoFunMark";
import { PinHtmlRenderButton } from "./shelf/PinHtmlRenderButton";

/**
 * A No Fun artifact as a compact row in the thread: title, badge, and an Open
 * button for the side panel. The whole card opens it, like the frame's
 * "Open in panel" button.
 */
export function NofunArtifactCard(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly onOpen?: ((attachment: ChatFileAttachment) => void) | undefined;
  readonly pinThreadId?: string | undefined;
}) {
  const open = () => props.onOpen?.(nofunArtifactAttachment(props.htmlRender));
  return (
    <div
      role={props.onOpen ? "button" : undefined}
      tabIndex={props.onOpen ? 0 : undefined}
      aria-label={`Open ${props.htmlRender.title}`}
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-card-foreground transition-colors hover:bg-accent/40"
      onClick={open}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
    >
      <NoFunMark className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{props.htmlRender.title}</span>
      <Badge size="sm" variant="secondary">
        No Fun
      </Badge>
      {/* The pin button is its own control; it must not also open the card. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Stops the card's click only. */}
      <span
        className="flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {props.pinThreadId === undefined ? null : (
          <PinHtmlRenderButton
            environmentId={props.environmentId}
            threadId={props.pinThreadId}
            htmlRender={props.htmlRender}
          />
        )}
        {props.onOpen === undefined ? null : (
          <Button size="xs" variant="outline" onClick={open}>
            <PanelRightOpenIcon className="size-3.5" />
            Open
          </Button>
        )}
      </span>
    </div>
  );
}
