import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  approvalMode: "terminal" | "feishu" | "auto";
  prompt: string;
  workspaceCwd: string;
  codexBin: string;
  codexAppServerUrl: string | null;
  codexAppServerPort: number;
  codexModel: string | null;
  codexApprovalPolicy: "untrusted" | "on-request" | "never";
  codexSandbox: "read-only" | "workspace-write" | "danger-full-access";
  codexReasoningEffort: "low" | "medium" | "high";
  feishuAppId: string | null;
  feishuAppSecret: string | null;
  feishuVerificationToken: string | null;
  feishuEncryptKey: string | null;
  feishuApprovalReceiveId: string | null;
  feishuApprovalReceiveIdType: "open_id" | "union_id" | "user_id" | "email" | "chat_id";
  allowedFeishuUsers: string[];
  allowAcceptForSession: boolean;
  feishuCallbackPort: number;
  feishuCallbackPath: string;
  enablePlanUpdateNotifications: boolean;
  cardCommandMaxLen: number;
  cardReasonMaxLen: number;
  cardFileSummaryMaxLen: number;
}

export interface CliArgs {
  approvalMode?: "terminal" | "feishu" | "auto";
  prompt?: string;
  workspaceCwd?: string;
}

export function loadConfig(cliArgs: CliArgs = {}): AppConfig {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const cliApprovalMode = cliArgs.approvalMode;
  const envApprovalMode = asEnum(process.env.APPROVAL_MODE, ["terminal", "feishu", "auto"]);
  const approvalMode = cliApprovalMode ?? envApprovalMode ?? "terminal";
  const workspaceCwd = cliArgs.workspaceCwd ?? process.env.WORKSPACE_CWD ?? process.cwd();
  const prompt = cliArgs.prompt ?? process.env.PROMPT ?? "Run `pwd` and tell me the result.";

  return {
    approvalMode,
    prompt,
    workspaceCwd,
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexAppServerUrl: emptyToNull(process.env.CODEX_APP_SERVER_URL),
    codexAppServerPort: asInt(process.env.CODEX_APP_SERVER_PORT, 8765),
    codexModel: emptyToNull(process.env.CODEX_MODEL),
    codexApprovalPolicy:
      asEnum(process.env.CODEX_APPROVAL_POLICY, ["untrusted", "on-request", "never"]) ??
      "untrusted",
    codexSandbox:
      asEnum(process.env.CODEX_SANDBOX, ["read-only", "workspace-write", "danger-full-access"]) ??
      "workspace-write",
    codexReasoningEffort:
      asEnum(process.env.CODEX_REASONING_EFFORT, ["low", "medium", "high"]) ?? "low",
    feishuAppId: emptyToNull(process.env.FEISHU_APP_ID),
    feishuAppSecret: emptyToNull(process.env.FEISHU_APP_SECRET),
    feishuVerificationToken: emptyToNull(process.env.FEISHU_VERIFICATION_TOKEN),
    feishuEncryptKey: emptyToNull(process.env.FEISHU_ENCRYPT_KEY),
    feishuApprovalReceiveId: emptyToNull(process.env.FEISHU_APPROVAL_RECEIVE_ID),
    feishuApprovalReceiveIdType:
      asEnum(process.env.FEISHU_APPROVAL_RECEIVE_ID_TYPE, [
        "open_id",
        "union_id",
        "user_id",
        "email",
        "chat_id"
      ]) ?? "open_id",
    allowedFeishuUsers: splitCsv(process.env.ALLOWED_FEISHU_USERS),
    allowAcceptForSession: asBoolean(process.env.ALLOW_ACCEPT_FOR_SESSION, true),
    feishuCallbackPort: asInt(process.env.FEISHU_CALLBACK_PORT, 3000),
    feishuCallbackPath: normalizeCallbackPath(process.env.FEISHU_CALLBACK_PATH ?? "/webhook/card"),
    enablePlanUpdateNotifications: asBoolean(process.env.ENABLE_PLAN_UPDATE_NOTIFICATIONS, true),
    cardCommandMaxLen: asInt(process.env.CARD_COMMAND_MAX_LEN, 220),
    cardReasonMaxLen: asInt(process.env.CARD_REASON_MAX_LEN, 180),
    cardFileSummaryMaxLen: asInt(process.env.CARD_FILE_SUMMARY_MAX_LEN, 180)
  };
}

export function feishuConfigured(config: AppConfig): boolean {
  return Boolean(
    config.feishuAppId &&
      config.feishuAppSecret &&
      config.feishuApprovalReceiveId &&
      config.feishuVerificationToken
  );
}

export function assertFeishuConfig(config: AppConfig): void {
  if (feishuConfigured(config)) {
    return;
  }

  throw new Error(
    "Feishu mode requires FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_VERIFICATION_TOKEN, and FEISHU_APPROVAL_RECEIVE_ID."
  );
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function asInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : null;
}

function normalizeCallbackPath(callbackPath: string): string {
  return callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
}

function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}
