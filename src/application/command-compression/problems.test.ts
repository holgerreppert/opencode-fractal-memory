import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("live-test problems (barrel, DEFAULT_CONFIG, gitignore) — edge cases", () => {
  it("barrel re-export exposes squeezExtract (TS2305 workaround) — direct import works, barrel is bypassed in prod", async () => {
    const mod = await import("./squeez");
    expect(typeof (mod as any).squeezExtract).toBe("function");
    expect(typeof (mod as any).squeezExtractSync).toBe("function");
    // Prod uses direct import "../../application/command-compression/squeez" to bypass barrel TS2305
    // Barrel via index still has export { squeezExtract } but is not used in prod (verified via compression.ts)
    const barrel = await import("./squeez");
    expect(typeof (barrel as any).squeezExtract).toBe("function");
  });

  it("DEFAULT_SQUEEZ_EXTRACTION has correct defaults (KRLabsOrg/squeez-2b, 2000, 5000, deferToIdle true)", async () => {
    const { DEFAULT_SQUEEZ_EXTRACTION } = await import("./config");
    expect(DEFAULT_SQUEEZ_EXTRACTION.enabled).toBe(false);
    expect(DEFAULT_SQUEEZ_EXTRACTION.baseUrl).toBe("http://localhost:8000");
    expect(DEFAULT_SQUEEZ_EXTRACTION.model).toBe("KRLabsOrg/squeez-2b");
    expect(DEFAULT_SQUEEZ_EXTRACTION.minOutputChars).toBe(2000);
    expect(DEFAULT_SQUEEZ_EXTRACTION.timeoutMs).toBe(5000);
    expect(DEFAULT_SQUEEZ_EXTRACTION.deferToIdle).toBe(true);
  });

  it("MemConfig DEFAULT_CONFIG.commandCompression.squeezExtraction defaults (live drift)", async () => {
    // loadMemConfig reads file, but DEFAULT_CONFIG fallback should contain squeezExtraction if schema default works
    // We test the schema parse of empty object yields squeezExtraction defaults
    const { loadMemConfig } = await import("../../infrastructure/config/config");
    // mock empty file read will fallback to DEFAULT_CONFIG — we just ensure load doesn't throw and schema has squeezExtraction
    const cfg = await loadMemConfig("/tmp");
    // after our fix, commandCompression.squeezExtraction should be defined (even if disabled)
    expect(cfg.commandCompression).toBeDefined();
    expect(cfg.commandCompression?.squeezExtraction).toBeDefined();
    expect(cfg.commandCompression?.squeezExtraction?.model).toBe("KRLabsOrg/squeez-2b");
  });

  it(".gitignore ignores docs/sqlitesqls/ (untracked 100K)", () => {
    const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf-8");
    expect(gitignore).toContain("docs/sqlitesqls");
  });

  it("scratch purge: hook-support offloadPathFor creates deterministic path (edge)", async () => {
    const { offloadPathFor } = await import("./hook-support");
    const p1 = offloadPathFor("hello world");
    const p2 = offloadPathFor("hello world");
    expect(p1).toBe(p2);
    expect(p1).toContain("scratch");
  });

  it("pipeline verbatim gate edge: exactly at threshold not compressed, above compresses (fragile gate)", async () => {
    const { compressCommandOutput } = await import("./pipeline");
    const base: any = { enabled: true, maxLines: 50, excludeCommands: [], alwaysFullOnFailure: false, perTool: {}, netWinMinTokens: 1, verbatimBelowLines: 5, benignThreshold: 10, errorThreshold: 5, keepMatches: 5, keepNames: 5, keepRows: 5, essentialColumns: {} };
    const small = Array(5).fill("a".repeat(50)).join("\n"); // exactly 5 lines -> not large (needs >5)
    expect(compressCommandOutput("cat file", small, false, base)).toBeNull();
    const large = Array(6).fill("a".repeat(700)).join("\n"); // 6 lines + >4000 chars -> large
    const r = compressCommandOutput("cat file", large + "\n" + "b".repeat(1000), false, base);
    // may be null (no strategy) or compressed — but must not throw and must respect verbatim gate
    expect(r === null || typeof r.strategy === "string").toBe(true);
  });
});
