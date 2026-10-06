import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { create } from "zustand";

import { Toggle } from "../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { PreviewPanelInlineSize } from "../hooks/usePreviewPanelInlineSize";
import type { RightPanelSurface } from "../rightPanelStore";

/** Share of the workspace row a No Fun artifact takes when the panel is wide. */
const WIDE_FRACTION = 0.58;
/** Mirrors the chat column floor the normal panel clamp keeps. */
const CHAT_COLUMN_MIN_WIDTH = 360;

// Module-level so every open path (card, auto-open, frame button) can mark an
// artifact before the panel renders it; only No Fun results are ever marked.
const nofunArtifactIds = new Set<string>();

export function markNofunArtifact(attachmentId: string): void {
  nofunArtifactIds.add(attachmentId);
}

const useNarrowArtifacts = create<{ readonly ids: ReadonlySet<string> }>(() => ({
  ids: new Set(),
}));

/** The active surface is a No Fun artifact, the only surface that gets the wide layout. */
export function activeNofunArtifactId(surface: RightPanelSurface | null): string | null {
  if (surface?.kind !== "file" || surface.attachment === undefined) return null;
  return nofunArtifactIds.has(surface.attachment.id) ? surface.attachment.id : null;
}

export function useNofunWidePanel(
  surface: RightPanelSurface | null,
  inlineSize: PreviewPanelInlineSize,
  containerWidth: number | undefined,
) {
  const artifactId = activeNofunArtifactId(surface);
  const narrow = useNarrowArtifacts((state) => artifactId !== null && state.ids.has(artifactId));
  const wide = artifactId !== null && !narrow;
  const container = containerWidth ?? (typeof window === "undefined" ? 1280 : window.innerWidth);
  const wideWidth = Math.max(
    inlineSize.width,
    Math.min(Math.floor(container * WIDE_FRACTION), container - CHAT_COLUMN_MIN_WIDTH),
  );
  return {
    artifactId,
    wide,
    // The stored width is untouched, so closing or switching surface restores it.
    inlineSize: wide ? { ...inlineSize, width: wideWidth } : inlineSize,
    toggle: () =>
      useNarrowArtifacts.setState((state) => {
        if (artifactId === null) return state;
        const ids = new Set(state.ids);
        if (!ids.delete(artifactId)) ids.add(artifactId);
        return { ids };
      }),
  };
}

export function NofunWidePanelToggle(props: {
  readonly wide: boolean;
  readonly onToggle: () => void;
}) {
  const label = props.wide ? "Normal artifact width" : "Wide artifact width";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={props.wide}
            onPressedChange={props.onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {props.wide ? (
              <PanelLeftCloseIcon className="size-4" />
            ) : (
              <PanelLeftOpenIcon className="size-4" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
