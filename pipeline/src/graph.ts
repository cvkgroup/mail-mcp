/**
 * The dependency graph. The engine knows nothing else about the work it is running.
 *
 * A node cannot start until every node it depends on has finished. That is the only rule the
 * graph expresses, and it is why the same engine can drive requirements, files, services or
 * anything else that has an order.
 */

import { readFileSync } from "node:fs";

/** node -> the nodes it depends on. */
export type Graph = ReadonlyMap<string, readonly string[]>;

/**
 * Accepts three shapes, so a graph can come from another project without conversion:
 *
 *   {"a": ["b"], "b": []}                    a bare mapping
 *   {"dep": {"a": ["b"]}, "wave": {...}}     a mapping wrapped in a larger file
 *   a: b c                                   a text edge list, `#` starts a comment
 */
export function loadGraph(file: string): Graph {
  const text = readFileSync(file, "utf8");
  const dep = file.toLowerCase().endsWith(".json") || text.trimStart().startsWith("{")
    ? fromJson(text, file)
    : fromEdgeList(text);

  for (const [node, deps] of dep) {
    for (const d of deps) {
      if (!dep.has(d)) {
        throw new Error(
          `${file}: ${node} depends on ${d}, which the graph never defines. ` +
            `A dependency that does not exist can never finish, so ${node} could never start.`,
        );
      }
    }
  }
  assertAcyclic(dep, file);
  return dep;
}

function fromJson(text: string, file: string): Map<string, string[]> {
  let raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error(`${file}: expected a JSON object`);
  for (const key of ["dep", "deps", "graph"]) {
    if (isRecord(raw[key])) {
      raw = raw[key];
      break;
    }
  }
  const dep = new Map<string, string[]>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("_")) continue; // `_why`, `_what` and friends are comments
    if (!Array.isArray(value)) continue;
    dep.set(String(key), value.map(String));
  }
  if (dep.size === 0) throw new Error(`${file}: no node has a list of dependencies`);
  return dep;
}

function fromEdgeList(text: string): Map<string, string[]> {
  const dep = new Map<string, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]!.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const node = (colon === -1 ? line : line.slice(0, colon)).trim();
    const rest = colon === -1 ? "" : line.slice(colon + 1);
    dep.set(node, rest.split(/[,\s]+/).filter(Boolean));
  }
  return dep;
}

/** Kahn's algorithm, kept for the error message: it names exactly the nodes in the knot. */
function assertAcyclic(dep: Map<string, string[]>, file: string): void {
  const settled = new Set<string>();
  while (settled.size < dep.size) {
    const ready = [...dep.keys()].filter(
      (n) => !settled.has(n) && dep.get(n)!.every((d) => settled.has(d)),
    );
    if (ready.length === 0) {
      const stuck = [...dep.keys()].filter((n) => !settled.has(n)).sort();
      throw new Error(`${file}: the graph has a cycle among: ${stuck.join(" ")}`);
    }
    for (const n of ready) settled.add(n);
  }
}

/** Restrict the graph to the named nodes, dropping edges that leave the selection. */
export function subgraph(dep: Graph, want: ReadonlySet<string>): Graph {
  const unknown = [...want].filter((n) => !dep.has(n)).sort();
  if (unknown.length > 0) throw new Error(`unknown nodes: ${unknown.join(" ")}`);
  const out = new Map<string, readonly string[]>();
  for (const [node, deps] of dep) {
    if (want.has(node)) out.set(node, deps.filter((d) => want.has(d)));
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
