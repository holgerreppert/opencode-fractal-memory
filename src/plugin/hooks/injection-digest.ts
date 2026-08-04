import type { MemConfig } from "../../infrastructure/config/config";
import { memLog } from "../../logging";
import type { MemoryStore } from "../../storage/sqlite";
import {
  buildInjectionDigest,
  drainInjectionLedger,
  getInjectionVisibilityConfig,
  type InjectionRecord,
} from "../../application/injection-visibility";
import type { HookHandler } from "./types";

function persistRecords(store: MemoryStore, sid: string, records: InjectionRecord[]): void {
  if (!sid || records.length === 0) return;
  const byFeature = new Map<string, InjectionRecord[]>();
  for (const r of records) {
    const list = byFeature.get(r.feature) ?? [];
    list.push(r);
    byFeature.set(r.feature, list);
  }
  for (const [feature, list] of byFeature) {
    // derive lightweight counts for the dashboard from ledger detail lengths
    const tokens = Math.max(1, Math.round(list.reduce((s, r) => s + r.detail.length, 0) / 4));
    try {
      void store.logInjectionMetrics(sid, {
        injectedNodeCount: list.length,
        injectedTokens: tokens,
        injectionMode: feature,
      });
    } catch (err) {
      memLog("debug", "injection-visibility", "Failed to persist injection metric", { feature, error: String(err) });
    }
  }
}

/**
 * Emits a single synthetic user message per chunk summarizing every injection
 * the plugin performed that chunk, and persisting each feature-group into
 * injection_metrics so the management app's live feed surfaces the (previously
 * silent) injections. Only LAST in the chat.messages.transform chain so it
 * drains the ledger after all content-injection handlers.
 */
export function createInjectionDigestHandler(
  store: MemoryStore,
  config: MemConfig,
  currentSessionId: { value: string },
): HookHandler {
  const vis = getInjectionVisibilityConfig(config);
  if (!vis.enabled || !vis.digest) return {};

  const sid = () => currentSessionId?.value ?? "";

  return {
    "chat.messages.transform": async (_input: unknown, output: unknown) => {
      const out = output as {
        messages: Array<{ info: { role?: string }; parts: Array<{ type?: string; text?: string }> }>;
      };
      if (!out.messages || out.messages.length === 0) return;

      const records = drainInjectionLedger();
      const digest = buildInjectionDigest(records);
      persistRecords(store, sid(), records);
      if (!digest) return;

      try {
        out.messages.splice(out.messages.length - 1, 0, {
          info: { role: "user" },
          parts: [{
            type: "text" as const,
            text: digest,
          }],
        });
        memLog("debug", "injection-visibility", `Digest injected (${records.length} records, ${new Set(records.map(r => r.feature)).size} features)`);
      } catch (err) {
        memLog("debug", "injection-visibility", "Digest injection failed", { error: String(err) });
      }
    },
  };
}
