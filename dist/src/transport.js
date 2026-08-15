import { spawn } from "node:child_process";
export class PrimeAgentTransport {
    spawnImpl;
    constructor(spawnImpl = spawn) {
        this.spawnImpl = spawnImpl;
    }
    async pushWake(_targetSeatId, messageClass, wakeText) {
        const flag = messageClass === "interrupt" ? "--steer" : "--follow-up";
        return new Promise((resolve) => {
            let child;
            try {
                child = this.spawnImpl("prime-agent", ["send", flag], {
                    stdio: ["pipe", "ignore", "pipe"],
                });
            }
            catch (error) {
                resolve({ success: false, error: error.message });
                return;
            }
            let settled = false;
            let stderr = "";
            child.stderr?.on("data", (chunk) => {
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
