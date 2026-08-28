/**
 * Which upstream actually served each attempt.
 *
 * `provider` in a session file says `openrouter`, which is the aggregator, not the machine that
 * ran the model. OpenRouter picks an upstream per request, so two attempts against the same model
 * on the same day can be served by different companies at different speeds. Duration alone cannot
 * tell those apart from our own scheduling, and a run whose slow attempts cannot be attributed is
 * a run whose timings cannot be argued about.
 *
 * Every assistant message carries a `responseId`, and OpenRouter will name the upstream for it.
 * Reading is separated from fetching so the parsing can be tested without a network or a key.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One model response, as recorded in the session before anything is asked of OpenRouter. */
export interface Response {
  node: string;
  station: string;
  attempt: string;
  responseId: string;
  model: string;
  stopReason: string;
  /** Milliseconds since the epoch, as the session records it. */
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/** What OpenRouter adds once asked: who served it, and how long they took. */
export interface Served extends Response {
  /** The upstream company, e.g. `Baidu`. Null when OpenRouter has no record of the id. */
  provider: string | null;
  /** Milliseconds to the first token. This is the number that separates a stall from slow work. */
  latencyMs: number | null;
  /** Milliseconds from first token to last. */
  generationMs: number | null;
  /** More than one entry means OpenRouter fell back across upstreams inside a single request. */
  attemptsUpstream: number;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/**
 * Every assistant response in one run's sessions.
 *
 * The layout is `sessions/{station}/{node}-{attempt}/{session-id}.jsonl`, so the directory names
 * the work and nothing has to be matched up by timestamp afterwards.
 */
export function readResponses(sessionsDir: string): Response[] {
  if (!existsSync(sessionsDir)) return [];
  const out: Response[] = [];

  for (const station of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!station.isDirectory()) continue;
    const stationDir = join(sessionsDir, station.name);

    for (const run of readdirSync(stationDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const dash = run.name.lastIndexOf("-");
      const node = dash === -1 ? run.name : run.name.slice(0, dash);
      const attempt = dash === -1 ? "?" : run.name.slice(dash + 1);
      const runDir = join(stationDir, run.name);

      for (const file of readdirSync(runDir)) {
        if (!file.endsWith(".jsonl")) continue;
        for (const line of readFileSync(join(runDir, file), "utf8").split("\n")) {
          if (!line.trim()) continue;
          let entry: Record<string, unknown>;
          try {
            entry = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue; // A half-written last line is normal in a killed worker.
          }
          const m = entry.message as Record<string, unknown> | undefined;
          if (!m || m.role !== "assistant" || typeof m.responseId !== "string") continue;
          const usage = (m.usage ?? {}) as Record<string, unknown>;
          const cost = (usage.cost ?? {}) as Record<string, unknown>;
          out.push({
            node,
            station: station.name,
            attempt,
            responseId: m.responseId,
            model: typeof m.model === "string" ? m.model : "",
            stopReason: typeof m.stopReason === "string" ? m.stopReason : "",
            timestamp: num(m.timestamp),
            inputTokens: num(usage.input),
            outputTokens: num(usage.output),
            cost: num(cost.total),
          });
        }
      }
    }
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/**
 * Ask OpenRouter who served one response.
 *
 * Generation records are not always queryable the instant a request finishes, so this retries a
 * few times before reporting the upstream as unknown. An unknown upstream is recorded as null
 * rather than dropped: a response we could not attribute is a fact about the run, not a gap to
 * paper over.
 */
export async function fetchServed(r: Response, apiKey: string, tries = 3): Promise<Served> {
  const unknown: Served = {
    ...r, provider: null, latencyMs: null, generationMs: null, attemptsUpstream: 0,
  };

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(r.responseId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (res.ok) {
        const body = (await res.json()) as { data?: Record<string, unknown> };
        const d = body.data ?? {};
        const responses = Array.isArray(d.provider_responses) ? d.provider_responses : [];
        return {
          ...r,
          provider: typeof d.provider_name === "string" ? d.provider_name : null,
          latencyMs: typeof d.latency === "number" ? d.latency : null,
          generationMs: typeof d.generation_time === "number" ? d.generation_time : null,
          attemptsUpstream: responses.length,
        };
      }
      if (res.status !== 404) return unknown; // 404 means not indexed yet; anything else will not improve.
    } catch {
      // A network failure here loses attribution, not data. Retry, then give up.
    }
    if (i < tries - 1) await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
  }
  return unknown;
}

/** Tab-separated, so the result opens in anything and diffs cleanly between runs. */
export function toTsv(rows: Served[]): string {
  const head = [
    "node", "station", "attempt", "provider", "latency_ms", "generation_ms",
    "upstream_tries", "stop_reason", "in_tokens", "out_tokens", "cost", "model", "response_id",
  ].join("\t");
  const body = rows.map((r) => [
    r.node, r.station, r.attempt, r.provider ?? "unknown",
    r.latencyMs ?? "", r.generationMs ?? "", r.attemptsUpstream,
    r.stopReason, r.inputTokens, r.outputTokens, r.cost.toFixed(6), r.model, r.responseId,
  ].join("\t"));
  return [head, ...body].join("\n") + "\n";
}

/** One line per upstream: how much work it took, and how slowly it started. */
export function summarise(rows: Served[]): string {
  const by = new Map<string, Served[]>();
  for (const r of rows) {
    const k = r.provider ?? "unknown";
    (by.get(k) ?? by.set(k, []).get(k)!).push(r);
  }

  const lines = ["provider\tresponses\tmedian_latency_ms\tmax_latency_ms\tfallbacks\tcost"];
  for (const [provider, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    const lat = rs.map((r) => r.latencyMs).filter((n): n is number => n !== null).sort((a, b) => a - b);
    const median = lat.length ? lat[Math.floor(lat.length / 2)]! : "";
    const max = lat.length ? lat[lat.length - 1]! : "";
    const fallbacks = rs.filter((r) => r.attemptsUpstream > 1).length;
    const cost = rs.reduce((n, r) => n + r.cost, 0);
    lines.push(`${provider}\t${rs.length}\t${median}\t${max}\t${fallbacks}\t${cost.toFixed(4)}`);
  }
  return lines.join("\n") + "\n";
}
