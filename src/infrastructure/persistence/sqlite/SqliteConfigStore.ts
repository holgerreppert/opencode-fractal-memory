import { DbProvider } from "../../db/DbProvider";
import type { MemoryScope } from "../../../domain/ports/MemoryStore";
import type { ConfigStore } from "../../../domain/ports/ConfigStore";
import { getConfig, setConfig } from "../../../storage/migrations";
import { withRetry } from "../../../storage/utils";

export class SqliteConfigStore implements ConfigStore {
  constructor(private provider: DbProvider) {}

  async getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string> {
    const db = await this.provider.getDb(scope);
    return getConfig(db, key, defaultValue);
  }

  async setConfig(scope: MemoryScope, key: string, value: string): Promise<void> {
    const db = await this.provider.getDb(scope);
    await withRetry(() => setConfig(db, key, value));
  }
}
