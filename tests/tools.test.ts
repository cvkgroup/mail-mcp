import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { MailService } from "../src/index.js";
import type { MessageClass } from "../src/types.js";

class FakeTransport {
  readonly calls: Array<{ targetSeatId: string; messageClass: MessageClass; wakeText: string }> = [];

  constructor(private readonly failTargets = new Set<string>()) {}

  async pushWake(targetSeatId: string, messageClass: MessageClass, wakeText: string) {
    this.calls.push({ targetSeatId, messageClass, wakeText });
    if (this.failTargets.has(targetSeatId)) {
      return { success: false, error: "push failed" };
    }
    return { success: true };
  }
}

const baseDir = path.join(process.cwd(), "test-workdir", "tools");

describe("MailService tools", () => {
  beforeEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });
  });

  it("registers seats, enforces ACLs, routes inbox/read/ack/status flow, and persists send files", async () => {
    const transport = new FakeTransport();
    const service = await new MailService({
      baseDir,
      transport,
      startEscalationTimer: false,
    }).init();

    await service.registerSeat({ caller_seat_id: "lead", id: "lead", role: "lead", lane: "hq" });
    await service.registerSeat({
      caller_seat_id: "lead",
      id: "orch",
      role: "orchestrator",
      lane: "lane-a",
      escalation_target: "lead",
    });
    await service.registerSeat({
      caller_seat_id: "lead",
      id: "worker",
      role: "worker",
      lane: "lane-a",
      escalation_target: "orch",
    });

    const message = await service.sendMessage({
      caller_seat_id: "orch",
      to: "worker",
      kind: "request",
      class: "interrupt",
      subject: "Handle alert",
      body: "Investigate the failed deployment.",
      expects_reply: true,
      deadline_seconds: 60,
    });

    expect(message.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(message.thread).toBe(message.id);
    expect(transport.calls).toEqual([
      {
        targetSeatId: "worker",
        messageClass: "interrupt",
        wakeText: `mail:${message.id}:interrupt:orch`,
      },
    ]);

    await expect(
      service.sendMessage({
        caller_seat_id: "worker",
        to: "lead",
        kind: "status",
        class: "when_ready",
        subject: "Nope",
        body: "Workers cannot contact lead directly.",
      }),
    ).rejects.toThrow(/own orchestrator/);

    const inbox = await service.inbox({ caller_seat_id: "worker" });
    expect(inbox.messages.map((item) => item.id)).toEqual([message.id]);
    expect(inbox.messages[0]?.body).toBe("");
    expect(inbox.messages[0]?.state).toBe("DELIVERED");

    const read = await service.readMessage({ caller_seat_id: "worker", id: message.id });
    expect(read.body).toBe("Investigate the failed deployment.");
    expect(read.state).toBe("READ");

    const acked = await service.ackMessage({
      caller_seat_id: "worker",
      id: message.id,
      disposition: "ACTED",
      note: "On it",
    });
    expect(acked.message.state).toBe("ACKED");
    expect(acked.ack?.disposition).toBe("ACTED");

    const status = await service.status({ caller_seat_id: "orch", id: message.id });
    expect(status.message.state).toBe("ACKED");
    expect(status.ack?.note).toBe("On it");

    service.stop();
  });

  it("marks push failures as UNDELIVERED", async () => {
    const transport = new FakeTransport(new Set(["worker"]));
    const service = await new MailService({
      baseDir,
      transport,
      startEscalationTimer: false,
    }).init();

    await service.registerSeat({ caller_seat_id: "lead", id: "lead", role: "lead", lane: "hq" });
    await service.registerSeat({ caller_seat_id: "lead", id: "worker", role: "worker", lane: "lane-a", escalation_target: "lead" });

    const message = await service.sendMessage({
      caller_seat_id: "lead",
      to: "worker",
      kind: "request",
      class: "when_ready",
      subject: "Queued",
      body: "Take this when ready.",
    });

    expect(message.push_state).toBe("UNDELIVERED");
    service.stop();
  });

  it("repushes overdue messages and escalates after three retries", async () => {
    let current = new Date("2026-08-15T08:00:00.000Z");
    const now = () => current;
    const transport = new FakeTransport();
    const service = await new MailService({
      baseDir,
      transport,
      now,
      startEscalationTimer: false,
    }).init();

    await service.registerSeat({ caller_seat_id: "lead", id: "lead", role: "lead", lane: "hq" });
    await service.registerSeat({
      caller_seat_id: "lead",
      id: "orch",
      role: "orchestrator",
      lane: "lane-a",
      escalation_target: "lead",
    });
    await service.registerSeat({
      caller_seat_id: "lead",
      id: "worker",
      role: "worker",
      lane: "lane-a",
      escalation_target: "orch",
    });

    const message = await service.sendMessage({
      caller_seat_id: "orch",
      to: "worker",
      kind: "request",
      class: "interrupt",
      subject: "Deadline",
      body: "Acknowledge quickly.",
      expects_reply: true,
      deadline_seconds: 1,
    });

    current = new Date("2026-08-15T08:00:02.000Z");
    await service.escalationManager.checkDeadlines();
    await service.escalationManager.checkDeadlines();
    await service.escalationManager.checkDeadlines();
    await service.escalationManager.checkDeadlines();

    const audit = await service.audit({ caller_seat_id: "lead", seat_a: "orch", seat_b: "worker" });
    expect(audit.messages[0]?.escalation_history).toHaveLength(4);
    expect(audit.messages[0]?.escalation_history[3]?.type).toBe("escalated");

    const escalations = service.store
      .listMessages()
      .filter((record) => record.message.kind === "escalation")
      .map((record) => record.message);

    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.to).toBe("orch");
    expect(escalations[0]?.thread).toBe(message.thread);
    expect(transport.calls.slice(-1)[0]?.wakeText).toBe(`mail:${escalations[0]?.id}:interrupt:worker`);

    service.stop();
  });

  it("supersedes unread messages but rejects superseding after read", async () => {
    const transport = new FakeTransport();
    const service = await new MailService({
      baseDir,
      transport,
      startEscalationTimer: false,
    }).init();

    await service.registerSeat({ caller_seat_id: "lead", id: "lead", role: "lead", lane: "hq" });
    await service.registerSeat({ caller_seat_id: "lead", id: "worker", role: "worker", lane: "lane-a", escalation_target: "lead" });

    const first = await service.sendMessage({
      caller_seat_id: "lead",
      to: "worker",
      kind: "request",
      class: "when_ready",
      subject: "Old plan",
      body: "Ignore this soon.",
    });

    const superseded = await service.supersede({ caller_seat_id: "lead", id: first.id, note: "Newer request sent." });
    expect(superseded.ack?.disposition).toBe("SUPERSEDED");

    const second = await service.sendMessage({
      caller_seat_id: "lead",
      to: "worker",
      kind: "request",
      class: "when_ready",
      subject: "Current plan",
      body: "Use this one instead.",
    });

    await service.readMessage({ caller_seat_id: "worker", id: second.id });
    await expect(service.supersede({ caller_seat_id: "lead", id: second.id })).rejects.toThrow(/already been read/);

    service.stop();
  });
});
