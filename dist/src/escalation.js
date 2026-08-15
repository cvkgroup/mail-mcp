export class EscalationManager {
    store;
    registry;
    transport;
    callbacks;
    now;
    intervalMs;
    timer;
    constructor(store, registry, transport, callbacks, now = () => new Date(), intervalMs = 1_000) {
        this.store = store;
        this.registry = registry;
        this.transport = transport;
        this.callbacks = callbacks;
        this.now = now;
        this.intervalMs = intervalMs;
    }
    start() {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            void this.checkDeadlines();
        }, this.intervalMs);
        this.timer.unref?.();
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    async checkDeadlines() {
        for (const record of this.store.listMessages()) {
            await this.maybeEscalate(record);
        }
    }
    async maybeEscalate(record) {
        const { message } = record;
        if (!message.expects_reply || !message.deadline_seconds) {
            return;
        }
        if (message.state === "ACKED") {
            return;
        }
        const dueAt = new Date(message.sent_at).getTime() + message.deadline_seconds * 1_000;
        if (this.now().getTime() < dueAt) {
            return;
        }
        const repushCount = record.escalation_history.filter((event) => event.type === "repush").length;
        if (repushCount < 3) {
            const wakeText = `mail:${message.id}:${message.class}:${message.from}`;
            const result = await this.transport.pushWake(message.to, message.class, wakeText);
            await this.store.markPushState(message.id, result.success ? "DELIVERED" : "UNDELIVERED");
            await this.store.appendEscalationEvent(message.id, {
                type: "repush",
                attempt: repushCount + 1,
                at: this.now().toISOString(),
                success: result.success,
                error: result.error,
            });
            return;
        }
        if (record.escalation_history.some((event) => event.type === "escalated")) {
            return;
        }
        const seat = this.registry.getRequired(message.to);
        if (!seat.escalation_target) {
            return;
        }
        const escalationMessageId = await this.callbacks.createEscalationMessage(message, seat.escalation_target);
        await this.store.appendEscalationEvent(message.id, {
            type: "escalated",
            attempt: repushCount,
            at: this.now().toISOString(),
            target: seat.escalation_target,
            escalation_message_id: escalationMessageId,
            success: true,
        });
    }
}
