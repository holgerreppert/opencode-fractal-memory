import type { MemoryStore } from "./sqlite";
import { memLog } from "../logging";

const SESSION_LAST_NODE = new Map<string, string>();

export function clearSessionEdges(sessionId: string): void {
  SESSION_LAST_NODE.delete(sessionId);
}

export async function onNodeCreated(
  store: MemoryStore,
  scope: string,
  newNodeId: string,
  label: string | undefined,
  content: string,
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) return;

  const tasks: Promise<unknown>[] = [];

  const prevId = SESSION_LAST_NODE.get(sessionId);
  if (prevId && prevId !== newNodeId) {
    tasks.push(
      store.createTemporalEdge(prevId, newNodeId, "NEXT", scope, 1.0, { sessionId })
        .catch(e => memLog("warn", "auto-edges", "Failed to create NEXT edge", { error: e.message, prevId, newNodeId })),
    );
  }
  SESSION_LAST_NODE.set(sessionId, newNodeId);

  if (content) {
    const refs = extractLabelRefs(content);
    if (refs.length > 0) {
      const resolved = await resolveLabels(store, refs);
      for (const targetId of resolved) {
        if (targetId === newNodeId) continue;
        tasks.push(
          store.createTemporalEdge(newNodeId, targetId, "REFERENCES", scope, 0.8, { sessionId })
            .catch(e => memLog("warn", "auto-edges", "Failed to create REFERENCES edge", { error: e.message, newNodeId, targetId })),
        );
      }
    }
  }

  await Promise.all(tasks);
}

const LABEL_REF_RE = /\b(bug|decision|concept|session|pref|file|playbook|lesson|summary|rule|skill|fact|event|note|episode|core|storedcontext):[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}\b/g;

function extractLabelRefs(content: string): string[] {
  const seen = new Set<string>();
  const matches = content.matchAll(LABEL_REF_RE);
  for (const m of matches) {
    seen.add(m[0]);
  }
  return [...seen];
}

async function resolveLabels(
  store: MemoryStore,
  labels: string[],
): Promise<string[]> {
  const resolved: string[] = [];
  for (const label of labels) {
    for (const scope of ["global", "project"] as const) {
      try {
        const node = await store.getNodeByLabel(scope, label);
        resolved.push(node.id);
        break;
      } catch {
      }
    }
  }
  return resolved;
}
