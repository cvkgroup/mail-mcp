import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { assertCanSend } from "./acl.js";
import { EscalationManager } from "./escalation.js";
import { SeatRegistry } from "./registry.js";
import { Sequencer } from "./sequencer.js";
import { MailStore } from "./store.js";
import { PrimeAgentTransport, type WakeTransport } from "./transport.js";
import type {
  AckInput,
  AuditInput,
  InboxInput,
  Message,
  MessageClass,
  MessageDraft,
  ReadInput,
  RegisterSeatInput,
  Seat,
  SendMessageInput,
  StatusInput,
  StoredMessage,
  SupersedeInput,
} from "./types.js";
import { ACK_DISPOSITIONS, MESSAGE_CLASSES, MESSAGE_KINDS, SEAT_ROLES } from "./types.js";

const registerSeatSchema = z
  .object({
    caller_seat_id: z.string().min(1),
    id: z.string().min(1),
    role: z.enum(SEAT_ROLES),
    lane: z.string().min(1),
    escalation_target: z.string().min(1).optional(),
  })
  .strict();

const sendSchema = z
  .object({
    caller_seat_id: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(MESSAGE_KINDS),
    class: z.enum(MESSAGE_CLASSES),
    subject: z.string().min(1),
    body: z.string().min(1),
    blocks: z.array(z.string().min(1)).optional(),
    expects_reply: z.boolean().optional(),
    deadline_seconds: z.number().int().positive().optional(),
  })
  .strict();

const inboxSchema = z.object({ caller_seat_id: z.string().min(1) }).strict();
const readSchema = z.object({ caller_seat_id: z.string().min(1), id: z.string().uuid() }).strict();
const ackSchema = z
  .object({
    caller_seat_id: z.string().min(1),
    id: z.string().uuid(),
    disposition: z.enum(ACK_DISPOSITIONS),
    note: z.string().min(1),
  })
  .strict();
const statusSchema = z.object({ caller_seat_id: z.string().min(1), id: z.string().uuid() }).strict();
const auditSchema = z
  .object({
    caller_seat_id: z.string().min(1),
    seat_a: z.string().min(1),
    seat_b: z.string().min(1),
  })
  .strict();
const supersedeSchema = z
  .object({
    caller_seat_id: z.string().min(1),
    id: z.string().uuid(),
    note: z.string().optional(),
  })
  .strict();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function assertNoServerAssignedFields(input: SendMessageInput): void {
  for (const field of ["id", "seq", "sent_at", "thread"] as const) {
    if (field in input) {
      throw new Error(`Client may not supply ${field}.`);
    }
  }
}

export interface MailServiceOptions {
  cwd?: string;
  baseDir?: string;
  now?: () => Date;
  transport?: WakeTransport;
  startEscalationTimer?: boolean;
}

export class MailService {
  readonly registry: SeatRegistry;
  readonly store: MailStore;
  readonly transport: WakeTransport;
  readonly escalationManager: EscalationManager;
  private readonly now: () => Date;

  constructor(options: MailServiceOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    const baseDir = options.baseDir ?? path.join(cwd, "week7", "mail");
    this.now = options.now ?? (() => new Date());
    this.registry = new SeatRegistry(baseDir);
    this.store = new MailStore(baseDir, new Sequencer(), this.now);
    this.transport = options.transport ?? new PrimeAgentTransport();
    this.escalationManager = new EscalationManager(
      this.store,
      this.registry,
      this.transport,
      {
        createEscalationMessage: async (message, targetSeatId) => {
          const escalation = await this.sendInternalMessage({
            from: message.to,
            to: targetSeatId,
            kind: "escalation",
            class: "interrupt",
            subject: `Escalation: ${message.subject}`,
            body: `Message ${message.id} from ${message.from} to ${message.to} exceeded its deadline without acknowledgement.`,
            blocks: [`original_message:${message.id}`],
            thread: message.thread,
          });
          return escalation.message.id;
        },
      },
      this.now,
    );
    this.startEscalationTimer = options.startEscalationTimer ?? true;
  }

  private readonly startEscalationTimer: boolean;

  async init(): Promise<this> {
    await this.registry.load();
    await this.store.init();
    if (this.startEscalationTimer) {
      this.escalationManager.start();
    }
    return this;
  }

