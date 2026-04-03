import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ApprovalDecision, ApprovalRecord } from "./types.js";

export class TerminalApprover {
  private readonly rl = readline.createInterface({ input, output });
  private queue = Promise.resolve<ApprovalDecision>("decline");

  async prompt(record: ApprovalRecord, allowAcceptForSession: boolean): Promise<ApprovalDecision> {
    const next = this.queue.then(() => this.promptInternal(record, allowAcceptForSession));
    this.queue = next.catch(() => "decline");
    return next;
  }

  close(): void {
    this.rl.close();
  }

  private async promptInternal(
    record: ApprovalRecord,
    allowAcceptForSession: boolean
  ): Promise<ApprovalDecision> {
    const supported = record.availableDecisions.filter((decision) => {
      if (decision === "acceptForSession" && !allowAcceptForSession) {
        return false;
      }
      return true;
    });

    const helpText = supported.join(" / ");
    output.write("\n");
    output.write(`[approval] ${record.kind} ${record.key}\n`);
    output.write(`cwd: ${record.cwd ?? "-"}\n`);
    if (record.reason) {
      output.write(`reason: ${record.reason}\n`);
    }
    if (record.command) {
      output.write(`command: ${record.command}\n`);
    }
    if (record.grantRoot) {
      output.write(`grantRoot: ${record.grantRoot}\n`);
    }

    for (;;) {
      const answer = (await this.rl.question(`decision (${helpText}): `)).trim() as ApprovalDecision;
      if (supported.includes(answer)) {
        return answer;
      }
      output.write(`unsupported decision: ${answer}\n`);
    }
  }
}
