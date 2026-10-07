import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadProjection } from "../../state/entities";
import { deriveBackgroundRows, type BackgroundRow } from "./backgroundModel";

/** The thread's background work; re-derived only when its projection changes. */
export function useBackgroundRows(ref: ScopedThreadRef): ReadonlyArray<BackgroundRow> {
  const projection = useThreadProjection(ref)?.projection ?? null;
  return useMemo(
    () => (projection === null ? [] : deriveBackgroundRows(projection, Date.now())),
    [projection],
  );
}
