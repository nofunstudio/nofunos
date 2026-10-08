/**
 * Which agent the Agents sidebar is showing in detail, per thread. Session-only
 * UI state: the thread details panel and the sidebar list both set it, the
 * sidebar reads it, and the back arrow clears it.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export type FleetFocus =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "background"; readonly taskId: string };

interface FleetFocusState {
  readonly byThreadKey: Readonly<Record<string, FleetFocus>>;
  readonly setFocus: (ref: ScopedThreadRef, focus: FleetFocus | null) => void;
}

export const useFleetFocusStore = create<FleetFocusState>()((set) => ({
  byThreadKey: {},
  setFocus: (ref, focus) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const { [key]: _removed, ...rest } = state.byThreadKey;
      return { byThreadKey: focus === null ? rest : { ...rest, [key]: focus } };
    }),
}));

export function useFleetFocus(ref: ScopedThreadRef): FleetFocus | null {
  return useFleetFocusStore((state) => state.byThreadKey[scopedThreadKey(ref)] ?? null);
}
