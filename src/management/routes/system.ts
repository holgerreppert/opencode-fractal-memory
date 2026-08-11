import { memLog } from "../../logging";
import { getRuntimeInfo } from "../../infrastructure/llm/onnx-runtime";
import { Router } from "../router";
import {
  readProjectConfig, writeProjectConfig, getAvailableScopes,
} from "../helpers";
import { VERSION } from "../../version";
import { jsonResponse } from "./common";

export function registerSystemRoutes(router: Router): void {
  router.get(/^\/api\/scopes$/, () => handleScopes());
  router.get(/^\/api\/config$/, () => handleConfigGet());
  router.put(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.post(/^\/api\/config$/, (req) => handleConfigSave(req));
  router.get(/^\/api\/version$/, () => handleVersion());
  router.get(/^\/api\/embeddings-status$/, () => handleEmbeddingsStatus());
  router.get(/^\/api\/shutdown$/, () => handleShutdown());
}

function handleScopes(): Response {
  return jsonResponse(getAvailableScopes());
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
