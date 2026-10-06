import type { TerminalContextSelection } from "~/lib/terminalContext";
import type { WarpGuestMessage } from "./protocol.ts";

type AskInT3 = Extract<WarpGuestMessage, { type: "askInT3" }>;

/**
 * Turns a Warp block into the composer's terminal context. Unknown metadata is
 * written as "unknown", never guessed. Output is terminal data, not
 * instructions; the label and header make its origin visible to the user.
 */
export function buildWarpTerminalContext(input: {
  readonly message: AskInT3;
  readonly terminalId: string;
  readonly sessionLabel: string;
  /** The thread's project directory the session started in. */
  readonly workspaceRoot: string;
}): TerminalContextSelection {
  const { message } = input;
  const header = [
    `Warp session: ${input.sessionLabel}`,
    `Workspace root: ${input.workspaceRoot}`,
    `Working directory (observed by the shell): ${message.cwd ?? "unknown"}`,
    `Exit code: ${message.exitCode === null ? "unknown" : String(message.exitCode)}`,
    ...(message.outputTruncated ? ["Output: truncated to the last 16 KiB"] : []),
  ];
  const lines = [
    ...header,
    "",
    `$ ${message.command ?? "(command unknown)"}`,
    message.output.replace(/\r\n/g, "\n").replace(/\n+$/, ""),
  ];
  const text = lines.join("\n");
  return {
    terminalId: input.terminalId,
    terminalLabel: `Warp ${input.sessionLabel}`,
    lineStart: 1,
    lineEnd: Math.max(1, text.split("\n").length),
    text,
  };
}
