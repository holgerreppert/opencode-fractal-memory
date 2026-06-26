import type { MemoryScope } from "./IMemoryStore";

export interface IConfigStore {
  getConfig(scope: MemoryScope, key: string, defaultValue: string): Promise<string>;
  setConfig(scope: MemoryScope, key: string, value: string): Promise<void>;
}
