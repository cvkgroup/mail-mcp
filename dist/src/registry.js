import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export class SeatRegistry {
    seats = new Map();
    filePath;
    constructor(baseDir) {
        this.filePath = path.join(baseDir, "seats.json");
    }
    async load() {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            const raw = await readFile(this.filePath, "utf8");
            const loaded = JSON.parse(raw);
            this.seats.clear();
            for (const seat of loaded) {
                this.seats.set(seat.id, seat);
            }
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }
    async register(seat) {
        this.seats.set(seat.id, { ...seat });
        await this.persist();
        return this.getRequired(seat.id);
    }
    get(id) {
        const seat = this.seats.get(id);
        return seat ? { ...seat } : undefined;
    }
    getRequired(id) {
        const seat = this.get(id);
        if (!seat) {
            throw new Error(`Unregistered caller or seat: ${id}`);
        }
        return seat;
    }
    has(id) {
        return this.seats.has(id);
    }
    list() {
        return [...this.seats.values()].map((seat) => ({ ...seat }));
    }
    async persist() {
        await writeFile(this.filePath, `${JSON.stringify(this.list(), null, 2)}\n`, "utf8");
    }
}
