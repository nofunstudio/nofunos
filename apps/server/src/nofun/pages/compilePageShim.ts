// Stand-in for `compilePage` from "@t3tools/nofun-artifacts/compiler", which another worker is building. The
// page tools code against exactly this signature; once the compiler exports it, swap the import in
// pageHandlers.ts (one line) and delete this file.
import type { CompiledArtifact } from "@t3tools/nofun-artifacts/compiler";

export interface CompilePageInput {
  /** A flat json-render spec ({root, elements}) that has already passed the brand filter and enforce(). */
  readonly spec: unknown;
  /** Brand slug or name; picks the brand's design tokens, copy context and imagery. */
  readonly brand: string;
  readonly title: string;
}

export const compilePage = async (_input: CompilePageInput): Promise<CompiledArtifact> => {
  throw new Error("compilePage not available yet");
};
