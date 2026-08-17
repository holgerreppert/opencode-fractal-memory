import type { MemoryStore } from "../../storage/sqlite";
import { memLog } from "../../logging";

// Shared per-session state for compress — the glue between the
// tool (records blocks) and chat.messages.transform (prunes messages).
// Module-level map (pattern: TURN_COUNTERS in plugin/hooks.ts, injectedPerSession
// in messages-transform.ts). NOT persisted to files — the DB is the durable
// state: registry + history nodes survive restarts, and the map is rebuilt
// from them when empty (see rebuildCompressState).

export type CompressBlockEntry = {
  blockId: string;
  nodeId: string;
  label: string;
  summary: string;
  topic: string;
};

export type SessionCompressState = {
  // msgId -> archived block (msgId is the raw message id from info.id)
  blocks: Map<string, CompressBlockEntry>;
  // msgRef counter (m0001, m0002, ...) — stable per session
  refCounter: number;
  // True when the map was rebuilt from the DB (vs. built live this process)
  rebuilt: boolean;
};

const compressStateBySession = new Map<string, SessionCompressState>();

const MAX_SESSIONS = 64;

export function getCompressState(sessionId: string): SessionCompressState {
  let state = compressStateBySession.get(sessionId);
  if (!state) {
    state = { blocks: new Map(), refCounter: 1, rebuilt: false };
    compressStateBySession.set(sessionId, state);
    if (compressStateBySession.size > MAX_SESSIONS) {
      compressStateBySession.delete(compressStateBySession.keys().next().value as string);
    }
  }
  return state;
}

export function recordCompressBlock(
  sessionId: string,
  msgId: string,
  entry: Omit<CompressBlockEntry, "label"> & { label: string },
): void {
  const state = getCompressState(sessionId);
  state.blocks.set(msgId, { ...entry, label: entry.label });
  state.refCounter++;
}

export function nextMsgRef(sessionId: string): string {
  const state = getCompressState(sessionId);
  const ref = `m${String(state.refCounter).padStart(4, "0")}`;
  state.refCounter++;
  return ref;
}

export function clearCompressState(sessionId: string): void {
  const state = getCompressState(sessionId);
  state.blocks.clear();
  state.rebuilt = false;
  memLog("debug", "context-compress", "Cleared per-session compress state", { sessionId });
}

export function forgetCompressSession(sessionId: string): void {
  compressStateBySession.delete(sessionId);
}

// Rebuild the block map from the registry node (DB = durable state). Call when
// the map is empty but archives may exist (session start / process restart).
export async function rebuildCompressState(store: MemoryStore, sessionId: string): Promise<SessionCompressState> {
  const state = getCompressState(sessionId);
  if (state.blocks.size > 0) return state;
  try {
    const registry = await store.getNodeByLabel("project", `contexthistory:index:${sessionId}`);
    if (!registry?.content) return state;
    const parsed = JSON.parse(registry.content) as {
      entries?: Array<{ ref: string; msgId: string; status: string; summary: string; label: string; topic?: string }>;
    };
    for (const entry of parsed.entries ?? []) {
      if (entry.status !== "archived" || !entry.msgId) continue;
      state.blocks.set(entry.msgId, {
        blockId: entry.ref,
        nodeId: entry.label,
        label: entry.label,
        summary: entry.summary ?? "",
        topic: entry.topic ?? "",
      });
      // refCounter is max ref seen + 1 so new refs never collide
      const num = parseInt(entry.ref?.replace(/^m/, "") ?? "0", 10);
      if (!Number.isNaN(num) && num >= state.refCounter) state.refCounter = num + 1;
    }
    state.rebuilt = state.blocks.size > 0;
    if (state.rebuilt) {
      memLog("info", "context-compress", "Rebuilt compress state from registry", { sessionId, entries: state.blocks.size });
    }
  } catch (err) {
    memLog("debug", "context-compress", "Registry rebuild skipped (no registry node)", { sessionId, error: String(err) });
  }
  return state;
}

export function isMsgCompressed(sessionId: string, msgId: string): boolean {
  return getCompressState(sessionId).blocks.has(msgId);
}

// Mark registry entries whose msgId is no longer in the model view as
// "compacted" (dead). Called after OpenCode compaction: filterCompacted drops
// every pre-tail message from the view, so archived entries pointing at them
// can never be pruned again — keeping them only wastes rebuilds and bloats the
// nudge. History nodes are NOT deleted (they stay retrievable by label — the
// "nothing is lost" guarantee); only the registry status changes so
// rebuildCompressState skips them. Returns the number of entries marked.
export async function markDeadCompressEntries(
  store: MemoryStore,
  sessionId: string,
  liveMsgIds: Set<string>,
): Promise<number> {
  const registryLabel = `contexthistory:index:${sessionId}`;
  let registry: { id: string; content?: string | null } | null = null;
  try {
    registry = await store.getNodeByLabel("project", registryLabel);
  } catch {
    return 0;
  }
  if (!registry?.content) return 0;

  let entries: Array<{ msgId?: string; status?: string; [key: string]: unknown }> = [];
  try {
    const parsed = JSON.parse(registry.content) as { entries?: Array<{ msgId?: string; status?: string; [key: string]: unknown }> };
    entries = parsed.entries ?? [];
  } catch {
    return 0;
  }

  const dead = entries.filter((e) => e.msgId && e.status === "archived" && !liveMsgIds.has(e.msgId));
  if (dead.length === 0) return 0;

  const updated = entries.map((e) =>
    e.msgId && e.status === "archived" && !liveMsgIds.has(e.msgId)
      ? { ...e, status: "compacted" }
      : e,
  );
  await store.updateNode(registry.id, { content: JSON.stringify({ entries: updated }) });

  const state = getCompressState(sessionId);
  for (const e of dead) {
    if (e.msgId) state.blocks.delete(e.msgId);
  }

  memLog("info", "context-compress", "Marked dead registry entries after compaction", {
    sessionId,
    marked: dead.length,
    live: liveMsgIds.size,
  });
  return dead.length;
}