/**
 * The plugin's hook contract.
 *
 * Every handler receives ONE mutable event. The registration layer maps the
 * runtime's events onto these, so no handler juggles an input/output pair and
 * no handler needs to know which runtime it runs under.
 */

/** A message part as the plugin's message handlers see it. */
export interface MessagePart {
  type?: string | undefined;
  text?: string | undefined;
  tokens?: unknown;
  [key: string]: unknown;
}

/** A message as the plugin's message handlers see it. */
export interface MessageView {
  id?: string | undefined;
  role?: string | undefined;
  type?: string | undefined;
  tokens?: unknown;
  synthetic?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  parts: MessagePart[];
}

/** Tool execution, before the tool runs. Mutating `args` changes the call. */
export interface ToolBeforeEvent {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, unknown>;
}

/**
 * Tool execution, after the tool ran. Mutating `output`, `title` or
 * `metadata` changes what the model receives.
 */
export interface ToolAfterEvent {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, unknown>;
  output: string;
  title?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** System prompt assembly. */
export interface SystemEvent {
  sessionID: string;
  system: string[];
}

/** Model request messages. */
export interface MessagesEvent {
  sessionID: string;
  messages: MessageView[];
  /** The model the request is going to use. */
  model?: { providerID: string; id: string } | undefined;
}

/** Generation options for the outgoing model request. */
export interface OptionsEvent {
  sessionID: string;
  temperature?: number | undefined;
  topP?: number | undefined;
  topK?: number | undefined;
  maxOutputTokens?: number | undefined;
}

/** User prompt admission. */
export interface PromptEvent {
  sessionID: string;
  message: unknown;
  parts: unknown[];
}

/** Session compaction. */
export interface CompactionEvent {
  sessionID: string;
  context: string[];
  prompt?: string | undefined;
}

/** Server event stream. */
export interface PluginEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface PluginHooks {
  "tool.execute.before"?: (event: ToolBeforeEvent) => Promise<void>;
  "tool.execute.after"?: (event: ToolAfterEvent) => Promise<void>;
  "system"?: (event: SystemEvent) => Promise<void>;
  "messages"?: (event: MessagesEvent) => Promise<void>;
  "options"?: (event: OptionsEvent) => Promise<void>;
  "message"?: (event: PromptEvent) => Promise<void>;
  "compaction"?: (event: CompactionEvent) => Promise<void>;
  "event"?: (event: PluginEvent) => Promise<void>;
}
