import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  fleetInstructions,
  t3OrchestrationInstructionsFor,
  t3WorkspaceInstructions,
  visualOutputInstructions,
  t3AcpPromptWithInstructions,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSystemPrompt,
} from "./T3OrchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "ordinary top-level T3 conversations");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `t3_thread_send` on `childThreadId`",
    );
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = t3OrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasT3Mcp: true,
    });

    assert.include(injected, "<t3_code_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasT3Mcp: true }),
      prompt,
    );
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasT3Mcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the T3 MCP server is attached", () => {
    assert.equal(t3OrchestrationSystemPrompt(false), undefined);
    assert.equal(t3OrchestrationSystemPrompt(true), T3_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = t3AcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasT3Mcp: true },
    });

    assert.include(injected, "T3 Code interaction mode: Default");
    assert.include(injected, "T3 Code collaborative browser");
    assert.include(injected, "T3 Code orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasT3Mcp: true } as const;

    assert.equal(
      t3AcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "T3 Code interaction mode: Plan",
    );
    const withoutMcp = t3AcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasT3Mcp: false },
    });
    assert.include(withoutMcp, "T3 Code interaction mode: Default");
    assert.notInclude(withoutMcp, "T3 Code collaborative browser");
    assert.notInclude(withoutMcp, "T3 Code orchestration");
  });

  it("sends computer use to Codex and names /agent-fleet as the only skill", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "never names a skill");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "/agent-fleet");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Computer use is always Codex's job");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "`codex-computer-use` skill");
    assert.notInclude(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "CATCHES Codex instance");
  });

  it("states the team and project of the turn", () => {
    const text = t3OrchestrationInstructionsFor({
      projectName: "nofunos",
      projectRoot: "/work/nofunos",
      worktreePath: "/work/wt/feature",
      branch: "feature/x",
      cwd: "/work/wt/feature",
    });
    assert.include(text, "### Where you are");
    assert.include(text, "- Team: No Fun");
    assert.include(text, "- Project: nofunos");
    assert.include(text, "- Project root: /work/nofunos");
    assert.include(text, "- Thread worktree: /work/wt/feature");
    assert.include(text, "- Branch: feature/x");
    assert.notInclude(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "### Where you are");
  });

  it("describes a root checkout by its working directory", () => {
    const text = t3WorkspaceInstructions({ projectName: "app", cwd: "/work/app", branch: null });
    assert.include(text, "- Working directory: /work/app (the project checkout)");
    assert.notInclude(text, "Thread worktree");
    assert.notInclude(text, "Branch");
  });

  it("scopes CATCHES to its own team, Codex and artifacts", () => {
    const catches = {
      info: { id: "catches", label: "CATCHES", icon: "catches" },
      allowedRoots: [],
    };
    const text = t3WorkspaceInstructions({ projectName: "shop" }, catches);
    assert.include(text, "- Team: CATCHES");
    const fleet = fleetInstructions("catches");
    assert.include(fleet, "CATCHES Codex instance");
    assert.include(fleet, "Never use Muse, Cursor or any personal account");
    assert.include(fleet, "Do not use the `codex-computer-use` skill");
    assert.include(fleet, "/agent-fleet");
    assert.include(visualOutputInstructions("catches"), "hosted Claude artifact");
  });
});
