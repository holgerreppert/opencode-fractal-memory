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
  // chip filters — client-side, like NodeFilterEngine levels/types
  activeTypes = $state<Set<string>>(new Set());
  activeLevels = $state<Set<number>>(new Set());

  filtered = $derived.by(() => {
    let arr = this.nodes;
    if (this.activeTypes.size) arr = arr.filter((n) => this.activeTypes.has(n.type ?? 'unknown'));
    if (this.activeLevels.size) arr = arr.filter((n) => this.activeLevels.has(n.level ?? -1));
    return arr;
  });

  toggleType(t: string) {
    if (this.activeTypes.has(t)) this.activeTypes.delete(t); else this.activeTypes.add(t);
    // Force svelte reactivity for Set mutations
    this.activeTypes = new Set(this.activeTypes);
    Logger.debug('[filter] types', [...this.activeTypes]);
  }
  toggleLevel(l: number) {
    if (this.activeLevels.has(l)) this.activeLevels.delete(l); else this.activeLevels.add(l);
    this.activeLevels = new Set(this.activeLevels);
    Logger.debug('[filter] levels', [...this.activeLevels]);
  }
  clearFilters() {
    this.activeTypes = new Set();
    this.activeLevels = new Set();
  }

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

  searchMode = $state<'hybrid' | 'bm25' | 'text'>('hybrid');

  async search(q: string, opts: { scope?: string; mode?: 'hybrid' | 'bm25' | 'text' } = {}) {
    this.query = q;
    if (opts.mode) this.searchMode = opts.mode;
    this.activeTypes = new Set();
    this.activeLevels = new Set();
    if (!q.trim()) return this.load(opts);
    this.loading = true;
    const t0 = performance.now();
    try {
      const sc = opts.scope ?? this.scope;
      const m = opts.mode ?? this.searchMode;
      const res: any = await api.search(q, sc, m);
      const arr = Array.isArray(res) ? res : (res.results ?? res.nodes ?? []);
      this.nodes = arr as Node[];
      Logger.debug('[nodes] search', q, sc, m, this.nodes.length, (performance.now() - t0).toFixed(0) + 'ms');
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
    this.activeTypes = new Set();
    this.activeLevels = new Set();
    this.load({ scope: this.scope, projectName: this.currentProject });
  }
}

export const nodesStore = new NodesStore();
