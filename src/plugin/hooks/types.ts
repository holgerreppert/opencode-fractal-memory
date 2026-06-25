export interface HookHandler {
  "system.transform"?: (input: unknown, output: { system: string[] }) => Promise<void>;
  "tool.before"?: (input: unknown, output: unknown) => Promise<void>;
  "tool.after"?: (input: unknown, output: unknown) => Promise<void>;
  "compacting"?: (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => Promise<void>;
  "event"?: (input: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>;
  "chat.params"?: (input: unknown, output: unknown) => Promise<void>;
  "chat.messages.transform"?: (input: unknown, output: unknown) => Promise<void>;
  "compaction.autocontinue"?: (input: unknown, output: { enabled: boolean }) => Promise<void>;
}
