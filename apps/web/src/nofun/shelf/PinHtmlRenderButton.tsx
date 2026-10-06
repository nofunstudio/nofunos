import type { EnvironmentId } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { PinIcon } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../../components/ui/button";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { sideQuestShelfCommand } from "./shelfState";

/**
 * Pins an HTML render to the Side Quest shelf. The server copies the page, so
 * the pin survives deleting this thread.
 */
export function PinHtmlRenderButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId?: string | undefined;
  readonly htmlRender: HtmlRenderReference;
}) {
  const run = useAtomCommand(sideQuestShelfCommand, { reportFailure: false });
  const [state, setState] = useState<"idle" | "pinning" | "pinned">("idle");
  const label = state === "pinned" ? "Pinned to Side Quest" : "Pin to Side Quest";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            size="icon-xs"
            variant="glass"
            disabled={state !== "idle"}
            onClick={async () => {
              setState("pinning");
              const result = await run({
                environmentId: props.environmentId,
                input: {
                  op: "pin",
                  attachmentId: props.htmlRender.attachmentId,
                  title: props.htmlRender.title,
                  ...(props.threadId === undefined ? {} : { sourceThreadId: props.threadId }),
                },
              });
              if (result._tag === "Success") {
                setState("pinned");
                toastManager.add({ type: "success", title: "Pinned to Side Quest" });
              } else {
                setState("idle");
                toastManager.add({ type: "error", title: "Could not pin this page" });
              }
            }}
          />
        }
      >
        <PinIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="left">{label}</TooltipPopup>
    </Tooltip>
  );
}
