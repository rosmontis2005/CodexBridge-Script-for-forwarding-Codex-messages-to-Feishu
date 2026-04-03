import http from "node:http";
import { EventEmitter } from "node:events";
import * as lark from "@larksuiteoapi/node-sdk";
import type { InteractiveCard, InteractiveCardActionEvent } from "@larksuiteoapi/node-sdk";
import type { AppConfig } from "./config.js";
import type { ApprovalDecision } from "./types.js";

export interface FeishuClientEvents {
  action: [
    {
      approvalKey: string;
      decision: ApprovalDecision;
      actorId: string;
      actorName: string;
    }
  ];
}

export class FeishuClient extends EventEmitter<FeishuClientEvents> {
  private readonly config: AppConfig;
  private readonly client: lark.Client;
  private readonly cardHandler: lark.CardActionHandler;
  private server: http.Server | null = null;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.client = new lark.Client({
      appId: config.feishuAppId ?? "",
      appSecret: config.feishuAppSecret ?? ""
    });
    this.cardHandler = new lark.CardActionHandler(
      {
        verificationToken: config.feishuVerificationToken ?? "",
        encryptKey: config.feishuEncryptKey ?? ""
      },
      async (data: InteractiveCardActionEvent) => this.handleCardAction(data)
    );
  }

  startCallbackServer(): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.on("request", lark.adaptDefault(this.config.feishuCallbackPath, this.cardHandler));
      server.listen(this.config.feishuCallbackPort, "0.0.0.0", () => resolve());
      this.server = server;
    });
  }

  async sendInteractiveCard(card: InteractiveCard): Promise<string> {
    const response = (await this.client.im.v1.message.create({
      params: {
        receive_id_type: this.config.feishuApprovalReceiveIdType
      },
      data: {
        receive_id: this.config.feishuApprovalReceiveId ?? "",
        content: JSON.stringify(card),
        msg_type: "interactive"
      }
    })) as {
      data?: {
        message_id?: string;
      };
    };

    const messageId = response.data?.message_id;
    if (!messageId) {
      throw new Error("Feishu sendInteractiveCard returned no message_id");
    }
    return messageId;
  }

  async updateInteractiveCard(messageId: string, card: InteractiveCard): Promise<void> {
    await this.client.im.v1.message.patch({
      path: {
        message_id: messageId
      },
      data: {
        content: JSON.stringify(card)
      }
    });
  }

  close(): void {
    this.server?.close();
  }

  private async handleCardAction(data: InteractiveCardActionEvent): Promise<InteractiveCard> {
    const actorId = data.open_id ?? data.user_id ?? "";
    const actorName = actorId;
    const approvalKey = String(data.action?.value?.approval_key ?? "");
    const decision = String(data.action?.value?.decision ?? "") as ApprovalDecision;

    this.emit("action", {
      approvalKey,
      decision,
      actorId,
      actorName
    });

    return {
      config: {
        wide_screen_mode: true,
        enable_forward: false
      },
      header: {
        template: "blue",
        title: {
          tag: "plain_text",
          content: "审批处理中"
        }
      },
      elements: [
        {
          tag: "markdown",
          content: `已收到操作，正在提交给 Codex。\nuser=${actorId}\ndecision=${decision}`
        }
      ]
    };
  }
}
