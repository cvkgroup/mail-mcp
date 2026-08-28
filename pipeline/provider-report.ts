/**
 * Who served each attempt of a run, and how fast they started.
 *
 * Run after a flow finishes. It reads only what the sessions already recorded, so it can be run
 * again later, and it never touches the worker path — a failure here costs attribution, not work.
 *
 *   npm run pipeline:providers -- red
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchServed, readResponses, summarise, toTsv, type Served } from "./src/provider.js";

const flow = process.argv[2];
if (!flow) {
  console.error("usage: npm run pipeline:providers -- <flow>");
  process.exit(2);
}

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set, so no upstream can be named.");
  process.exit(2);
}

const root = process.cwd();
const runDir = join(root, "runs", flow);
const responses = readResponses(join(runDir, "sessions"));

if (responses.length === 0) {
  console.error(`no assistant responses under ${join(runDir, "sessions")}`);
  process.exit(1);
}

console.log(`asking OpenRouter about ${responses.length} response(s) from flow '${flow}'`);

const served: Served[] = [];
for (const r of responses) {
  served.push(await fetchServed(r, key));
}

mkdirSync(runDir, { recursive: true });
const detail = join(runDir, "providers.tsv");
writeFileSync(detail, toTsv(served));

const summary = summarise(served);
writeFileSync(join(runDir, "providers-summary.tsv"), summary);

const unknown = served.filter((r) => r.provider === null).length;
console.log(`\n${summary}`);
console.log(`wrote ${detail}`);
if (unknown > 0) console.log(`${unknown} response(s) could not be attributed`);
