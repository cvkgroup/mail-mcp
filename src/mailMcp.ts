export interface Message {
  id: string;
  from: string;
  to: string;
  body: string;
  requiresAck: boolean;
  acknowledged: boolean;
  attempts: number;
}

interface Agent {
  id: string;
  parentId: string | null;
  rootId: string;
  inbox: Message[];
}

export class MailMcp {
  private readonly agents = new Map<string, Agent>();
  private readonly pendingByMessageId = new Map<string, Message>();
  private messageCounter = 0;

  registerAgent(id: string, parentId?: string): void {
    if (this.agents.has(id)) {
      throw new Error(`Agent already exists: ${id}`);
    }

    if (parentId !== undefined && !this.agents.has(parentId)) {
      throw new Error(`Parent agent does not exist: ${parentId}`);
    }

    const rootId = parentId === undefined ? id : this.agents.get(parentId)!.rootId;

    this.agents.set(id, {
      id,
      parentId: parentId ?? null,
      rootId,
      inbox: []
    });
  }

  sendMessage(from: string, to: string, body: string, requiresAck = true): string {
    const sender = this.getAgent(from);
    const recipient = this.getAgent(to);

    if (sender.rootId !== recipient.rootId) {
      throw new Error(`Cross-hierarchy delivery is not allowed: ${from} -> ${to}`);
    }

    const id = `msg-${++this.messageCounter}`;
    const message: Message = {
      id,
      from,
      to,
      body,
      requiresAck,
      acknowledged: false,
      attempts: 1
    };

    recipient.inbox.push({ ...message });
    if (requiresAck) {
      this.pendingByMessageId.set(id, message);
    }

    return id;
  }

  pollInbox(agentId: string): Message[] {
    const agent = this.getAgent(agentId);
    return agent.inbox.map((message) => ({ ...message }));
  }

  acknowledge(agentId: string, messageId: string): void {
    const pending = this.pendingByMessageId.get(messageId);
    if (!pending) {
      throw new Error(`Message is not pending acknowledgement: ${messageId}`);
    }

    if (pending.to !== agentId) {
      throw new Error(`Only recipient ${pending.to} can acknowledge ${messageId}`);
    }

    pending.acknowledged = true;
    this.pendingByMessageId.delete(messageId);
  }

  getPendingAcknowledgements(agentId: string): Message[] {
    this.getAgent(agentId);
    const pending = [...this.pendingByMessageId.values()].filter((message) => message.from === agentId);
    return pending.map((message) => ({ ...message }));
  }

  retryUnacknowledged(agentId: string): number {
    this.getAgent(agentId);

    let redelivered = 0;

    for (const pending of this.pendingByMessageId.values()) {
      if (pending.from !== agentId) {
        continue;
      }

      pending.attempts += 1;
      const recipient = this.getAgent(pending.to);
      recipient.inbox.push({ ...pending });
      redelivered += 1;
    }

    return redelivered;
  }

  private getAgent(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Unknown agent: ${id}`);
    }

    return agent;
  }
}
