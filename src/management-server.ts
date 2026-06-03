import * as os from "node:os";
import * as path from "node:path";

interface ManagementConfig {
  enabled: boolean;
  port: number;
}

export function startManagementServer(
  _store: unknown,
  _directory: string,
  _config: ManagementConfig,
): void {
  // No-op: management server is now a standalone CLI
  // Run: bun run ~/.config/opencode/node_modules/opencode-fractal-memory/dist/management-standalone.js
}
