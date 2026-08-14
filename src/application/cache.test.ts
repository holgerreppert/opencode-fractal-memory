import { describe, expect, test, beforeEach } from "bun:test";
import { addToWorkingCache, getWorkingCache, clearWorkingCache } from "./cache";

describe("working memory cache content cap", () => {
  beforeEach(() => {
    clearWorkingCache("s1");
  });

  test("truncates oversized content to 8000 chars", () => {
    const big = "x".repeat(50_000);
    addToWorkingCache("s1", { id: "n1", label: "big", content: big, importance: 0.5 });
    const [entry] = getWorkingCache("s1");
    expect(entry!.content.length).toBe(8_000);
  });

  test("keeps small content intact", () => {
    addToWorkingCache("s1", { id: "n1", label: "small", content: "hello", importance: 0.5 });
    const [entry] = getWorkingCache("s1");
    expect(entry!.content).toBe("hello");
  });

  test("still enforces max 8 entries", () => {
    for (let i = 0; i < 20; i++) {
      addToWorkingCache("s1", { id: `n${i}`, label: `l${i}`, content: `c${i}`, importance: i / 20 });
    }
    expect(getWorkingCache("s1").length).toBe(8);
  });
});