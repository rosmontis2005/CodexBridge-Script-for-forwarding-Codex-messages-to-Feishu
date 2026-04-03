import type {
  ApprovalActionResult,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
  ApprovalStatus
} from "./types.js";

interface CreateApprovalInput {
  requestId: number | string;
  approvalId: string | null;
  kind: ApprovalKind;
  availableDecisions: ApprovalDecision[];
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string | null;
  reason: string | null;
  command: string | null;
  commandActions: Array<Record<string, unknown>> | null;
  grantRoot?: string | null;
}

export class ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();

  create(input: CreateApprovalInput): ApprovalRecord {
    const now = new Date().toISOString();
    const key = String(input.requestId);
    const record: ApprovalRecord = {
      key,
      requestId: input.requestId,
      approvalId: input.approvalId,
      kind: input.kind,
      status: "pending",
      finalDecision: null,
      availableDecisions: [...input.availableDecisions],
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      cwd: input.cwd,
      reason: input.reason,
      command: input.command,
      commandActions: [...(input.commandActions ?? [])],
      grantRoot: input.grantRoot ?? null,
      createdAt: now,
      updatedAt: now,
      actedBy: null,
      feishuMessageId: null
    };
    this.records.set(key, record);
    return record;
  }

  get(key: string): ApprovalRecord | undefined {
    return this.records.get(key);
  }

  listPending(): ApprovalRecord[] {
    return [...this.records.values()].filter((record) => record.status === "pending");
  }

  attachFeishuMessage(key: string, messageId: string): ApprovalRecord | undefined {
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    record.feishuMessageId = messageId;
    record.updatedAt = new Date().toISOString();
    return record;
  }

  finalize(key: string, decision: ApprovalDecision, actor: string): ApprovalActionResult {
    const record = this.records.get(key);
    if (!record) {
      return {
        accepted: false,
        reason: "approval_not_found",
        record: this.makeSyntheticRecord(key)
      };
    }

    if (record.status !== "pending") {
      return {
        accepted: false,
        reason: `approval_already_${record.status}`,
        record
      };
    }

    if (!record.availableDecisions.includes(decision)) {
      return {
        accepted: false,
        reason: "decision_not_allowed",
        record
      };
    }

    record.finalDecision = decision;
    record.status = decisionToStatus(decision);
    record.actedBy = actor;
    record.updatedAt = new Date().toISOString();

    return {
      accepted: true,
      record
    };
  }

  markResolved(requestId: number | string): ApprovalRecord | undefined {
    const record = this.records.get(String(requestId));
    if (!record) {
      return undefined;
    }

    if (record.status === "pending") {
      record.status = "resolved";
      record.updatedAt = new Date().toISOString();
    }

    return record;
  }

  markExpiredPending(actor = "system"): ApprovalRecord[] {
    const expired: ApprovalRecord[] = [];
    for (const record of this.records.values()) {
      if (record.status !== "pending") {
        continue;
      }
      record.status = "expired";
      record.actedBy = actor;
      record.updatedAt = new Date().toISOString();
      expired.push(record);
    }
    return expired;
  }

  private makeSyntheticRecord(key: string): ApprovalRecord {
    return {
      key,
      requestId: key,
      approvalId: null,
      kind: "command",
      status: "resolved",
      finalDecision: null,
      availableDecisions: [],
      threadId: "",
      turnId: "",
      itemId: "",
      cwd: null,
      reason: null,
      command: null,
      commandActions: [],
      grantRoot: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      actedBy: null,
      feishuMessageId: null
    };
  }
}

function decisionToStatus(decision: ApprovalDecision): ApprovalStatus {
  switch (decision) {
    case "accept":
    case "acceptForSession":
      return "approved";
    case "decline":
      return "declined";
    case "cancel":
      return "canceled";
  }
}
