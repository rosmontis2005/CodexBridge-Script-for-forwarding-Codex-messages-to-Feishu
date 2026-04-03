import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovalCard } from "../card_builder.js";
import type { AppConfig } from "../config.js";
import type { ApprovalRecord } from "../types.js";

const config: AppConfig = {
  approvalMode: "terminal",
  prompt: "demo",
  workspaceCwd: "/repo",
  codexBin: "codex",
  codexAppServerUrl: null,
  codexAppServerPort: 8765,
  codexModel: null,
  codexApprovalPolicy: "untrusted",
  codexSandbox: "workspace-write",
  codexReasoningEffort: "low",
  feishuAppId: null,
  feishuAppSecret: null,
  feishuVerificationToken: null,
  feishuEncryptKey: null,
  feishuApprovalReceiveId: null,
  feishuApprovalReceiveIdType: "open_id",
  allowedFeishuUsers: [],
  allowAcceptForSession: false,
  feishuCallbackPort: 3000,
  feishuCallbackPath: "/webhook/card",
  enablePlanUpdateNotifications: true,
  cardCommandMaxLen: 24,
  cardReasonMaxLen: 20,
  cardFileSummaryMaxLen: 20
};

const baseRecord: ApprovalRecord = {
  key: "1",
  requestId: 1,
  approvalId: null,
  kind: "command",
  status: "pending",
  finalDecision: null,
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  threadId: "thread-abcdef",
  turnId: "turn-abcdef",
  itemId: "item-abcdef",
  cwd: "/repo",
  reason: "network access",
  command: "very long command that should be truncated at some point",
  commandActions: [],
  grantRoot: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  actedBy: null,
  feishuMessageId: null
};

test("buildApprovalCard omits acceptForSession when disabled", () => {
  const card = buildApprovalCard(baseRecord, config) as {
    elements?: Array<{ actions?: Array<{ text?: { content?: string } }> }>;
  };
  const actions = card.elements?.find((element) => Array.isArray(element.actions))?.actions ?? [];
  const labels = actions.map((action) => action.text?.content);
  assert.deepEqual(labels, ["批准", "拒绝", "取消"]);
});

test("buildApprovalCard truncates command preview", () => {
  const card = buildApprovalCard(baseRecord, config) as {
    elements?: Array<{ content?: string }>;
  };
  const commandBlock = card.elements?.[3];
  assert.ok(commandBlock);
  assert.ok(commandBlock.content?.includes("…"));
});
