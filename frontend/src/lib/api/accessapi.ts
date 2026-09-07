import { logApi } from './logger';

const BASE = 'http://127.0.0.1:8787';

type FetchOpts = RequestInit & { timeoutMs?: number };

async function fetchJson<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  logApi(opts.method ?? 'GET', path, res.status, Date.now() - t0);
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// Backend /api/* kept backward compatible — frontend routes are fresh (see memory plan 7123613f)
// Add wrappers as needed; keep centralized — no direct fetch in Svelte components per fact:svelte-stack
export const api = {
	health: () => fetchJson<{ ok: boolean }>(`/api/system/health`),
	listNodes: (params: Record<string, string> = { scope: 'all', limit: '200' }) => {
		const qs = new URLSearchParams(params).toString();
		return fetchJson<{ nodes: unknown[] }>(`/api/nodes${qs ? `?${qs}` : ''}`);
	},
	getNode: (id: string) => fetchJson<{ node: unknown }>(`/api/nodes/${encodeURIComponent(id)}`),
	search: (q: string, scope = 'project', mode: string = 'hybrid') =>
		fetchJson<unknown[]>(`/api/search?q=${encodeURIComponent(q)}&scope=${scope}&mode=${mode}`),
	graph: (query: string) => fetchJson<{ nodes: any[]; edges: any[] }>(`/api/graph/export`),
	telemetry: () => fetchJson<{ metrics: unknown }>(`/api/telemetry`),
	backup: () => fetchJson<{ backups: unknown[] }>(`/api/backup`),
	config: () => fetchJson<Record<string, any>>(`/api/config`),
	configSave: (data: Record<string, any>) => fetchJson<{ success: boolean }>(`/api/config`, { method: 'PUT', body: JSON.stringify(data) }),
} as const;
