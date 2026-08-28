import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGraph, subgraph } from "./graph.js";

function write(name: string, text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "graph-")), name);
  writeFileSync(file, text);
  return file;
}

describe("loadGraph", () => {
  it("reads a bare mapping", () => {
    const g = loadGraph(write("g.json", '{"a": [], "b": ["a"]}'));
    expect([...g.keys()].sort()).toEqual(["a", "b"]);
    expect(g.get("b")).toEqual(["a"]);
  });

  it("finds the graph inside a larger file", () => {
    const g = loadGraph(write("g.json", '{"wave": {"a": 1}, "dep": {"a": [], "b": ["a"]}}'));
    expect(g.get("b")).toEqual(["a"]);
    expect(g.has("wave")).toBe(false);
  });

  it("ignores comment keys", () => {
    const g = loadGraph(write("g.json", '{"_why": "notes", "a": []}'));
    expect([...g.keys()]).toEqual(["a"]);
  });

  it("reads a text edge list with comments", () => {
    const g = loadGraph(write("g.txt", "a:\nb: a   # b needs a\nc: a b\n"));
    expect(g.get("c")).toEqual(["a", "b"]);
    expect(g.get("a")).toEqual([]);
  });

  it("refuses a dependency the graph never defines", () => {
    expect(() => loadGraph(write("g.json", '{"a": ["ghost"]}'))).toThrow(
      /a depends on ghost, which the graph never defines/,
    );
  });

  it("refuses a cycle and names the nodes in it", () => {
    expect(() => loadGraph(write("g.json", '{"a": ["b"], "b": ["a"], "c": []}'))).toThrow(
      /cycle among: a b/,
    );
  });

  it("refuses a file with no dependency lists at all", () => {
    expect(() => loadGraph(write("g.json", '{"wave": {"a": 1}}'))).toThrow(/no node has a list/);
  });
});

describe("subgraph", () => {
  it("keeps the selected nodes and drops edges that leave the selection", () => {
    const g = loadGraph(write("g.json", '{"a": [], "b": ["a"], "c": ["b"]}'));
    const s = subgraph(g, new Set(["b", "c"]));
    expect([...s.keys()].sort()).toEqual(["b", "c"]);
    expect(s.get("b")).toEqual([]);
    expect(s.get("c")).toEqual(["b"]);
  });

  it("refuses a node that is not in the graph", () => {
    const g = loadGraph(write("g.json", '{"a": []}'));
    expect(() => subgraph(g, new Set(["a", "z"]))).toThrow(/unknown nodes: z/);
  });
});
