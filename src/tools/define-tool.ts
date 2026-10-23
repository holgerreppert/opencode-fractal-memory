/**
 * Tool definition helper.
 *
 * The helper is an identity function over `{description, args, execute}` with
 * `tool.schema` bound to zod. It lives here so the whole plugin uses one zod
 * version.
 *
 * `args` is a zod raw shape; the OpenCode runtime receives the equivalent
 * JSON Schema (see `toToolDefinition` in `src/plugin/registration.ts`).
 */

import { z } from "zod";

/** Zod raw shape accepted as tool arguments. */
export type ToolArgs = Record<string, z.ZodType>;

/**
 * Context passed to a tool executor.
 *
 * The runtime supplies `sessionID`, `agent`, `messageID`, `id`, `signal` and
 * `progress`. The plugin adds `directory` (the resolved project root) because
 * tools that persist per-project data need it and the runtime does not
 * provide it.
 */
export interface ToolContext {
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  readonly signal: AbortSignal;
  readonly progress: (update: Record<string, unknown>) => Promise<void>;
  /** Project directory of the location the tool runs in. */
  readonly directory?: string | undefined;
}

/** Tool result: a plain string, or a titled output with metadata. */
export type ToolResult =
  | string
  | {
      title?: string | undefined;
      output: string;
      metadata?: Record<string, unknown> | undefined;
    };

export interface ToolDefinition<A extends ToolArgs = ToolArgs> {
  description: string;
  args: A;
  execute(args: z.infer<z.ZodObject<A>>, context: ToolContext): Promise<ToolResult>;
}

function defineTool<A extends ToolArgs>(input: ToolDefinition<A>): ToolDefinition<A> {
  return input;
}

/**
 * Define a tool. `tool.schema` exposes the zod API used to build `args`.
 */
export const tool = Object.assign(defineTool, { schema: z });
