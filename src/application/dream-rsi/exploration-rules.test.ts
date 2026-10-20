import { describe, expect, test } from "bun:test";
import {
  classifyRootCause,
  detectClustering,
  isDuplicateSignature,
  classifyExtraction,
} from "./exploration-rules";

describe("classifyRootCause", () => {
  test("returns unknown when no failures", () => {
    expect(classifyRootCause(new Map(), 0)).toBe("unknown");
  });

  test("returns bad-idea when single tool fails multiple times", () => {
    const tools = new Map([["edit", 3]]);
    expect(classifyRootCause(tools, 3)).toBe("bad-idea");
  });

  test("returns implementation-bug when multiple tools each fail once", () => {
    const tools = new Map([["edit", 1], ["grep", 1]]);
    expect(classifyRootCause(tools, 2)).toBe("implementation-bug");
  });

  test("returns unknown when mixed pattern", () => {
    const tools = new Map([["edit", 3], ["grep", 1]]);
    expect(classifyRootCause(tools, 4)).toBe("unknown");
  });

  test("single tool with 1 failure is unknown (not bad-idea)", () => {
    const tools = new Map([["edit", 1]]);
    expect(classifyRootCause(tools, 1)).toBe("unknown");
  });
});

describe("detectClustering", () => {
  test("returns false when fewer signatures than threshold", () => {
    expect(detectClustering(["a", "b"], 3)).toBe(false);
  });

  test("returns true when same signature appears threshold times", () => {
    expect(detectClustering(["a", "a", "a"], 3)).toBe(true);
  });

  test("returns false when signatures are all different", () => {
    expect(detectClustering(["a", "b", "c"], 3)).toBe(false);
  });

  test("uses default threshold of 3", () => {
    expect(detectClustering(["x", "x", "x"])).toBe(true);
  });
});

describe("isDuplicateSignature", () => {
  test("returns true when signature exists", () => {
    expect(isDuplicateSignature(["edit,grep", "read"], "edit,grep")).toBe(true);
  });

  test("returns false when signature is new", () => {
    expect(isDuplicateSignature(["edit,grep"], "read,write")).toBe(false);
  });

  test("returns false for empty list", () => {
    expect(isDuplicateSignature([], "anything")).toBe(false);
  });
});

describe("classifyExtraction", () => {
  test("returns full classification", () => {
    const tools = new Map([["edit", 3]]);
    const result = classifyExtraction(tools, 3, ["a", "a", "a"], "edit");
    expect(result.rootCause).toBe("bad-idea");
    expect(result.isClustered).toBe(true);
    expect(result.isDuplicate).toBe(false);
  });

  test("detects duplicate signature", () => {
    const tools = new Map([["edit", 1]]);
    const result = classifyExtraction(tools, 1, ["edit"], "edit");
    expect(result.isDuplicate).toBe(true);
  });
});
