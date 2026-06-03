import { describe, expect, test } from "bun:test";
import { MemoryHelp } from "./help";

describe("MemoryHelp", () => {
  test("output contains header", async () => {
    const tool = MemoryHelp();
    const result = await (tool as any).execute({});
    expect(result).toContain("## Memory Plugin Commands");
  });

  test("lists all registered commands", async () => {
    const tool = MemoryHelp();
    const result = await (tool as any).execute({});
    expect(result).toContain("memory_dashboard");
    expect(result).toContain("memory_stats");
    expect(result).toContain("memory_search");
    expect(result).toContain("memory_help");
  });

  test("contains fractal levels section", async () => {
    const tool = MemoryHelp();
    const result = await (tool as any).execute({});
    expect(result).toContain("L0 (raw)");
    expect(result).toContain("L1 (weekly)");
    expect(result).toContain("L2 (monthly)");
    expect(result).toContain("L3 (quarterly)");
    expect(result).toContain("L4+ (yearly)");
  });
});
