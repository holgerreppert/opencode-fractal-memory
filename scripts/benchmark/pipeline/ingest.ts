import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { type MemoryStore } from "../../../src/storage/types";
import { createSqliteMemoryStore } from "../../../src/storage/sqlite";
import { type Conversation } from "../datasets/locomo";

export type TurnInfo = {
  session: string;
  index: number;
  content: string;
  nodeId: string;
};

export type SessionInfo = {
  key: string;
  dateTime: string;
  turnCount: number;
  summaryNodeId: string;
};

export type IngestedStore = {
  store: MemoryStore;
  tmpDir: string;
  turnIndex: Map<string, TurnInfo>;
  sessions: Map<string, SessionInfo>;
};

export async function ingestConversation(conv: Conversation, compress = false): Promise<IngestedStore> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "locomo-"));
  const dbPath = path.join(tmpDir, "memory.db");
  const store = createSqliteMemoryStore(tmpDir, dbPath);
  await store.ensureSeed();

  const turnIndex = new Map<string, TurnInfo>();
  const sessions = new Map<string, SessionInfo>();

  for (const [sessionKey, turns] of Object.entries(conv.conversation)) {
    if (!Array.isArray(turns)) continue;
    if (turns.length === 0) continue;
    if (typeof turns[0] !== "object" || turns[0] === null || !("dia_id" in turns[0])) continue;

    const dateTimeKey = `${sessionKey}_date_time`;
    const sessionDateTime = conv.conversation[dateTimeKey] as string | undefined;

    // Session summary node with date context
    const summaryContent = `Date: ${sessionDateTime ?? "unknown"}. Session ${sessionKey} conversation with ${turns.length} turns. ${conv.conversation.speaker_a} and ${conv.conversation.speaker_b} are talking.`;
    const summaryNode = await store.createNode({
      scope: "project",
      label: `${conv.sample_id}-${sessionKey}-summary`,
      content: summaryContent,
      type: "note",
      level: 0,
      embedding: null,
      metadata: { session: sessionKey, dateTime: sessionDateTime ?? "", turnCount: turns.length, isSessionSummary: true },
      importance: 0.5,
    });

    sessions.set(sessionKey, {
      key: sessionKey,
      dateTime: sessionDateTime ?? "",
      turnCount: turns.length,
      summaryNodeId: summaryNode.id,
    });

    const prevNodeIds: string[] = [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i] as { speaker: string; dia_id: string; text: string };
      const label = `${conv.sample_id}-${turn.dia_id}`;
      const content = `${turn.speaker}: ${turn.text}`;
      const node = await store.createNode({
        scope: "project",
        label,
        content,
        type: "note",
        level: 0,
        embedding: null,
        metadata: { speaker: turn.speaker, session: sessionKey, turnId: turn.dia_id, turnIndex: i, sessionDateTime: sessionDateTime ?? "" },
        importance: 0.5,
      });
      turnIndex.set(label, { session: sessionKey, index: i, content, nodeId: node.id });

      // Create temporal NEXT edge to previous turn
      if (prevNodeIds.length > 0) {
        const prevId = prevNodeIds[prevNodeIds.length - 1];
        await store.createTemporalEdge(prevId, node.id, "NEXT", "project", 1.0, { session: sessionKey });
      }
      prevNodeIds.push(node.id);

      // Link turn to its session summary
      await store.createTemporalEdge(node.id, summaryNode.id, "DURING_SESSION", "project", 1.0, { session: sessionKey });
    }
  }

  if (compress) {
    await store.runCompression("project", false, undefined, "project", undefined);
  }

  return { store, tmpDir, turnIndex, sessions };
}

export async function cleanupIngested(ingested: IngestedStore): Promise<void> {
  try {
    await ingested.store.close();
  } catch { /* ignore */ }
  try {
    fs.rmSync(ingested.tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}
