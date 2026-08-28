#!/usr/bin/env node
// seat-check.mjs — prove the built agent-mail server starts and completes a real MCP
// handshake when launched with a given environment, and that all 11 tools are present.
// Used by scripts/seat-session.sh as the "don't trust the registration" startup proof,
// and reuseable for deliberately-broken configs (e.g. a bad AGENT_MAIL_BASE_DIR).
//
// Usage: node seat-check.mjs <serverPath> <mailboxDir> <bootstrapJson> <stubbedPath>

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [server, baseDir, bootstrap, stubPath] = process.argv.slice(2);
if (!server || !baseDir || !bootstrap || !stubPath) {
  console.error("usage: seat-check.mjs <serverPath> <mailboxDir> <bootstrapJson> <stubbedPath>");
  process.exit(2);
}

const EXPECTED = [
  "mail_register_seat",
  "mail_send",
  "mail_inbox",
  "mail_read",
  "mail_ack",
  "mail_status",
  "mail_audit",
  "mail_reply",
  "mail_thread",
  "mail_seats",
  "mail_supersede",
];

const env = {
  ...process.env,
  AGENT_MAIL_BASE_DIR: baseDir,
  AGENT_MAIL_BOOTSTRAP: bootstrap,
  PATH: stubPath,
};

const client = new Client({ name: "seat-check", version: "1.0.0" });
try {
  const transport = new StdioClientTransport({
    command: "node",
    args: [server],
    env,
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  const names = tools.map((t) => t.name);
  const missing = EXPECTED.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    console.error(`check server-starts-clean: FAIL — missing tools: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`check server-starts-clean: OK — MCP handshake complete, ${names.length} tools (all 11 expected present)`);
  process.exit(0);
} catch (error) {
  console.error(`check server-starts-clean: FAIL — ${String(error?.message ?? error)}`);
  // Spawn the server exactly as configured once more to capture its stderr verbatim.
  const child = spawn("node", [server], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let settled = false;
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    console.error("--- server stderr (verbatim) ---");
    console.error(String(err.message));
    console.error("---------------------------------");
    process.exit(1);
  });
  child.on("close", () => {
    if (settled) return;
    settled = true;
    console.error("--- server stderr (verbatim) ---");
    console.error(stderr.replace(/\n+$/g, ""));
    console.error("---------------------------------");
    process.exit(1);
  });
  setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error("--- server stderr (verbatim) ---");
    console.error(stderr.replace(/\n+$/g, ""));
    console.error("[seat-check] server did not die within 3s; killed it.");
    console.error("---------------------------------");
    child.kill();
    process.exit(1);
  }, 3000);
}
