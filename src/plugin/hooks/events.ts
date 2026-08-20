import type { MemoryStore } from "../../storage/sqlite";
import type { MemConfig } from "../../infrastructure/config/config";
import { memLog, setSessionId, appendSessionLog } from "../../logging";
import { distillRules, runConsolidation, applyScoreDecay, extractSessionLessons, captureSessionWork } from "../../application";
import { drainPendingExtractions, ollamaExtract, warmupExtractionModel } from "../../application/command-compression";
import { getSessionCache, recordSessionCache } from "../../application/command-compression/hook-support";
import { cleanupMiddleTermCaptures } from "../state";
import { ensureBackgroundGraph } from "../../application/graph/build";
import type { HookHandler } from "./types";

export function createEventHandler(
  store: MemoryStore,
  config: MemConfig,
  client: unknown,
  managementServer: { start: () => void; stop: () => void },
): HookHandler {
  let activeSessionCount = 0;
  const sl = () => config?.sessionLog?.enabled;

  return {
    "event": async (_input: unknown) => {
      const input = _input as { event: { type: string; properties: Record<string, unknown> } };
      const { type, properties } = input.event;

      if (type === "session.created") {
        const sessionId = (properties.info as { id?: string } | undefined)?.id ?? "unknown";
        await store.createSessionMetrics(sessionId);
        setSessionId(sessionId);
        activeSessionCount++;
        managementServer.start();
        if (sl()) {
          const project = (properties.info as { projectName?: string } | undefined)?.projectName ?? "";
          appendSessionLog(`[${new Date().toISOString()}] SESSION CREATED | id=${sessionId} | project=${project}`);
        }
      } else if (type === "session.idle") {
        const sessionId = (properties.sessionID as string | undefined) ?? "unknown";
        await store.updateSessionMetrics(sessionId, { endedAt: Date.now(), status: "completed" });

        const tasks: string[] = [];
        if (config?.autoLessons?.enabled) {
          extractSessionLessons(store, config.autoLessons, sessionId, client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } } | undefined).then(msg =>
            memLog("info", "auto-lessons", msg)
          ).catch(err => memLog("error", "auto-lessons", "Failed", { error: String(err) }));
          tasks.push("lessons");
        }
        if (config?.autoCapture?.enabled) {
          captureSessionWork(store, config.autoCapture, sessionId, client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } } | undefined).then(msg =>
            memLog("info", "auto-capture", msg)
          ).catch(err => memLog("error", "auto-capture", "Failed", { error: String(err) }));
          tasks.push("capture");
        }
        if (config?.autoDistill?.enabled) {
          distillRules(store, config.autoDistill, sessionId, client as { session?: { prompt: (opts: unknown) => Promise<{ text: () => Promise<string> }> } } | undefined).then(msg =>
            memLog("info", "auto-distill", msg)
          ).catch(err => memLog("error", "auto-distill", "Failed", { error: String(err) }));
          tasks.push("distill");
        }
        if (config?.autoConsolidate?.enabled) {
          runConsolidation(store, config.autoConsolidate, sessionId).then(msg =>
            memLog("info", "consolidation", msg)
          ).catch(err => memLog("error", "consolidation", "Failed", { error: String(err) }));
          tasks.push("consolidation");
        }
        if (config?.predictiveRating?.enabled) {
          applyScoreDecay(store, config.predictiveRating).then(msg =>
            memLog("info", "predictive-rating", msg)
          ).catch(err => memLog("error", "predictive-rating", "Decay failed", { error: String(err) }));
          tasks.push("decay");
        }

        if (config?.graph?.enabled) {
          const root = process.cwd();
          const maxFiles = config.graph.maxFiles ?? 5000;
          ensureBackgroundGraph(root, maxFiles);
          tasks.push("graph-rebuild");
        }

        // Deferred Ollama extraction drain: outputs queued by the compress
        // hook (non-blocking) get extracted here with a long timeout. Results
        // populate the session cache so repeat outputs compress instantly.
        if (config?.commandCompression?.ollamaExtraction?.enabled) {
          const extConfig = config.commandCompression.ollamaExtraction;
          if (extConfig.deferToIdle !== false) {
            void warmupExtractionModel(extConfig);
            const idleTimeoutMs = 120000;
            const batch = drainPendingExtractions();
            if (batch.length > 0) {
              memLog("info", "compress", "idle drain started", { sessionId, queued: batch.length });
              void (async () => {
                let extractedCount = 0;
                for (const item of batch) {
                  try {
                    const extracted = await ollamaExtract(item.output, item.command, {
                      ...extConfig,
                      timeoutMs: idleTimeoutMs,
                    });
                    if (extracted) {
                      const cache = getSessionCache(item.sessionId);
                      recordSessionCache(cache, item.output, extracted, "ollama-extract");
                      extractedCount++;
                    }
                  } catch {
                    // Best-effort per item — continue draining the rest.
                  }
                }
                memLog("info", "compress", "idle drain complete", { sessionId, queued: batch.length, extracted: extractedCount });
              })().catch(err => memLog("error", "compress", "Idle drain failed", { sessionId, error: String(err) }));
              tasks.push(`extract-drain(${batch.length})`);
            }
          }
        }

        if (sl()) {
          const duration = (properties.activeDurationMs as number) ?? 0;
          const durStr = duration >= 60000 ? `${(duration / 60000).toFixed(0)}m` : `${(duration / 1000).toFixed(0)}s`;
          appendSessionLog(`[${new Date().toISOString()}] SESSION IDLE | id=${sessionId} | duration=${durStr} | tasks=${tasks.join(",") || "none"}`);
        }
      } else if (type === "session.deleted") {
        activeSessionCount = Math.max(0, activeSessionCount - 1);
        if (sl()) {
          const sessionId = (properties.sessionID as string) ?? "unknown";
          appendSessionLog(`[${new Date().toISOString()}] SESSION DELETED | id=${sessionId} | active=${activeSessionCount}`);
        }
        if (activeSessionCount === 0) {
          managementServer.stop();
        }
      } else if (type === "session.compacted") {
        const sessionId = (properties.sessionID as string) ?? "unknown";
        const tasks: string[] = [];

        try {
          const cleaned = await cleanupMiddleTermCaptures(store);
          if (cleaned > 0) tasks.push(`cleanup(${cleaned})`);
        } catch (err) {
          memLog("warn", "compaction", "Cleanup failed", { sessionId, error: String(err) });
        }

        if (config?.predictiveRating?.enabled) {
          applyScoreDecay(store, config.predictiveRating).then(msg => {
            memLog("info", "predictive-rating", msg);
          }).catch(err => memLog("error", "predictive-rating", "Decay failed", { error: String(err) }));
          tasks.push("decay");
        }

        if (config?.autoConsolidate?.enabled) {
          runConsolidation(store, config.autoConsolidate, sessionId).then(msg =>
            memLog("info", "consolidation", msg)
          ).catch(err => memLog("error", "consolidation", "Failed", { error: String(err) }));
          tasks.push("consolidation");
        }

        if (sl()) {
          appendSessionLog(`[${new Date().toISOString()}] COMPACTED | id=${sessionId} | tasks=${tasks.join(",") || "none"}`);
        }
        memLog("info", "compaction", "Post-compaction tasks completed", { sessionId, tasks: tasks.join(",") || "none" });
      }
    },
  };
}
