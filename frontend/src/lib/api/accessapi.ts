import { logApi } from './logger';

const BASE = '';

type FetchOpts = RequestInit & { timeoutMs?: number };

export async function fetchJson<T>(path: string, opts: FetchOpts = {}): Promise<T> {
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
	config: () => fetchJson<Record<string, any>>(`/api/config`),
	configSave: (data: Record<string, any>) => fetchJson<{ success: boolean }>(`/api/config`, { method: 'PUT', body: JSON.stringify(data) }),
	dreamRsi: () => fetchJson<{
		activeStrategy: { strategyId: string; score: number; scoreHistory: number[]; queriesReplayed: number; sessionsReplayed: number; updatedAt: number } | null;
		history: { switches: Array<{ timestamp: number; from: string; to: string; scoreBefore?: number; scoreAfter: number }>; trends: Array<{ timestamp: number; strategyId: string; score: number; queriesReplayed: number; sessionsReplayed: number }>; adaptations: Array<{ timestamp: number; field: string; oldValue: number; newValue: number; reason: string }> };
		injectionStats: Array<{ strategy: string; count: number; avgEffectiveness: number; avgUpvotes: number; avgDownvotes: number }>;
	}>(`/api/dream-rsi`),
} as const;