  stop(): void {
    this.escalationManager.stop();
  }

  async registerSeat(input: RegisterSeatInput): Promise<Seat> {
    const parsed = registerSeatSchema.parse(input);
    const existingCaller = this.registry.get(parsed.caller_seat_id);

    if (!existingCaller) {
      if (parsed.caller_seat_id !== parsed.id) {
        throw new Error("Unregistered callers may only self-register.");
      }
    } else if (existingCaller.role !== "lead" && existingCaller.role !== "architect" && existingCaller.id !== parsed.id) {
      throw new Error("Only lead or architect seats may register other seats.");
    }

    if (parsed.escalation_target && !this.registry.has(parsed.escalation_target) && parsed.escalation_target !== parsed.id) {
      throw new Error(`Escalation target must already be registered: ${parsed.escalation_target}`);
    }

    return this.registry.register({
      id: parsed.id,
      role: parsed.role,
      lane: parsed.lane,
      escalation_target: parsed.escalation_target,
    });
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    assertNoServerAssignedFields(input);
    const parsed = sendSchema.parse(input);
    const sender = this.registry.getRequired(parsed.caller_seat_id);
    const recipient = this.registry.getRequired(parsed.to);
    assertCanSend(sender, recipient, parsed.class);
    const record = await this.sendInternalMessage({
      from: sender.id,
      to: recipient.id,
      kind: parsed.kind,
      class: parsed.class,
      subject: parsed.subject,
      body: parsed.body,
      blocks: parsed.blocks,
      expects_reply: parsed.expects_reply,
      deadline_seconds: parsed.deadline_seconds,
    });
    return record.message;
  }

  async inbox(input: InboxInput): Promise<{ messages: Message[] }> {
    const parsed = inboxSchema.parse(input);
    this.registry.getRequired(parsed.caller_seat_id);

    const unread = this.store
      .listMessages()
      .filter((record) => record.message.to === parsed.caller_seat_id)
      .filter((record) => record.message.state === "SENT" || record.message.state === "DELIVERED")
      .sort((left, right) => {
        if (left.message.class !== right.message.class) {
          return left.message.class === "interrupt" ? -1 : 1;
        }
        return left.message.seq - right.message.seq;
      });

    const results: Message[] = [];
    for (const record of unread) {
      if (record.message.state === "SENT") {
        await this.store.markState(record.message.id, "DELIVERED");
      }
      results.push(this.hideBody(this.store.getMessage(record.message.id)!.message));
    }

    return { messages: results };
  }

  async readMessage(input: ReadInput): Promise<Message> {
    const parsed = readSchema.parse(input);
    const record = this.requireMessage(parsed.id);
    if (record.message.to !== parsed.caller_seat_id) {
      throw new Error("Only the recipient may read a message.");
    }

    if (record.message.state !== "READ" && record.message.state !== "ACKED") {
      await this.store.markState(record.message.id, "READ");
    }

    return this.requireMessage(parsed.id).message;
  }

  async ackMessage(input: AckInput): Promise<StoredMessage> {
    const parsed = ackSchema.parse(input);
    if (parsed.note.includes("\n")) {
      throw new Error("Ack note must be a single line.");
    }

    const record = this.requireMessage(parsed.id);
    if (record.message.to !== parsed.caller_seat_id) {
      throw new Error("Only the recipient may acknowledge a message.");
    }

    if (record.message.state !== "READ" && record.message.state !== "ACKED") {
      await this.store.markState(record.message.id, "READ");
    }

    if (record.message.state === "ACKED") {
      return this.requireMessage(parsed.id);
    }

    return this.store.ackMessage(parsed.id, parsed.disposition, parsed.note);
  }

  async status(input: StatusInput): Promise<StoredMessage> {
    const parsed = statusSchema.parse(input);
    const record = this.requireMessage(parsed.id);
    if (record.message.from !== parsed.caller_seat_id) {
      throw new Error("Only the sender may view message status.");
    }
    return record;
  }

