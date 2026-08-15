import { spawn, type ChildProcess } from "node:child_process";

import type { MessageClass } from "./types.js";

export interface WakeTransportResult {
  success: boolean;
  error?: string;
}

export interface WakeTransport {
  pushWake(targetSeatId: string, messageClass: MessageClass, wakeText: string): Promise<WakeTransportResult>;
}

type SpawnLike = typeof spawn;

export class PrimeAgentTransport implements WakeTransport {
  constructor(private readonly spawnImpl: SpawnLike = spawn) {}

  async pushWake(_targetSeatId: string, messageClass: MessageClass, wakeText: string): Promise<WakeTransportResult> {
    const flag = messageClass === "interrupt" ? "--steer" : "--follow-up";

    return new Promise<WakeTransportResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnImpl("prime-agent", ["send", flag], {
          stdio: ["pipe", "ignore", "pipe"],
        });
      } catch (error) {
        resolve({ success: false, error: (error as Error).message });
        return;
      }

      let settled = false;
      let stderr = "";

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          resolve({ success: false, error: error.message });
        }
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        resolve({ success: false, error: `prime-agent exited with code ${code}${suffix}` });
      });

      child.stdin?.end(`${wakeText}\n`);
    });
  }
}
