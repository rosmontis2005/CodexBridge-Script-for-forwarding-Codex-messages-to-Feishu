import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

test("loadConfig prefers CLI args over env vars", () => {
  process.env.APPROVAL_MODE = "terminal";
  process.env.PROMPT = "env prompt";
  const config = loadConfig({
    approvalMode: "feishu",
    prompt: "cli prompt",
    workspaceCwd: "/workspace"
  });

  assert.equal(config.approvalMode, "feishu");
  assert.equal(config.prompt, "cli prompt");
  assert.equal(config.workspaceCwd, "/workspace");
});
