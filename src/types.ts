export const MESSAGE_STATES = ["SENT", "DELIVERED", "READ", "ACKED"] as const;
export const PUSH_STATES = ["PENDING", "DELIVERED", "UNDELIVERED", "HELD"] as const;
export const SEAT_ROLES = ["lead", "architect", "orchestrator", "worker"] as const;
export const MESSAGE_CLASSES = ["interrupt", "when_ready"] as const;
export const MESSAGE_KINDS = [
  "request",
  "ruling",
  "submission",
  "review",
  "fix-response",
  "run-report",
  "acceptance",
  "question",
  "answer",
  "contest",
  "status",
  "handoff",
  "escalation",
] as const;
export const ACK_DISPOSITIONS = ["ACTED", "BLOCKED", "SUPERSEDED"] as const;

export type MessageState = (typeof MESSAGE_STATES)[number];
export type PushState = (typeof PUSH_STATES)[number];
export type SeatRole = (typeof SEAT_ROLES)[number];
export type MessageClass = (typeof MESSAGE_CLASSES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type AckDisposition = (typeof ACK_DISPOSITIONS)[number];

export interface Seat {
  id: string;
  role: SeatRole;
  lane: string;
  escalation_target?: string;
}

export interface Message {
  id: string;
  seq: number;
  from: string;
  to: string;
  kind: MessageKind;
  class: MessageClass;
  subject: string;
  body: string;
  thread: string;
  sent_at: string;
  state: MessageState;
  state_timestamps: Partial<Record<MessageState, string>>;
  blocks?: string[];
  expects_reply?: boolean;
  deadline_seconds?: number;
  push_state: PushState;
}

export interface MessageAck {
  disposition: AckDisposition;
  note: string;
  at: string;
}

export interface EscalationEvent {
  type: "repush" | "escalated";
  attempt: number;
  at: string;
  success?: boolean;
  error?: string;
  target?: string;
  escalation_message_id?: string;
}

export interface StoredMessage {
  message: Message;
  file_path: string;
  ack?: MessageAck;
  escalation_history: EscalationEvent[];
}

export interface MessageDraft {
  from: string;
  to: string;
  kind: MessageKind;
  class: MessageClass;
  subject: string;
  body: string;
  blocks?: string[];
  expects_reply?: boolean;
  deadline_seconds?: number;
  thread?: string;
}

export interface SendMessageInput {
  caller_seat_id: string;
  to: string;
  kind: MessageKind;
  class: MessageClass;
  subject: string;
  body: string;
  blocks?: string[];
  expects_reply?: boolean;
  deadline_seconds?: number;
  id?: unknown;
  seq?: unknown;
  sent_at?: unknown;
  thread?: unknown;
}

export interface RegisterSeatInput extends Seat {
  caller_seat_id: string;
}

export interface AckInput {
  caller_seat_id: string;
  id: string;
  disposition: AckDisposition;
  note: string;
}

export interface ReadInput {
  caller_seat_id: string;
  id: string;
}

export interface StatusInput {
  caller_seat_id: string;
  id: string;
}

export interface InboxInput {
  caller_seat_id: string;
}

export interface AuditInput {
  caller_seat_id: string;
  seat_a: string;
  seat_b: string;
}

export interface SupersedeInput {
  caller_seat_id: string;
  id: string;
  note?: string;
}

export type MailEvent =
  | { type: "message_index"; message: Message; file_path: string }
  | { type: "message_state"; message_id: string; state: MessageState; at: string }
  | { type: "message_push"; message_id: string; push_state: PushState; at: string; error?: string }
  | { type: "message_ack"; message_id: string; disposition: AckDisposition; note: string; at: string }
  | { type: "message_escalation"; message_id: string; event: EscalationEvent };
