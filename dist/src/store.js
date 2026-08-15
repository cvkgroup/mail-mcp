import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
function sanitizeFilePart(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
export class MailStore {
    sequencer;
    now;
    baseDir;
    indexPath;
    messages = new Map();
    constructor(baseDir, sequencer, now = () => new Date()) {
        this.sequencer = sequencer;
        this.now = now;
        this.baseDir = baseDir;
        this.indexPath = path.join(this.baseDir, "mail.jsonl");
    }
    async init() {
        await mkdir(this.baseDir, { recursive: true });
        try {
            const raw = await readFile(this.indexPath, "utf8");
            const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                const event = JSON.parse(line);
                this.applyEvent(event);
            }
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }
    listMessages() {
        return [...this.messages.values()]
            .map((message) => clone(message))
            .sort((left, right) => left.message.seq - right.message.seq);
    }
    getMessage(id) {
        const record = this.messages.get(id);
        return record ? clone(record) : undefined;
    }
    async createMessage(draft, recipientLane) {
        const id = uuidv4();
        const seq = await this.sequencer.next();
        const sentAt = this.now().toISOString();
        const thread = draft.thread ?? id;
        const message = {
            id,
            seq,
            from: draft.from,
            to: draft.to,
            kind: draft.kind,
            class: draft.class,
            subject: draft.subject,
            body: draft.body,
            thread,
            sent_at: sentAt,
            state: "SENT",
            state_timestamps: { SENT: sentAt },
            blocks: draft.blocks,
            expects_reply: draft.expects_reply,
            deadline_seconds: draft.deadline_seconds,
            push_state: "PENDING",
        };
        const directory = path.join(this.baseDir, sanitizeFilePart(recipientLane));
        await mkdir(directory, { recursive: true });
        const filename = `${seq}-${sanitizeFilePart(message.from)}-to-${sanitizeFilePart(message.to)}-${sanitizeFilePart(message.kind)}.md`;
        const filePath = path.join(directory, filename);
        await writeFile(filePath, this.renderMessageFile(message), { encoding: "utf8", flag: "wx" });
        const event = { type: "message_index", message, file_path: filePath };
        await this.appendEvent(event);
        this.applyEvent(event);
        return this.getRequired(id);
    }
    async markState(messageId, state, at = this.now().toISOString()) {
        const event = { type: "message_state", message_id: messageId, state, at };
        await this.appendEvent(event);
        this.applyEvent(event);
        return this.getRequired(messageId);
    }
    async markPushState(messageId, pushState, error, at = this.now().toISOString()) {
        const event = { type: "message_push", message_id: messageId, push_state: pushState, at, error };
        await this.appendEvent(event);
        this.applyEvent(event);
        return this.getRequired(messageId);
    }
    async ackMessage(messageId, disposition, note, at = this.now().toISOString()) {
        const event = { type: "message_ack", message_id: messageId, disposition, note, at };
        await this.appendEvent(event);
        this.applyEvent(event);
        return this.getRequired(messageId);
    }
    async appendEscalationEvent(messageId, escalationEvent) {
        const event = { type: "message_escalation", message_id: messageId, event: escalationEvent };
        await this.appendEvent(event);
        this.applyEvent(event);
        return this.getRequired(messageId);
    }
    getRequired(messageId) {
        const record = this.getMessage(messageId);
        if (!record) {
            throw new Error(`Unknown message: ${messageId}`);
        }
        return record;
    }
    async appendEvent(event) {
        await appendFile(this.indexPath, `${JSON.stringify(event)}\n`, "utf8");
    }
    applyEvent(event) {
        if (event.type === "message_index") {
            this.sequencer.setCurrent(event.message.seq);
            this.messages.set(event.message.id, {
                message: clone(event.message),
                file_path: event.file_path,
                escalation_history: [],
            });
            return;
        }
        const current = this.messages.get(event.message_id);
        if (!current) {
            throw new Error(`Cannot apply event for missing message ${event.message_id}`);
        }
        if (event.type === "message_state") {
            current.message.state = event.state;
            current.message.state_timestamps[event.state] = event.at;
            return;
        }
        if (event.type === "message_push") {
            current.message.push_state = event.push_state;
            return;
        }
        if (event.type === "message_ack") {
            current.message.state = "ACKED";
            current.message.state_timestamps.ACKED = event.at;
            current.ack = {
                disposition: event.disposition,
                note: event.note,
                at: event.at,
            };
            return;
        }
        current.escalation_history.push(clone(event.event));
    }
    renderMessageFile(message) {
        const lines = [
            `# Message ${message.seq}: ${message.subject}`,
            "",
            `- id: ${message.id}`,
            `- seq: ${message.seq}`,
            `- from: ${message.from}`,
            `- to: ${message.to}`,
            `- kind: ${message.kind}`,
            `- class: ${message.class}`,
            `- thread: ${message.thread}`,
            `- sent_at: ${message.sent_at}`,
            `- state: ${message.state}`,
            `- push_state: ${message.push_state}`,
            `- expects_reply: ${message.expects_reply ?? false}`,
            `- deadline_seconds: ${message.deadline_seconds ?? ""}`,
            "",
            "## Body",
            "",
            message.body,
        ];
        if (message.blocks?.length) {
            lines.push("", "## Blocks", "");
            for (const block of message.blocks) {
                lines.push(`- ${block}`);
            }
        }
        return `${lines.join("\n")}\n`;
    }
}
