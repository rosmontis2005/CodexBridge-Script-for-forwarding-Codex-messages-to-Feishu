import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalStore } from "../approval_store.js";

test("ApprovalStore finalizes only once", () => {
  const store = new ApprovalStore();
  const record = store.create({
    requestId: 1,
    approvalId: null,
    kind: "command",
    availableDecisions: ["accept", "decline", "cancel"],
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    cwd: "/tmp",
    reason: "need mkdir",
    command: "mkdir -p /tmp/demo",
    commandActions: null,
    grantRoot: null
  });

  const first = store.finalize(record.key, "accept", "alice");
  const second = store.finalize(record.key, "decline", "bob");

  assert.equal(first.accepted, true);
  assert.equal(first.record.status, "approved");
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "approval_already_approved");
});

test("ApprovalStore marks unresolved pending approvals as expired", () => {
  const store = new ApprovalStore();
  store.create({
    requestId: 2,
    approvalId: null,
    kind: "fileChange",
    availableDecisions: ["accept", "decline", "cancel"],
    threadId: "thread-1",
    turnId: "turn-2",
    itemId: "item-2",
    cwd: "/repo",
    reason: "write file",
    command: null,
    commandActions: null,
    grantRoot: "/repo"
  });

  const expired = store.markExpiredPending();
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.status, "expired");
});
