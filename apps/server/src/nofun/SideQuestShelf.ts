// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  SideQuestPin,
  SideQuestShelfError,
  type SideQuestRevision,
  type SideQuestShelfInput,
  type SideQuestShelfResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import {
  createAttachmentId,
  parseAttachmentFileExtension,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";

/**
 * Pinned visual outputs. A pin owns a snapshot of the rendered page, stored
 * as an attachment under the reserved `shelf` thread segment, so thread
 * deletion (which only removes ids minted for that thread) never touches it
 * and the existing asset-URL machinery serves it unchanged. Only unpinning
 * deletes the owned bytes. Pin metadata is one JSON file in the state dir.
 */
const SHELF_THREAD_SEGMENT = "shelf";
const SHELF_FILE = "side-quest-shelf.json";
const MAX_TITLE_LENGTH = 200;

const ShelfFile = Schema.Struct({
  version: Schema.Literal(1),
  pins: Schema.Array(SideQuestPin),
});
const decodeShelfFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ShelfFile));
const encodeShelfFile = Schema.encodeSync(Schema.fromJsonString(ShelfFile));

const fail = (reason: SideQuestShelfError["reason"], detail: string) =>
  new SideQuestShelfError({ reason, detail });

export class SideQuestShelf extends Context.Service<
  SideQuestShelf,
  {
    /** One entry point for every shelf operation, so transports stay thin. */
    readonly run: (
      input: SideQuestShelfInput,
    ) => Effect.Effect<SideQuestShelfResult, SideQuestShelfError>;
  }
>()("t3/nofun/SideQuestShelf") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const lock = yield* Semaphore.make(1);
  const shelfPath = path.join(config.stateDir, "nofun", SHELF_FILE);

  const storeError = (cause: unknown) => fail("store", `Side Quest shelf storage failed: ${cause}`);

  const load = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(shelfPath);
    if (!exists) return [] as ReadonlyArray<SideQuestPin>;
    const text = yield* fileSystem.readFileString(shelfPath);
    // A file this build cannot read is refused, never overwritten.
    return (yield* decodeShelfFile(text)).pins;
  }).pipe(Effect.mapError(storeError));

  const save = (pins: ReadonlyArray<SideQuestPin>) =>
    writeFileStringAtomically({
      filePath: shelfPath,
      contents: encodeShelfFile({ version: 1, pins }),
    }).pipe(Effect.provideContext(services), Effect.mapError(storeError));

  /** Copies a thread-owned html render into a new shelf-owned attachment. */
  const snapshot = Effect.fn("SideQuestShelf.snapshot")(function* (
    sourceAttachmentId: string,
    theme: string | undefined,
  ) {
    if (parseAttachmentFileExtension(sourceAttachmentId) !== "html") {
      return yield* fail("source_missing", "Only HTML renders can be pinned.");
    }
    const sourcePath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: sourceAttachmentId,
    });
    if (sourcePath === null) {
      return yield* fail("source_missing", "That HTML render no longer exists.");
    }
    const bytes = yield* fileSystem.readFile(sourcePath).pipe(Effect.mapError(storeError));
    const attachmentId = createAttachmentId(SHELF_THREAD_SEGMENT, "html");
    const targetPath =
      attachmentId === null
        ? null
        : resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}.html`,
          });
    if (attachmentId === null || targetPath === null) {
      return yield* fail("store", "Could not allocate a shelf attachment.");
    }
    yield* fileSystem.writeFile(targetPath, bytes).pipe(Effect.mapError(storeError));
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    return {
      attachmentId,
      inputHash: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
      theme: theme ?? null,
      createdAt,
    } satisfies Omit<SideQuestRevision, "revision">;
  });

  const removeOwned = (attachmentId: string) =>
    Effect.gen(function* () {
      const filePath = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId,
      });
      if (filePath !== null) yield* fileSystem.remove(filePath, { force: true });
    }).pipe(Effect.ignore);

  const result = (pins: ReadonlyArray<SideQuestPin>, pin: SideQuestPin | null) =>
    ({
      // Newest first.
      pins: pins.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
      pin,
    }) satisfies SideQuestShelfResult;

  const run = Effect.fn("SideQuestShelf.run")(function* (input: SideQuestShelfInput) {
    const pins = yield* load;
    const find = (pinId: string) => {
      const pin = pins.find((candidate) => candidate.id === pinId);
      return pin === undefined
        ? Effect.fail(fail("not_found", "That pin is not on the shelf."))
        : Effect.succeed(pin);
    };
    switch (input.op) {
      case "list":
        return result(pins, null);
      case "get":
        return result(pins, yield* find(input.pinId));
      case "pin": {
        const revision = yield* snapshot(input.attachmentId, input.theme);
        const pin: SideQuestPin = {
          id: NodeCrypto.randomUUID(),
          sourceThreadId: input.sourceThreadId ?? null,
          title: input.title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled",
          createdAt: revision.createdAt,
          revisions: [{ revision: 1, ...revision }],
          currentRevision: 1,
        };
        const next = [...pins, pin];
        yield* save(next).pipe(Effect.onError(() => removeOwned(revision.attachmentId)));
        return result(next, pin);
      }
      case "unpin": {
        const pin = yield* find(input.pinId);
        const next = pins.filter((candidate) => candidate.id !== pin.id);
        yield* save(next);
        // Metadata first: a crash here leaves an orphan file, never a dead card.
        yield* Effect.forEach(pin.revisions, (revision) => removeOwned(revision.attachmentId), {
          discard: true,
        });
        return result(next, null);
      }
      case "addRevision": {
        const pin = yield* find(input.pinId);
        if (pin.currentRevision !== input.expectedRevision) {
          return yield* fail(
            "conflict",
            `The pin is at revision ${pin.currentRevision}, not ${input.expectedRevision}. Reload it and try again.`,
          );
        }
        // The last-good revision stays current until the new snapshot exists.
        const revision = yield* snapshot(input.attachmentId, input.theme);
        const updated: SideQuestPin = {
          ...pin,
          revisions: [...pin.revisions, { revision: pin.currentRevision + 1, ...revision }],
          currentRevision: pin.currentRevision + 1,
        };
        const next = pins.map((candidate) => (candidate.id === pin.id ? updated : candidate));
        yield* save(next).pipe(Effect.onError(() => removeOwned(revision.attachmentId)));
        return result(next, updated);
      }
    }
  });

  return SideQuestShelf.of({ run: (input) => lock.withPermits(1)(run(input)) });
});

export const layer = Layer.effect(SideQuestShelf, make);
