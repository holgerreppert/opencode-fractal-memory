import * as fs from "node:fs";
import type { MemConfig } from "../../config";
import { writeFileSumLog } from "../../logging";
import { extractSkeleton } from "../../hooks/skeletonize";
import type { HookHandler } from "./types";

export function createSkeletonizationHandler(config: MemConfig): HookHandler {
  return {
    "tool.after": async (_input: unknown, output: unknown) => {
      const input = _input as { tool?: string; args?: { filePath?: string; offset?: number } };
      const out = output as { output?: string; metadata?: Record<string, unknown> };
      const skelConfig = config.fileSkeletonization;
      if (!skelConfig?.enabled || input.tool !== "read") return;

      const filePath = input.args?.filePath;
      if (!filePath) return;

      if (input.args?.offset) {
        writeFileSumLog("SKELETONIZE", { action: "skipped-offset-read", file: filePath });
        return;
      }

      try {
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat) {
          writeFileSumLog("SKELETONIZE", { action: "skipped-no-stat", file: filePath });
          return;
        }
        const minLines = skelConfig.minLines ?? 200;
        if (stat.size <= minLines * 40) {
          writeFileSumLog("SKELETONIZE", { action: "skipped-too-small", file: filePath, bytes: stat.size, min_bytes: minLines * 40 });
          return;
        }
        const raw = (out.output ?? "") as string;
        const lines = raw.split("\n").length;
        if (lines < minLines) {
          writeFileSumLog("SKELETONIZE", { action: "skipped-too-few-lines", file: filePath, lines, min_lines: minLines });
          return;
        }
        const t0 = performance.now();
        const skeleton = extractSkeleton(filePath, raw);
        const durationMs = Math.round(performance.now() - t0);
        if (!skeleton) {
          writeFileSumLog("SKELETONIZE", { action: "skipped-no-skeleton", file: filePath, lines, took_ms: durationMs });
          return;
        }
        if (skeleton.length >= raw.length * 0.5) {
          const reductionPct = Math.round((1 - skeleton.length / raw.length) * 100);
          writeFileSumLog("SKELETONIZE", { action: "skipped-insufficient-reduction", file: filePath, lines, skeleton_lines: skeleton.split("\n").length, reduction_pct: reductionPct, took_ms: durationMs });
          return;
        }
        const strategy = skeleton.startsWith("# Skeleton (regex)") ? "regex" : "ast+regex";
        const skeletonLines = skeleton.split("\n").length;
        const reductionPct = Math.round((1 - skeleton.length / raw.length) * 100);
        const banner = `[Skeletonized via ${strategy} — ${lines}→${skeletonLines} lines. Full content via offset read.]\n`;
        out.output = banner + skeleton;
        out.metadata = {
          ...((out.metadata as Record<string, unknown>) ?? {}),
          skeletonized: true,
        };
        writeFileSumLog("SKELETONIZE", { action: "applied", file: filePath, lines, skeleton_lines: skeletonLines, reduction_pct: reductionPct, strategy, took_ms: durationMs });
      } catch (err) {
        writeFileSumLog("SKELETONIZE", { action: "error", file: filePath, error: String(err).slice(0, 120) });
      }
    },
  };
}
