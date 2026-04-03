import type { AppConfig } from "./config.js";
import type { ApprovalRecord, ApprovalStatus, PlanStep, TurnSummary } from "./types.js";

type FeishuCard = Record<string, unknown>;

export function buildApprovalCard(record: ApprovalRecord, config: AppConfig): FeishuCard {
  const decisionButtons: Array<Record<string, unknown>> = [];
  const canAcceptForSession =
    config.allowAcceptForSession && record.availableDecisions.includes("acceptForSession");

  if (record.availableDecisions.includes("accept")) {
    decisionButtons.push(button("批准", "primary", record.key, "accept"));
  }
  if (canAcceptForSession) {
    decisionButtons.push(button("本次会话都批准", "default", record.key, "acceptForSession"));
  }
  if (record.availableDecisions.includes("decline")) {
    decisionButtons.push(button("拒绝", "danger", record.key, "decline"));
  }
  if (record.availableDecisions.includes("cancel")) {
    decisionButtons.push(button("取消", "default", record.key, "cancel"));
  }

  const summary =
    record.kind === "command"
      ? truncate(record.command ?? "command preview unavailable", config.cardCommandMaxLen)
      : truncate(
          [record.reason, record.grantRoot && `grantRoot=${record.grantRoot}`]
            .filter(Boolean)
            .join(" | ") || "file change summary unavailable from current Codex payload",
          config.cardFileSummaryMaxLen
        );

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false
    },
    header: {
      template: record.kind === "command" ? "orange" : "blue",
      title: {
        tag: "plain_text",
        content: `Codex 审批: ${record.kind === "command" ? "命令执行" : "文件修改"}`
      }
    },
    elements: [
      field("状态", "等待审批"),
      field("工作目录", record.cwd ?? "-"),
      field("原因", truncate(record.reason ?? "-", config.cardReasonMaxLen)),
      field(
        record.kind === "command" ? "命令预览" : "文件改动摘要",
        summary
      ),
      field("短 ID", shortIdText(record)),
      {
        tag: "action",
        actions: decisionButtons
      }
    ]
  };
}

export function buildApprovalResultCard(
  record: ApprovalRecord,
  status: ApprovalStatus,
  actor: string
): FeishuCard {
  const titleMap: Record<ApprovalStatus, string> = {
    pending: "等待审批",
    approved: "已批准",
    declined: "已拒绝",
    canceled: "已取消",
    expired: "已过期",
    resolved: "已关闭"
  };

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false
    },
    header: {
      template: statusColor(status),
      title: {
        tag: "plain_text",
        content: `Codex 审批: ${titleMap[status]}`
      }
    },
    elements: [
      field("审批类型", record.kind === "command" ? "命令执行" : "文件修改"),
      field("执行者", actor),
      field("状态", titleMap[status]),
      field("工作目录", record.cwd ?? "-"),
      field("短 ID", shortIdText(record))
    ]
  };
}

export function buildTurnNotificationCard(summary: TurnSummary): FeishuCard {
  const color =
    summary.status === "completed"
      ? "green"
      : summary.status === "failed"
        ? "red"
        : summary.status === "interrupted"
          ? "grey"
          : "blue";

  const message =
    summary.status === "completed"
      ? summary.assistantText ?? "turn completed"
      : summary.errorMessage ?? `${summary.status} without additional details`;

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false
    },
    header: {
      template: color,
      title: {
        tag: "plain_text",
        content: `Codex Turn ${summary.status}`
      }
    },
    elements: [
      field("Thread", short(summary.threadId)),
      field("Turn", short(summary.turnId)),
      field("摘要", truncate(message, 280))
    ]
  };
}

export function buildPlanUpdateCard(threadId: string, turnId: string, plan: PlanStep[]): FeishuCard {
  const lines = plan.map((step) => `${step.status}: ${step.step}`).join("\n");
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false
    },
    header: {
      template: "wathet",
      title: {
        tag: "plain_text",
        content: "Codex 计划更新"
      }
    },
    elements: [
      field("Thread", short(threadId)),
      field("Turn", short(turnId)),
      field("计划", truncate(lines, 280))
    ]
  };
}

function button(label: string, type: string, approvalKey: string, decision: string): Record<string, unknown> {
  return {
    tag: "button",
    type,
    text: {
      tag: "plain_text",
      content: label
    },
    value: {
      approval_key: approvalKey,
      decision
    }
  };
}

function field(label: string, content: string): Record<string, unknown> {
  return {
    tag: "markdown",
    content: `**${escapeMarkdown(label)}**\n${escapeMarkdown(content)}`
  };
}

function escapeMarkdown(input: string): string {
  return input.replace(/[\\`*_{}[\]()#+\-!.]/gu, "\\$&");
}

function shortIdText(record: ApprovalRecord): string {
  return `thread=${short(record.threadId)} turn=${short(record.turnId)} item=${short(record.itemId)}`;
}

function short(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function statusColor(status: ApprovalStatus): string {
  switch (status) {
    case "approved":
      return "green";
    case "declined":
      return "red";
    case "canceled":
    case "expired":
      return "grey";
    case "resolved":
      return "blue";
    case "pending":
      return "orange";
  }
}
