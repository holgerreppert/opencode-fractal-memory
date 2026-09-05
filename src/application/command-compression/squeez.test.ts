import { describe, it, expect } from "bun:test";
import { squeezExtract } from "./squeez";

describe("squeezExtract", () => {
  it("returns null when disabled", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", { enabled: false, baseUrl: "http://localhost:8000", model: "KRLabsOrg/squeez-2b", minOutputChars: 2000, timeoutMs: 5000 });
    expect(r).toBeNull();
  });
  it("returns null when deferToIdle true (sync no-op)", async () => {
    const r = await squeezExtract("x".repeat(3000), "query", { enabled: true, baseUrl: "http://localhost:8000", model: "x", minOutputChars: 10, timeoutMs: 100, deferToIdle: true });
    expect(r).toBeNull();
  });
  it("returns null on short output", async () => {
    const r = await squeezExtract("short", "query", { enabled: true, baseUrl: "http://localhost:8000", model: "x", minOutputChars: 2000, timeoutMs: 100, deferToIdle: false });
    expect(r).toBeNull();
  });
});
