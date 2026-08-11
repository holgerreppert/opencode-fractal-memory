import { Router } from "../router";
import {
  getBackupSources, createBackup, listBackups, deleteBackup, restoreBackup,
} from "../helpers";
import { jsonResponse } from "./common";

export function registerBackupRoutes(router: Router): void {
  router.get(/^\/api\/backup-sources$/, () => handleBackupSources());
  router.get(/^\/api\/backups$/, () => handleListBackups());
  router.post(/^\/api\/backup$/, (req) => handleCreateBackup(req));
  router.post(/^\/api\/restore$/, (req) => handleRestoreBackup(req));
  router.delete(/^\/api\/backups\/(?<name>[^/]+)$/, (_, ctx) => handleDeleteBackup(ctx));
}

function handleBackupSources(): Response {
  return jsonResponse(getBackupSources());
}

async function handleCreateBackup(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { sources?: string[]; label?: string };
    if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
      return jsonResponse({ success: false, error: "No sources provided" }, 400);
    }
    const result = await createBackup(body.sources, body.label);
    if (result.error) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({ success: true, backup: result });
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleListBackups(): Promise<Response> {
  try {
    const backups = await listBackups();
    return jsonResponse({ backups });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleRestoreBackup(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { backup?: string; sources?: string[] };
    if (!body.backup) return jsonResponse({ success: false, error: "Missing backup name" }, 400);
    if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
      return jsonResponse({ success: false, error: "No sources to restore" }, 400);
    }
    const result = await restoreBackup(body.backup, body.sources);
    if (!result.success) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({ success: true, preRestoreBackup: result.preRestoreBackup });
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleDeleteBackup(ctx: { params: Record<string, string> }): Promise<Response> {
  const name = ctx.params.name;
  if (!name) return jsonResponse({ success: false, error: "Missing backup name" }, 400);
  const result = await deleteBackup(name);
  if (!result.success) return jsonResponse({ success: false, error: result.error }, 404);
  return jsonResponse({ success: true });
}