  async audit(input: AuditInput): Promise<{ messages: StoredMessage[] }> {
    const parsed = auditSchema.parse(input);
    this.registry.getRequired(parsed.caller_seat_id);
    this.registry.getRequired(parsed.seat_a);
    this.registry.getRequired(parsed.seat_b);

    const messages = this.store
      .listMessages()
      .filter((record) => {
        const isPair =
          (record.message.from === parsed.seat_a && record.message.to === parsed.seat_b) ||
          (record.message.from === parsed.seat_b && record.message.to === parsed.seat_a);
        const unread = record.message.state === "SENT" || record.message.state === "DELIVERED";
        return isPair && unread;
      });

    return { messages };
  }

  async supersede(input: SupersedeInput): Promise<StoredMessage> {
    const parsed = supersedeSchema.parse(input);
    const record = this.requireMessage(parsed.id);
    if (record.message.from !== parsed.caller_seat_id) {
      throw new Error("Only the sender may supersede a message.");
    }

    if (record.message.state === "READ" || record.message.state === "ACKED") {
      throw new Error("Cannot supersede a message that has already been read.");
    }

    return this.store.ackMessage(parsed.id, "SUPERSEDED", parsed.note ?? "Superseded by sender.");
  }

  private requireMessage(id: string): StoredMessage {
    const record = this.store.getMessage(id);
    if (!record) {
      throw new Error(`Unknown message: ${id}`);
    }
    return record;
  }

  private hideBody(message: Message): Message {
    return {
      ...clone(message),
      body: "",
    };
  }

  private async sendInternalMessage(draft: MessageDraft): Promise<StoredMessage> {
    const recipient = this.registry.getRequired(draft.to);
    const record = await this.store.createMessage(draft, recipient.lane);
    const wakeText = `mail:${record.message.id}:${record.message.class}:${record.message.from}`;
    const pushResult = await this.transport.pushWake(record.message.to, record.message.class as MessageClass, wakeText);
    await this.store.markPushState(record.message.id, pushResult.success ? "DELIVERED" : "UNDELIVERED", pushResult.error);
    return this.requireMessage(record.message.id);
  }
}

export async function createMailService(options: MailServiceOptions = {}): Promise<MailService> {
  return new MailService(options).init();
}

export async function createMcpServer(service?: MailService): Promise<McpServer> {
  const resolvedService = service ?? (await createMailService());
  const server = new McpServer({
    name: "venus-mail",
    version: "1.0.0",
  });

  server.registerTool(
    "mail_register_seat",
    {
      description: "Register a mail seat for inter-agent routing.",
      inputSchema: registerSeatSchema,
    },
    async (args) => toToolResult(await resolvedService.registerSeat(args)),
  );

  server.registerTool(
    "mail_send",
    {
      description: "Send a routed mail message to another registered seat.",
      inputSchema: sendSchema,
    },
    async (args) => toToolResult(await resolvedService.sendMessage(args as SendMessageInput)),
  );

  server.registerTool(
    "mail_inbox",
    {
      description: "List unread mail for the caller, prioritizing interrupts.",
      inputSchema: inboxSchema,
    },
    async (args) => toToolResult(await resolvedService.inbox(args)),
  );

  server.registerTool(
    "mail_read",
    {
      description: "Read the full contents of a mail message.",
      inputSchema: readSchema,
    },
    async (args) => toToolResult(await resolvedService.readMessage(args)),
  );

  server.registerTool(
    "mail_ack",
    {
      description: "Acknowledge a mail message with a disposition.",
      inputSchema: ackSchema,
    },
    async (args) => toToolResult(await resolvedService.ackMessage(args)),
  );

  server.registerTool(
    "mail_status",
    {
      description: "Get the current state for a message you sent.",
      inputSchema: statusSchema,
    },
    async (args) => toToolResult(await resolvedService.status(args)),
  );

  server.registerTool(
    "mail_audit",
    {
      description: "Audit unread traffic and escalation history between two seats.",
      inputSchema: auditSchema,
    },
    async (args) => toToolResult(await resolvedService.audit(args)),
  );

  server.registerTool(
    "mail_supersede",
    {
      description: "Supersede an unread message you previously sent.",
      inputSchema: supersedeSchema,
    },
    async (args) => toToolResult(await resolvedService.supersede(args)),
  );

  return server;
}

export async function main(): Promise<void> {
  const service = await createMailService();
  const server = await createMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
