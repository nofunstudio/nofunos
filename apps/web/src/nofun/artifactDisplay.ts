import type { NofunArtifactMode } from "@t3tools/contracts/settings";
import {
  htmlRenderFileName,
  type HtmlRenderDisplay,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { useEffect } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import type { ChatFileAttachment } from "~/types";

/** A result this fresh arrived live; older ones are history reloading. */
const LIVE_WINDOW_MS = 30_000;

// Module-level so a recycled or remounted row never opens a page twice.
const handledAttachmentIds = new Set<string>();

export interface NofunArtifactBehavior {
  readonly display: HtmlRenderDisplay;
  readonly autoOpen: boolean;
}

/**
 * How a No Fun artifact shows in the thread. The client setting overrides the
 * tool call's hints; `agent` follows them. A reference without hints (T3's own
 * `html_render`, or an old stored result) always stays inline.
 */
export function resolveNofunArtifactBehavior(
  htmlRender: HtmlRenderReference,
  mode: NofunArtifactMode,
): NofunArtifactBehavior {
  // Only No Fun results carry a display; T3's own html_render stays as it was.
  if (htmlRender.display === undefined) return { display: "inline", autoOpen: false };
  switch (mode) {
    case "inline":
      return { display: "inline", autoOpen: false };
    case "card":
      return { display: "card", autoOpen: false };
    case "card-open":
      return { display: "card", autoOpen: true };
    case "agent":
      return {
        display: htmlRender.display,
        autoOpen: htmlRender.autoOpen === true,
      };
  }
}

export function nofunArtifactAttachment(htmlRender: HtmlRenderReference): ChatFileAttachment {
  return {
    type: "file",
    id: htmlRender.attachmentId,
    name: htmlRenderFileName(htmlRender.title),
    mimeType: "text/html",
    // Unknown here; the preview leaves it out.
    sizeBytes: 0,
    htmlRender: true,
  };
}

function isTypingInComposer() {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT")
  );
}

/**
 * Resolves a row's behavior and, once per attachment, opens it in the side
 * panel when it arrived live. Never steals focus: while the reader is typing,
 * the artifact is left shown but unopened.
 */
export function useNofunArtifactBehavior(
  htmlRender: HtmlRenderReference,
  createdAt: string,
  onOpen: ((attachment: ChatFileAttachment) => void) | undefined,
): NofunArtifactBehavior {
  const mode = useClientSettings((settings) => settings.nofunArtifactMode);
  const behavior = resolveNofunArtifactBehavior(htmlRender, mode);
  const { attachmentId } = htmlRender;
  useEffect(() => {
    if (handledAttachmentIds.has(attachmentId)) return;
    handledAttachmentIds.add(attachmentId);
    if (!behavior.autoOpen || onOpen === undefined) return;
    if (Date.now() - Date.parse(createdAt) > LIVE_WINDOW_MS) return;
    if (isTypingInComposer()) return;
    onOpen(nofunArtifactAttachment(htmlRender));
  }, [attachmentId, behavior.autoOpen, createdAt, htmlRender, onOpen]);
  return behavior;
}
