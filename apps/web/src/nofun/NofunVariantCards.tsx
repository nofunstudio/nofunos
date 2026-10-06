import type { EnvironmentId } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";

import type { ChatFileAttachment } from "~/types";

import { NofunArtifactCard } from "./NofunArtifactCard";

/** Every variant a No Fun variants tool published, as a compact horizontal set of labelled cards. */
export function NofunVariantCards(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRenders: ReadonlyArray<HtmlRenderReference>;
  readonly onOpen?: ((attachment: ChatFileAttachment) => void) | undefined;
  readonly pinThreadId?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
      {props.htmlRenders.map((htmlRender, index) => (
        <div key={htmlRender.attachmentId} className="w-72 shrink-0">
          <NofunArtifactCard
            environmentId={props.environmentId}
            htmlRender={htmlRender}
            onOpen={props.onOpen}
            pinThreadId={props.pinThreadId}
            label={`Variant ${index + 1}`}
          />
        </div>
      ))}
    </div>
  );
}
