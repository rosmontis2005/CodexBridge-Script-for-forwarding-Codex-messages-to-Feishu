export type ApprovalKind = "command" | "fileChange";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "declined"
  | "canceled"
  | "expired"
  | "resolved";

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type CodexApprovalDecisionPayload =
  | { decision: "accept" }
  | { decision: "acceptForSession" }
  | { decision: "decline" }
  | { decision: "cancel" };

export type CodexTurnStatus = "completed" | "failed" | "interrupted" | "inProgress";

export interface ApprovalRecord {
  key: string;
  requestId: number | string;
  approvalId: string | null;
  kind: ApprovalKind;
  status: ApprovalStatus;
  finalDecision: ApprovalDecision | null;
  availableDecisions: ApprovalDecision[];
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string | null;
  reason: string | null;
  command: string | null;
  commandActions: Array<Record<string, unknown>>;
  grantRoot: string | null;
  createdAt: string;
  updatedAt: string;
  actedBy: string | null;
  feishuMessageId: string | null;
}

export interface ApprovalActionResult {
  accepted: boolean;
  record: ApprovalRecord;
  reason?: string;
}

export interface ShortIds {
  threadId: string;
  turnId: string;
  itemId: string;
}

export interface TurnSummary {
  threadId: string;
  turnId: string;
  status: CodexTurnStatus;
  assistantText: string | null;
  errorMessage: string | null;
}

export interface PlanStep {
  step: string;
  status: string;
}

export interface CardActionInput {
  approvalKey: string;
  decision: ApprovalDecision;
  actorId: string;
  actorName: string;
}
