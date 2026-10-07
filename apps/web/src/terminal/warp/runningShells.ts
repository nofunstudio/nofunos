import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { terminalEnvironment } from "~/state/terminal";

/**
 * Warp terminal ids of a thread whose shell is running a command right now.
 * Warp draws its own tab titles, so this is only used to ask before a close
 * shortcut kills a running process.
 */
export function useBusyWarpTerminalIds(
  environmentId: EnvironmentId,
  threadId: string,
): ReadonlySet<string> {
  const metadata = useEnvironmentQuery(
    terminalEnvironment.metadata({ environmentId, input: null }),
  );
  return useMemo(
    () =>
      new Set(
        (metadata.data ?? [])
          .filter((summary) => summary.threadId === threadId && summary.hasRunningSubprocess)
          .map((summary) => summary.terminalId),
      ),
    [metadata.data, threadId],
  );
}
