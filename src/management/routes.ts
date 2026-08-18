import { Router } from "./router";
import type { MemoryStore } from "../domain/ports/MemoryStore";
import { registerSystemRoutes } from "./routes/system";
import { registerNodeRoutes } from "./routes/nodes";
import { registerTelemetryRoutes } from "./routes/telemetry";
import { registerBackupRoutes } from "./routes/backup";
import { registerGraphRoutes } from "./routes/graph";
import { registerLiveRoutes } from "./routes/live";

export function registerRoutes(router: Router, store: MemoryStore): void {
  registerSystemRoutes(router, store);
  registerNodeRoutes(router, store);
  registerTelemetryRoutes(router, store);
  registerBackupRoutes(router);
  registerGraphRoutes(router);
  registerLiveRoutes(router, store);
}
