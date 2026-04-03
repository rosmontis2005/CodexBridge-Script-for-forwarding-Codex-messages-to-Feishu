import process from "node:process";
import { ApprovalStore } from "./approval_store.js";
import {
  buildApprovalCard,
  buildApprovalResultCard,
  buildPlanUpdateCard,
  buildTurnNotificationCard
} from "./card_builder.js";
import { CodexClient } from "./codex_client.js";
import { assertFeishuConfig, feishuConfigured, loadConfig, type CliArgs } from "./config.js";
import { FeishuClient } from "./feishu_client.js";
import { TerminalApprover } from "./terminal_approver.js";
import type {
  ApprovalDecision,
  ApprovalRecord,
  PlanStep,
  TurnSummary
} from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args);
  const mode =
    config.approvalMode === "auto"
      ? feishuConfigured(config)
        ? "feishu"
        : "terminal"
      : config.approvalMode;

  if (mode === "feishu") {
    assertFeishuConfig(config);
  }

  const codex = new CodexClient(config);
  const store = new ApprovalStore();
  const terminalApprover = new TerminalApprover();
  const assistantSummaries = new Map<string, string>();
  let feishu: FeishuClient | null = null;
  let activeThreadId: string | null = null;

  codex.on("serverLog", (message) => {
    if (message) {
      console.log(`[codex] ${message}`);
    }
  });

  codex.on("notification", async (method, params) => {
    console.log(`[event] ${method}`);

    if (method === "thread/started") {
      const thread = params.thread as { id?: string } | undefined;
      activeThreadId = thread?.id ?? activeThreadId;
    }

    if (method === "turn/plan/updated" && config.enablePlanUpdateNotifications) {
      const plan = ((params.plan as PlanStep[] | undefined) ?? []) as PlanStep[];
      if (feishu && plan.length > 0) {
        await feishu.sendInteractiveCard(
          buildPlanUpdateCard(
            String(params.threadId ?? ""),
            String(params.turnId ?? ""),
            plan
          )
        );
      }
    }

    if (method === "item/completed") {
      const item = params.item as { type?: string; content?: Array<{ text?: string }> } | undefined;
      const turnId = String(params.turnId ?? "");
      if (item?.type === "assistantMessage") {
        const text = item.content?.map((entry) => entry.text ?? "").join("\n").trim();
        if (text) {
          assistantSummaries.set(turnId, text);
        }
      }
    }

    if (method === "serverRequest/resolved") {
      const requestId = params.requestId as string | number;
      const record = store.markResolved(requestId);
      if (feishu && record?.feishuMessageId) {
        await feishu.updateInteractiveCard(
          record.feishuMessageId,
          buildApprovalResultCard(record, record.status, record.actedBy ?? "system")
        );
      }
    }

    if (method === "turn/completed") {
      const turn = params.turn as { id?: string; status?: TurnSummary["status"]; error?: { message?: string } };
      const turnId = String(turn?.id ?? "");
      const summary: TurnSummary = {
        threadId: String(params.threadId ?? activeThreadId ?? ""),
        turnId,
        status: turn?.status ?? "completed",
        assistantText: assistantSummaries.get(turnId) ?? null,
        errorMessage: turn?.error?.message ?? null
      };

      if (feishu) {
        await feishu.sendInteractiveCard(buildTurnNotificationCard(summary));
      }

      store.markExpiredPending("system");
      console.log(`[turn] ${summary.status}`);
      cleanup(codex, terminalApprover, feishu);
      process.exit(summary.status === "completed" ? 0 : 1);
    }
  });

  codex.on("request", async (id, method, params) => {
    if (method !== "item/commandExecution/requestApproval" && method !== "item/fileChange/requestApproval") {
      console.log(`[warn] unsupported request ${method}`);
      return;
    }

    const record = store.create({
      requestId: id,
      approvalId: asOptionalString(params.approvalId),
      kind: method.includes("commandExecution") ? "command" : "fileChange",
      availableDecisions: parseAvailableDecisions(params.availableDecisions, config.allowAcceptForSession),
      threadId: String(params.threadId ?? ""),
      turnId: String(params.turnId ?? ""),
      itemId: String(params.itemId ?? ""),
      cwd: asOptionalString(params.cwd),
      reason: asOptionalString(params.reason),
      command: asOptionalString(params.command),
      commandActions: (params.commandActions as Array<Record<string, unknown>> | undefined) ?? null,
      grantRoot: asOptionalString(params.grantRoot)
    });

    if (mode === "feishu" && feishu) {
      const messageId = await feishu.sendInteractiveCard(buildApprovalCard(record, config));
      store.attachFeishuMessage(record.key, messageId);
      console.log(`[approval] sent to Feishu request=${record.key} message=${messageId}`);
      return;
    }

    const decision = await terminalApprover.prompt(record, config.allowAcceptForSession);
    await submitApprovalDecision({
      decision,
      actorId: "terminal-user",
      actorName: "terminal-user",
      record,
      codex,
      store,
      feishu
    });
  });

  if (mode === "feishu") {
    feishu = new FeishuClient(config);
    feishu.on("action", async (action) => {
      const record = store.get(action.approvalKey);
      if (!record) {
        console.log(`[security] unknown approval key ${action.approvalKey}`);
        return;
      }

      if (!config.allowedFeishuUsers.includes(action.actorId)) {
        console.log(`[security] unauthorized Feishu user ${action.actorId} for ${action.approvalKey}`);
        if (record.feishuMessageId) {
          await feishu?.updateInteractiveCard(
            record.feishuMessageId,
            buildApprovalResultCard(record, record.status, `unauthorized:${action.actorId}`)
          );
        }
        return;
      }

      await submitApprovalDecision({
        decision: action.decision,
        actorId: action.actorId,
        actorName: action.actorName,
        record,
        codex,
        store,
        feishu
      });
    });
    await feishu.startCallbackServer();
    console.log(`[feishu] callback server listening on ${config.feishuCallbackPort}${config.feishuCallbackPath}`);
  }

  await codex.start();
  const threadResult = await codex.startThread();
  const thread = threadResult.thread as { id?: string } | undefined;
  const threadId = thread?.id;
  if (!threadId) {
    throw new Error("thread/start returned no thread id");
  }
  activeThreadId = threadId;
  console.log(`[thread] ${threadId}`);

  const turnResult = await codex.startTurn(threadId, config.prompt);
  const turn = turnResult.turn as { id?: string } | undefined;
  console.log(`[turn] started ${turn?.id ?? "unknown"}`);
}

