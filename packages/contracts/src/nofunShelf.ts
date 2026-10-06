/**
 * Side Quest shelf: pinned visual outputs (HTML renders) that outlive the
 * thread that produced them. A pin owns a snapshot of the rendered bytes, so
 * deleting the source thread never leaves a dead card.
 *
 * One RPC carries every shelf operation so the wire surface stays small.
 *
 * @module NofunShelf
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SideQuestRevision = Schema.Struct({
  /** 1-based, increasing. */
  revision: NonNegativeInt,
  /** Shelf-owned attachment id; mints asset URLs like any HTML render. */
  attachmentId: Schema.String,
  /** sha256 of the stored page bytes. */
  inputHash: Schema.String,
  /** Theme the page was rendered under, when the caller knows it. */
  theme: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type SideQuestRevision = typeof SideQuestRevision.Type;

export const SideQuestPin = Schema.Struct({
  id: Schema.String,
  sourceThreadId: Schema.NullOr(Schema.String),
  title: Schema.String,
  createdAt: Schema.String,
  /** Last-good output is always `revisions[currentRevision - 1]`. */
  revisions: Schema.Array(SideQuestRevision),
  currentRevision: NonNegativeInt,
});
export type SideQuestPin = typeof SideQuestPin.Type;

export const SideQuestShelfInput = Schema.Union([
  Schema.Struct({ op: Schema.Literal("list") }),
  Schema.Struct({ op: Schema.Literal("get"), pinId: TrimmedNonEmptyString }),
  Schema.Struct({
    op: Schema.Literal("pin"),
    /** An existing html_render attachment; its bytes are copied. */
    attachmentId: TrimmedNonEmptyString,
    title: Schema.String,
    sourceThreadId: Schema.optional(Schema.String),
    theme: Schema.optional(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("unpin"), pinId: TrimmedNonEmptyString }),
  Schema.Struct({
    op: Schema.Literal("addRevision"),
    pinId: TrimmedNonEmptyString,
    /** Rejected as a conflict when the pin has moved on since the caller read it. */
    expectedRevision: NonNegativeInt,
    attachmentId: TrimmedNonEmptyString,
    theme: Schema.optional(Schema.String),
  }),
]);
export type SideQuestShelfInput = typeof SideQuestShelfInput.Type;

export const SideQuestShelfResult = Schema.Struct({
  pins: Schema.Array(SideQuestPin),
  /** The pin an operation created or changed, when it has one. */
  pin: Schema.NullOr(SideQuestPin),
});
export type SideQuestShelfResult = typeof SideQuestShelfResult.Type;

export class SideQuestShelfError extends Schema.TaggedError<SideQuestShelfError>()(
  "SideQuestShelfError",
  {
    reason: Schema.Literals(["not_found", "source_missing", "conflict", "store"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const WsNofunShelfRpc = Rpc.make("nofun.shelf", {
  payload: SideQuestShelfInput,
  success: SideQuestShelfResult,
  error: Schema.Union([SideQuestShelfError, EnvironmentAuthorizationError]),
});
