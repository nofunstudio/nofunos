import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

/** Every Side Quest shelf operation (list, pin, unpin, addRevision) in one command. */
export const sideQuestShelfCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:nofun:shelf",
  tag: WS_METHODS.nofunShelf,
});
