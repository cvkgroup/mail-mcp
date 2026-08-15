import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { Sequencer } from "../src/sequencer.js";
import { MailStore } from "../src/store.js";

const baseDir = path.join(process.cwd(), "test-workdir", "store");

describe("MailStore", () => {
  beforeEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });
  });

  it("persists immutable message files and reloads state from disk", async () => {
    let current = new Date("2026-08-15T08:00:00.000Z");
    const now = () => current;
    const store = new MailStore(baseDir, new Sequencer(), now);
    await store.init();

    const created = await store.createMessage(
      {
        from: "orch",
        to: "worker",
        kind: "request",
        class: "interrupt",
        subject: "Fix it",
        body: "Please fix the failing test.",
      },
      "lane-a",
    );

    current = new Date("2026-08-15T08:00:10.000Z");
    await store.markPushState(created.message.id, "DELIVERED");
    await store.markState(created.message.id, "DELIVERED");
    current = new Date("2026-08-15T08:00:20.000Z");
    await store.markState(created.message.id, "READ");
    current = new Date("2026-08-15T08:00:30.000Z");
    await store.ackMessage(created.message.id, "ACTED", "Done");

    const reloaded = new MailStore(baseDir, new Sequencer(), now);
    await reloaded.init();
    const message = reloaded.getMessage(created.message.id);

    expect(message?.message.thread).toBe(created.message.id);
    expect(message?.message.state).toBe("ACKED");
    expect(message?.message.push_state).toBe("DELIVERED");
    expect(message?.ack?.note).toBe("Done");
    expect(message?.file_path).toMatch(/lane-a\/1-orch-to-worker-request\.md$/);
  });
});
