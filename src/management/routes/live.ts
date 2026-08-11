import { writeLiveFeedLog } from "../../logging";
import { Router } from "../router";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { jsonResponse } from "./common";

export function registerLiveRoutes(router: Router, store: MemoryStore): void {
  router.get(/^\/api\/live$/, () => handleLiveFeed(store));
}

async function handleLiveFeed(store: MemoryStore): Promise<Response> {
  try {
    const snapshot = await store.getLiveFeedSnapshot(100);
    let tokenHistory;
    try {
      tokenHistory = await store.getTokenHistory(1, 10);
    } catch {
      tokenHistory = null;
    }
    const result = {
      ...snapshot,
      tokenHistory,
      timestamp: Date.now(),
    };
    try {
      writeLiveFeedLog(result as Record<string, unknown>);
    } catch {
      // best-effort
    }
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
