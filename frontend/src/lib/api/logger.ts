export function logApi(method: string, path: string, status: number, durationMs: number): void {
  // centralized logger — no console spam in prod, hook for future
  if (import.meta.env.DEV) console.debug(`[api] ${method} ${path} → ${status} ${durationMs}ms`);
}
