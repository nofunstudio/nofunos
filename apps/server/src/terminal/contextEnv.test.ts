import { describe, expect, it } from "@effect/vitest";

import { nofunTeamFromEnv, terminalContextEnv } from "./contextEnv.ts";

const base = { threadId: "thread-1", serverEnv: {} };

describe("terminalContextEnv", () => {
  it("names the project after its root and exports the worktree for a worktree thread", () => {
    expect(
      terminalContextEnv({
        ...base,
        cwd: "/work/.wt/shop-feature",
        worktreePath: "/work/.wt/shop-feature",
        runtimeEnv: {
          T3CODE_PROJECT_ROOT: "/work/shop",
          T3CODE_WORKTREE_PATH: "/work/.wt/shop-feature",
        },
      }),
    ).toEqual({
      NOFUN_TEAM: "nofun",
      T3_PROJECT_NAME: "shop",
      T3_PROJECT_ROOT: "/work/shop",
      T3_THREAD_ID: "thread-1",
      T3_WORKTREE_PATH: "/work/.wt/shop-feature",
    });
  });

  it("omits the worktree for a thread working in the project root", () => {
    const env = terminalContextEnv({
      ...base,
      cwd: "/work/shop",
      worktreePath: null,
      runtimeEnv: null,
    });
    expect(env.T3_PROJECT_ROOT).toBe("/work/shop");
    expect(env).not.toHaveProperty("T3_WORKTREE_PATH");
  });

  it("falls back to the worktree path when the client sent no project root", () => {
    const env = terminalContextEnv({
      ...base,
      cwd: "/work/.wt/a",
      worktreePath: "/work/.wt/a",
      runtimeEnv: null,
    });
    expect(env.T3_PROJECT_ROOT).toBe("/work/.wt/a");
    expect(env.T3_WORKTREE_PATH).toBe("/work/.wt/a");
  });
});

describe("nofunTeamFromEnv", () => {
  it("is nofun without a persona and catches only for the CATCHES persona", () => {
    expect(nofunTeamFromEnv({})).toBe("nofun");
    expect(nofunTeamFromEnv({ T3CODE_PERSONA: "nofun" })).toBe("nofun");
    expect(nofunTeamFromEnv({ T3CODE_PERSONA: "catches" })).toBe("catches");
  });
});
