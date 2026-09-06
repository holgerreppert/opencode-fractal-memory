// Step 4 — Nodes store with runes (port of Alpine NodeFilterEngine)
import { api } from '$lib/api/accessapi';
import { Logger } from '$lib/api/logger';

export type Node = { id: string; label: string; content: string; type?: string; level?: number; importance?: number; domain?: string; confidence?: number };

class NodesStore {
  query = $state('');
  nodes = $state<Node[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  scope = $state<'global' | 'project' | 'all' | string>('all');
  availableScopes = $state<{ scope: string; projectName: string | null }[]>([]);
  currentProject = $state<string | null>(null);

  // bullet counts for all types amounts like original #legend-popover / filter chips
  typeCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const n of this.nodes) m[n.type ?? 'unknown'] = (m[n.type ?? 'unknown'] ?? 0) + 1;
    return m;
  });
  levelCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const n of this.nodes) m[String(n.level ?? '?')] = (m[String(n.level ?? '?')] ?? 0) + 1;
    return m;
  });
  filtered = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.nodes;
    return this.nodes.filter((n) => (n.label + n.content).toLowerCase().includes(q));
  });

  async loadScopes() {
    try {
      const res: any = await fetch('http://127.0.0.1:8787/api/scopes').then((r) => r.json());
      this.availableScopes = (res?.scopes ?? res ?? []) as { scope: string; projectName: string | null }[];
      Logger.debug('[scopes] loaded', this.availableScopes);
    } catch (e) { Logger.warn('[scopes] failed', e); }
  }
  async load(opts: { scope?: string; projectName?: string | null } = {}) {
    const effScope = opts.scope ?? this.scope;
    const proj = opts.projectName !== undefined ? opts.projectName : this.currentProject;
    this.loading = true;
    this.error = null;
    const t0 = performance.now();
    try {
      const params: Record<string, string> = { scope: effScope, limit: '200' };
      if (effScope === 'project' && proj) params.project_name = proj;
      const res: any = await api.listNodes(params);
      const arr = Array.isArray(res) ? res : (res.nodes ?? res.results ?? []);
      this.nodes = arr as Node[];
      Logger.debug('[nodes] load', effScope, proj ?? '', this.nodes.length, (performance.now() - t0).toFixed(0) + 'ms');
      Logger.inspect('nodes sample', this.nodes.slice(0, 2));
    } catch (e) {
      this.error = String(e);
      Logger.warn('[nodes] load failed', e);
    } finally {
      this.loading = false;
    }
  }

  async search(q: string, opts: { scope?: string } = {}) {
    this.query = q;
    if (!q.trim()) return this.load(opts);
    this.loading = true;
    const t0 = performance.now();
    try {
      const sc = opts.scope ?? this.scope;
      const res: any = await api.search(q, sc);
      const arr = Array.isArray(res) ? res : (res.results ?? res.nodes ?? []);
      this.nodes = arr as Node[];
      Logger.debug('[nodes] search', q, sc, this.nodes.length, (performance.now() - t0).toFixed(0) + 'ms');
      Logger.inspect('search results', this.nodes.slice(0, 2));
    } catch (e) {
      this.error = String(e);
      Logger.warn('[nodes] search failed', e);
    } finally {
      this.loading = false;
    }
  }
  setScope(raw: string, projectName: string | null = null) {
    if (raw.startsWith('project:')) {
      this.scope = 'project' as any;
      this.currentProject = raw.slice(8);
    } else {
      this.scope = raw as any;
      this.currentProject = projectName;
    }
    this.load({ scope: this.scope, projectName: this.currentProject });
  }
}

export const nodesStore = new NodesStore();
