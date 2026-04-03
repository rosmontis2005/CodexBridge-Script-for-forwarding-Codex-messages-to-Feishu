import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type { AppConfig } from "./config.js";

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export interface CodexClientEvents {
  connected: [];
  serverLog: [string];
  notification: [string, Record<string, unknown>];
  request: [JsonRpcId, string, Record<string, unknown>];
  disconnected: [];
}

export class CodexClient extends EventEmitter<CodexClientEvents> {
  private readonly config: AppConfig;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private serverProcess: ChildProcess | null = null;
  private socket: WebSocket | null = null;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    const url = this.config.codexAppServerUrl ?? (await this.spawnLocalServer());
    await this.connect(url);
    await this.request("initialize", {
      clientInfo: {
        name: "codex-feishu-approval-bridge",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized", {});
  }

  async startThread(): Promise<Record<string, unknown>> {
    const result = (await this.request("thread/start", {
      cwd: this.config.workspaceCwd,
      approvalPolicy: this.config.codexApprovalPolicy,
      sandbox: this.config.codexSandbox,
      ...(this.config.codexModel ? { model: this.config.codexModel } : {})
    })) as Record<string, unknown>;

    return result;
  }

  async startTurn(threadId: string, prompt: string): Promise<Record<string, unknown>> {
    const result = (await this.request("turn/start", {
      threadId,
      effort: this.config.codexReasoningEffort,
      input: [
        {
          type: "text",
          text: prompt
        }
      ]
    })) as Record<string, unknown>;

    return result;
  }

  respond(id: JsonRpcId, result: Record<string, unknown>): void {
    this.send({
      jsonrpc: "2.0",
      id,
      result
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex client closed"));
    }
    this.pending.clear();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
  }

  private async spawnLocalServer(): Promise<string> {
    const url = `ws://127.0.0.1:${this.config.codexAppServerPort}`;
    this.serverProcess = spawn(
      this.config.codexBin,
      ["app-server", "--listen", url],
      {
        cwd: this.config.workspaceCwd,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    this.serverProcess.stdout?.on("data", (chunk: Buffer) => {
      this.emit("serverLog", chunk.toString("utf8").trim());
    });
    this.serverProcess.stderr?.on("data", (chunk: Buffer) => {
      this.emit("serverLog", chunk.toString("utf8").trim());
    });
    this.serverProcess.on("exit", () => {
      this.emit("disconnected");
    });

    await delay(1_200);
    return url;
  }

  private async connect(url: string): Promise<void> {
    this.socket = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.onopen = () => resolve(socket);
      socket.onerror = () => reject(new Error(`Failed to connect to Codex app-server at ${url}`));
    });

    this.socket.onmessage = (event) => {
      this.handleIncomingMessage(event.data.toString());
    };
    this.socket.onclose = () => {
      this.emit("disconnected");
    };
    this.emit("connected");
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    this.send(payload);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    const payload: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params
    };
    this.send(payload);
  }

  private send(payload: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex WebSocket is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private handleIncomingMessage(raw: string): void {
    const message = JSON.parse(raw) as Record<string, unknown>;

    if ("method" in message) {
      const method = String(message.method);
      const params = ((message.params as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >;

      if ("id" in message) {
        this.emit("request", message.id as JsonRpcId, method, params);
        return;
      }

      this.emit("notification", method, params);
      return;
    }

    const response = message as unknown as JsonRpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`${pending.method} failed: ${response.error.message}`));
      return;
    }

    pending.resolve(response.result);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
