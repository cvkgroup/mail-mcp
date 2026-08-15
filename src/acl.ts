import type { MessageClass, Seat } from "./types.js";

export function assertCanSend(sender: Seat, recipient: Seat, messageClass: MessageClass): void {
  if (sender.role === "lead" || sender.role === "architect") {
    return;
  }

  if (sender.role === "worker") {
    if (messageClass !== "when_ready") {
      throw new Error("Workers may only send when_ready messages.");
    }

    if (recipient.role !== "orchestrator" || recipient.lane !== sender.lane) {
      throw new Error("Workers may only send to their own orchestrator.");
    }

    return;
  }

  if (sender.role === "orchestrator") {
    if (messageClass === "interrupt") {
      if (recipient.role !== "worker" || recipient.lane !== sender.lane) {
        throw new Error("Orchestrators may interrupt only workers in their own lane.");
      }

      return;
    }

    if (messageClass === "when_ready") {
      return;
    }
  }

  throw new Error("ACL rejected message.");
}
