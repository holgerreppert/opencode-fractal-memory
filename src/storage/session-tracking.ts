import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { withRetry } from "./utils";

export async function insertAgentToolCall(
  db: Database,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> | null,
  output: string | null,
  success: boolean | null,
  durationMs: number | null,
  toolCategory: string
): Promise<void> {
  const timestamp = Date.now();
  const id = randomUUID();

  let filePath: string | null = null;
  let command: string | null = null;

  if (args) {
    if (args.filePath && typeof args.filePath === "string") {
      filePath = args.filePath;
    } else if (args.path && typeof args.path === "string") {
      filePath = args.path;
    }
    if (args.command && typeof args.command === "string") {
      command = args.command.substring(0, 500);
    }
  }

  const outputPreview = output ? output.substring(0, 500) : null;

  await withRetry(() => {
    db.run(
      `INSERT INTO agent_tool_calls 
       (id, session_id, timestamp, tool_name, args_json, output_preview, success, duration_ms, tool_category, file_path, command)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        timestamp,
        toolName,
        args ? JSON.stringify(args) : null,
        outputPreview,
        success !== null ? (success ? 1 : 0) : null,
        durationMs ?? null,
        toolCategory,
        filePath,
        command,
      ]
    );
  });
}

export async function createSessionMetrics(db: Database, sessionId: string, startedAt?: number): Promise<void> {
  const timestamp = startedAt ?? Date.now();
  await withRetry(() => {
    db.run(
      `INSERT OR REPLACE INTO session_metrics (session_id, started_at, status) VALUES (?, ?, 'active')`,
      [sessionId, timestamp]
    );
  });
}

export async function updateSessionMetrics(
  db: Database,
  sessionId: string,
  updates: Partial<{
    endedAt: number;
    totalToolCalls: number;
    fileReads: number;
    fileEdits: number;
    bashCommands: number;
    memoryTools: number;
    failedTools: number;
    uniqueFilesTouched: string[];
    injectionCount: number;
    injectedTokens: number;
    taskDescription: string;
    status: string;
  }>
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.endedAt !== undefined) {
    setClauses.push("ended_at = ?");
    values.push(updates.endedAt);
  }
  if (updates.totalToolCalls !== undefined) {
    setClauses.push("total_tool_calls = ?");
    values.push(updates.totalToolCalls);
  }
  if (updates.fileReads !== undefined) {
    setClauses.push("file_reads = ?");
    values.push(updates.fileReads);
  }
  if (updates.fileEdits !== undefined) {
    setClauses.push("file_edits = ?");
    values.push(updates.fileEdits);
  }
  if (updates.bashCommands !== undefined) {
    setClauses.push("bash_commands = ?");
    values.push(updates.bashCommands);
  }
  if (updates.memoryTools !== undefined) {
    setClauses.push("memory_tools = ?");
    values.push(updates.memoryTools);
  }
  if (updates.failedTools !== undefined) {
    setClauses.push("failed_tools = ?");
    values.push(updates.failedTools);
  }
  if (updates.uniqueFilesTouched !== undefined) {
    setClauses.push("unique_files_touched = ?");
    values.push(JSON.stringify(updates.uniqueFilesTouched));
  }
  if (updates.injectionCount !== undefined) {
    setClauses.push("injection_count = ?");
    values.push(updates.injectionCount);
  }
  if (updates.injectedTokens !== undefined) {
    setClauses.push("injected_tokens = ?");
    values.push(updates.injectedTokens);
  }
  if (updates.taskDescription !== undefined) {
    setClauses.push("task_description = ?");
    values.push(updates.taskDescription);
  }
  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    values.push(updates.status);
  }

  if (setClauses.length === 0) return;

  values.push(sessionId);
  await withRetry(() => {
    db.run(`UPDATE session_metrics SET ${setClauses.join(", ")} WHERE session_id = ?`, values as (string | number | null)[]);
  });
}

export async function incrementSessionToolCall(
  db: Database,
  sessionId: string,
  toolName: string,
  success: boolean,
  filePath?: string | null,
  toolCategory?: string
): Promise<void> {
  const session = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get(sessionId) as {
    total_tool_calls: number;
    file_reads: number;
    file_edits: number;
    bash_commands: number;
    memory_tools: number;
    failed_tools: number;
    unique_files_touched: string;
  } | null;

  if (!session) {
    await createSessionMetrics(db, sessionId);
    await incrementSessionToolCall(db, sessionId, toolName, success, filePath, toolCategory);
    return;
  }

  const category = toolCategory ?? getToolCategory(toolName);
  const updates: Partial<{
    totalToolCalls: number;
    fileReads: number;
    fileEdits: number;
    bashCommands: number;
    memoryTools: number;
    failedTools: number;
    uniqueFilesTouched: string[];
  }> = {
    totalToolCalls: session.total_tool_calls + 1,
  };

  if (category === "file") {
    if (toolName === "read") updates.fileReads = session.file_reads + 1;
    else if (toolName === "edit") updates.fileEdits = session.file_edits + 1;
  } else if (category === "shell") {
    updates.bashCommands = session.bash_commands + 1;
  } else if (category === "memory") {
    updates.memoryTools = session.memory_tools + 1;
  }

  if (!success) {
    updates.failedTools = session.failed_tools + 1;
  }

  if (filePath) {
    const currentFiles: string[] = session.unique_files_touched
      ? JSON.parse(session.unique_files_touched)
      : [];
    if (!currentFiles.includes(filePath)) {
      updates.uniqueFilesTouched = [...currentFiles, filePath];
    }
  }

  await updateSessionMetrics(db, sessionId, updates);
}

function getToolCategory(toolName: string): string {
  if (toolName.startsWith("memory_") || toolName.startsWith("journal_")) return "memory";
  if (["read", "edit", "write", "glob", "grep", "search"].includes(toolName)) return "file";
  if (["bash", "shell"].includes(toolName)) return "shell";
  return "other";
}

export function getSessionStats(
  db: Database,
  sessionId: string
): {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
  totalToolCalls: number;
  fileReads: number;
  fileEdits: number;
  bashCommands: number;
  memoryTools: number;
  failedTools: number;
  uniqueFilesTouched: string[];
  injectionCount: number;
  injectedTokens: number;
  toolCalls: Array<{
    toolName: string;
    timestamp: number;
    toolCategory: string;
    filePath: string | null;
    command: string | null;
    success: boolean | null;
  }>;
} | null {
  const session = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get(sessionId) as {
    session_id: string;
    started_at: number;
    ended_at: number | null;
    status: string;
    total_tool_calls: number;
    file_reads: number;
    file_edits: number;
    bash_commands: number;
    memory_tools: number;
    failed_tools: number;
    unique_files_touched: string | null;
    injection_count: number;
    injected_tokens: number;
  } | null;

  if (!session) return null;

  const toolCalls = db.query(
    `SELECT tool_name, timestamp, tool_category, file_path, command, success 
     FROM agent_tool_calls 
     WHERE session_id = ? 
     ORDER BY timestamp ASC`
  ).all(sessionId) as Array<{
    tool_name: string;
    timestamp: number;
    tool_category: string;
    file_path: string | null;
    command: string | null;
    success: number | null;
  }>;

  return {
    sessionId: session.session_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    status: session.status,
    totalToolCalls: session.total_tool_calls,
    fileReads: session.file_reads,
    fileEdits: session.file_edits,
    bashCommands: session.bash_commands,
    memoryTools: session.memory_tools,
    failedTools: session.failed_tools,
    uniqueFilesTouched: session.unique_files_touched
      ? JSON.parse(session.unique_files_touched)
      : [],
    injectionCount: session.injection_count,
    injectedTokens: session.injected_tokens,
    toolCalls: toolCalls.map((tc) => ({
      toolName: tc.tool_name,
      timestamp: tc.timestamp,
      toolCategory: tc.tool_category,
      filePath: tc.file_path,
      command: tc.command,
      success: tc.success !== null ? tc.success === 1 : null,
    })),
  };
}
