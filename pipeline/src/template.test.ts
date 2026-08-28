import { describe, expect, it } from "vitest";
import { checkTemplate, fill } from "./template.js";

describe("fill", () => {
  it("substitutes named placeholders", () => {
    expect(fill("node {node} at {station}", { node: "091", station: "red" }, "x")).toBe(
      "node 091 at red",
    );
  });

  it("treats doubled braces as literal braces, so a prompt may contain JSON", () => {
    expect(fill('write {{"a": 1}} to {path}', { path: "/tmp/x" }, "x")).toBe(
      'write {"a": 1} to /tmp/x',
    );
  });

  it("substitutes numbers", () => {
    expect(fill("attempt {attempt}", { attempt: 2 }, "x")).toBe("attempt 2");
  });

  it("refuses an unknown placeholder rather than leaving a hole", () => {
    expect(() => fill("write {token}", { node: "091" }, "prompt of pass 'red'")).toThrow(
      /prompt of pass 'red' uses the placeholder \{token\}/,
    );
  });

  it("names what was available, so the fix is in the error", () => {
    expect(() => fill("{token}", { node: "1", root: "/r" }, "x")).toThrow(/\{node\} \{root\}/);
  });
});

describe("checkTemplate", () => {
  it("accepts a template whose placeholders are all supplied", () => {
    expect(() => checkTemplate("{node} {root}", ["node", "root", "attempt"], "x")).not.toThrow();
  });

  it("rejects at load time what fill would reject at run time", () => {
    expect(() => checkTemplate("{node} {token}", ["node"], "pass 'red'")).toThrow(/\{token\}/);
  });

  it("ignores escaped braces", () => {
    expect(() => checkTemplate("{{token}}", ["node"], "x")).not.toThrow();
  });
});
