// Ported from nofun-components components/ui/skeleton.tsx (Kobra Skeleton). Only imports changed.
import type * as React from "react";
import { cn } from "../lib/cn.ts";

type Surface = "background" | "shell";

function Skeleton({
  className,
  on = "background",
  ...props
}: React.ComponentProps<"div"> & { on?: Surface }) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "skeleton-shimmer rounded-md",
        on === "shell" ? "bg-shell-line-strong" : "bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
