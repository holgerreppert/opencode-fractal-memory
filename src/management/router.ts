import { memLog } from "../logging";
import { jsonResponse } from "./helpers";

export type RouteHandler = (req: Request, ctx: RouteContext) => Response | Promise<Response>;

export interface RouteContext {
  params: Record<string, string>;
  scope: string;
  url: URL;
  pathname: string;
}

export class Router {
  private routes: Array<{
    method: string | null;
    pattern: RegExp;
    handler: RouteHandler;
  }> = [];

  get(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: "GET", pattern, handler });
  }

  post(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: "POST", pattern, handler });
  }

  put(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: "PUT", pattern, handler });
  }

  delete(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: "DELETE", pattern, handler });
  }

  patch(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: "PATCH", pattern, handler });
  }

  any(pattern: RegExp, handler: RouteHandler) {
    this.routes.push({ method: null, pattern, handler });
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== null && route.method !== req.method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const ctx: RouteContext = {
        params: match.groups ?? {},
        scope: url.searchParams.get("scope") || "project",
        url,
        pathname,
      };

      try {
        return await route.handler(req, ctx);
      } catch (err) {
        memLog("error", "management", `[api] ${req.method} ${pathname}:`, { error: err instanceof Error ? err.message : err });
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    return null;
  }
}
