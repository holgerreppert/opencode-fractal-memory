import type { MemoryScope } from "./MemoryStore";

export interface ConfigStore {
  getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string>;
  setConfig(scope: MemoryScope, key: string, value: string): Promise<void>;
}
