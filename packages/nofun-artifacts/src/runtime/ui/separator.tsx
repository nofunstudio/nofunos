// Ported from nofun-components components/ui/separator.tsx (Kobra Separator). Base UI's
// Separator primitive is replaced by a div with the same role and data attributes.
import type * as React from "react";

import { cn } from "../lib/cn.ts";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cn(
        "shrink-0 bg-foreground/15 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
