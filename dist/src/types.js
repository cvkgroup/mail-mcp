export const MESSAGE_STATES = ["SENT", "DELIVERED", "READ", "ACKED"];
export const PUSH_STATES = ["PENDING", "DELIVERED", "UNDELIVERED", "HELD"];
export const SEAT_ROLES = ["lead", "architect", "orchestrator", "worker"];
export const MESSAGE_CLASSES = ["interrupt", "when_ready"];
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
];
export const ACK_DISPOSITIONS = ["ACTED", "BLOCKED", "SUPERSEDED"];
