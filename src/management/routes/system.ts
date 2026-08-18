import { memLog } from "../../logging";
import { getRuntimeInfo } from "../../infrastructure/llm/onnx-runtime";
import { Router } from "../router";
import {
  readProjectConfig, writeProjectConfig, getAvailableScopes,
} from "../helpers";
import type { MemoryStore } from "../../domain/ports/MemoryStore";
import { VERSION } from "../../version";
import { jsonResponse } from "./common";

export function registerSystemRoutes(router: Router, store: MemoryStore | null): void {
  router.get(/^\/api\/scopes$/, () => handleScopes(store));
  router.get(/^\/api\/config$/, () => handleConfigGet());
  router.put(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.post(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.get(/^\/api\/version$/, () => handleVersion());
  router.get(/^\/api\/embeddings-status$/, () => handleEmbeddingsStatus());
  router.get(/^\/api\/shutdown$/, () => handleShutdown());
}

// Scope entries: the two built-in scopes (global + project-all) plus one entry
// per distinct project_name found in the project DB — drives the visualize
// sidebar's scope dropdown (global | each project).
async function handleScopes(store: MemoryStore | null): Promise<Response> {
  const base = getAvailableScopes();
  if (!store || typeof store.listProjects !== "function") return jsonResponse(base);
  try {
    const projects = await store.listProjects("project");
    const extra = projects.map((p) => ({
      scope: "project" as const,
      path: base.find((s) => s.scope === "project")?.path ?? "",
      projectName: p,
    }));
    return jsonResponse([...base, ...extra]);
  } catch (e) {
    memLog("error", "management", "[api] listProjects failed:", { error: e instanceof Error ? e.message : String(e) });
    return jsonResponse(base);
  }
}

function handleConfigGet(): Response {
  return jsonResponse(readProjectConfig());
}

async function handleConfigSave(req: Request): Promise<Response> {
  const body = await req.text();
  memLog("debug", "api", "[api] Received body:", { body });
  const newConfig = JSON.parse(body) as Record<string, unknown>;
  const error = writeProjectConfig(newConfig);
  return jsonResponse({ success: error === "ok", error: error === "ok" ? null : error });
}

function handleVersion(): Response {
  return jsonResponse({ version: VERSION });
}

function handleEmbeddingsStatus(): Response {
  return jsonResponse({
    ...getRuntimeInfo(),
  });
}

function handleShutdown(): Response {
  setTimeout(() => process.exit(0), 100);
  return jsonResponse({ ok: true, message: "shutting down" });
}
