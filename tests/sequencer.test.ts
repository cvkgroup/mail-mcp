import { describe, expect, it } from "vitest";

import { Sequencer } from "../src/sequencer.js";

describe("Sequencer", () => {
  it("allocates unique monotonic values under concurrency", async () => {
    const sequencer = new Sequencer();

    const values = await Promise.all(Array.from({ length: 25 }, () => sequencer.next()));

    expect(values).toHaveLength(25);
    expect(new Set(values).size).toBe(25);
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
  });

  it("can advance its current value from persisted state", async () => {
    const sequencer = new Sequencer(2);
    sequencer.setCurrent(7);

    await expect(sequencer.next()).resolves.toBe(8);
  });
});
