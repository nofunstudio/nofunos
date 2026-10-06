import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as SideQuestShelf from "./SideQuestShelf.ts";

const layerTest = SideQuestShelf.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-shelf-" })),
  Layer.provideMerge(NodeServices.layer),
);

const SOURCE_ID = "thread-1-8a1f4c3e-0000-4000-8000-000000000001-html";

describe("SideQuestShelf", () => {
  it.effect("keeps a pinned page after its source is deleted and rejects stale revisions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const shelf = yield* SideQuestShelf.SideQuestShelf;
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      const sourcePath = `${config.attachmentsDir}/${SOURCE_ID}.html`;
      yield* fileSystem.writeFileString(sourcePath, "<html>v1</html>");

      const pinned = yield* shelf.run({ op: "pin", attachmentId: SOURCE_ID, title: "Board" });
      const pin = pinned.pin!;
      yield* fileSystem.remove(sourcePath);
      const owned = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: pin.revisions[0]!.attachmentId,
      });
      expect(owned).not.toBeNull();
      expect(yield* fileSystem.readFileString(owned!)).toBe("<html>v1</html>");

      yield* fileSystem.writeFileString(sourcePath, "<html>v2</html>");
      const revised = yield* shelf.run({
        op: "addRevision",
        pinId: pin.id,
        expectedRevision: 1,
        attachmentId: SOURCE_ID,
      });
      expect(revised.pin?.currentRevision).toBe(2);
      const stale = yield* shelf
        .run({ op: "addRevision", pinId: pin.id, expectedRevision: 1, attachmentId: SOURCE_ID })
        .pipe(Effect.flip);
      expect(stale.reason).toBe("conflict");
      expect((yield* shelf.run({ op: "list" })).pins[0]?.revisions).toHaveLength(2);

      yield* shelf.run({ op: "unpin", pinId: pin.id });
      expect(yield* fileSystem.exists(owned!)).toBe(false);
      expect((yield* shelf.run({ op: "list" })).pins).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );
});