async function submitApprovalDecision(input: {
  decision: ApprovalDecision;
  actorId: string;
  actorName: string;
  record: ApprovalRecord;
  codex: CodexClient;
  store: ApprovalStore;
  feishu: FeishuClient | null;
}): Promise<void> {
  const actor = `${input.actorName}(${input.actorId})`;
  const result = input.store.finalize(input.record.key, input.decision, actor);
  if (!result.accepted) {
    console.log(`[approval] ignored ${input.record.key}: ${result.reason}`);
    return;
  }

  input.codex.respond(input.record.requestId, { decision: input.decision });
  console.log(`[approval] ${input.decision} by ${actor} request=${input.record.key}`);

  if (input.feishu && result.record.feishuMessageId) {
    await input.feishu.updateInteractiveCard(
      result.record.feishuMessageId,
      buildApprovalResultCard(result.record, result.record.status, actor)
    );
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--approval-mode") {
      const next = argv[index + 1];
      if (next === "terminal" || next === "feishu" || next === "auto") {
        args.approvalMode = next;
      }
      index += 1;
    } else if (current === "--prompt") {
      const next = argv[index + 1];
      if (next !== undefined) {
        args.prompt = next;
      }
      index += 1;
    } else if (current === "--cwd") {
      const next = argv[index + 1];
      if (next !== undefined) {
        args.workspaceCwd = next;
      }
      index += 1;
    }
  }
  return args;
}

function parseAvailableDecisions(
  raw: unknown,
  allowAcceptForSession: boolean
): ApprovalDecision[] {
  const values = Array.isArray(raw)
    ? raw
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object" && "decision" in entry) {
            return String((entry as Record<string, unknown>).decision);
          }
          return null;
        })
        .filter(Boolean)
    : ["accept", "decline", "cancel", "acceptForSession"];

  const normalized = values.filter((value): value is ApprovalDecision =>
    ["accept", "acceptForSession", "decline", "cancel"].includes(String(value))
  );

  return normalized.filter((value) => value !== "acceptForSession" || allowAcceptForSession);
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanup(codex: CodexClient, terminalApprover: TerminalApprover, feishu: FeishuClient | null): void {
  codex.close();
  terminalApprover.close();
  feishu?.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
