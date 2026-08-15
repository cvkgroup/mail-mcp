import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Seat } from "./types.js";

export class SeatRegistry {
  private readonly seats = new Map<string, Seat>();
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "seats.json");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const loaded = JSON.parse(raw) as Seat[];
      this.seats.clear();
      for (const seat of loaded) {
        this.seats.set(seat.id, seat);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async register(seat: Seat): Promise<Seat> {
    this.seats.set(seat.id, { ...seat });
    await this.persist();
    return this.getRequired(seat.id);
  }

  get(id: string): Seat | undefined {
    const seat = this.seats.get(id);
    return seat ? { ...seat } : undefined;
  }

  getRequired(id: string): Seat {
    const seat = this.get(id);
    if (!seat) {
      throw new Error(`Unregistered caller or seat: ${id}`);
    }

    return seat;
  }

  has(id: string): boolean {
    return this.seats.has(id);
  }

  list(): Seat[] {
    return [...this.seats.values()].map((seat) => ({ ...seat }));
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(this.list(), null, 2)}\n`, "utf8");
  }
}
