import { Router } from "../router";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { getDreamRsiDashboard } from "../../application/dream-rsi";
import { jsonResponse } from "./common";

export function registerDreamRsiRoutes(router: Router, store: MemoryStore): void {
  router.get(/^\/api\/dream-rsi$/, () => handleDreamRsiDashboard(store));
}

async function handleDreamRsiDashboard(store: MemoryStore): Promise<Response> {
  try {
    const data = await getDreamRsiDashboard(store);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}
