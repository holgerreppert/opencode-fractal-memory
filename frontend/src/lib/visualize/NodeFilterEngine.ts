import { Logger } from '$lib/api/logger';

export class NodeFilterEngine {
  levels = new Set<number>();
  types = new Set<string>();
  customTypes = new Set<string>();
  shapes = new Set<string>();
  projects = new Set<string>();
  searchQuery = '';
  searchMode: 'text' | 'ids' = 'text';
  serverSearchIds: Set<string> | null = null;
  hideAll = false;
  supertypeFilter: string | null = null;
  sourceFilter: string | null = null;
  domainFilter: string | null = null;
  private _allValues: { levels: number[]; types: string[]; customTypes: string[]; shapes: string[] } | null = null;
  onUpdate: (() => void) | null = null;

  initFromStats(stats: any) {
    this._allValues = {
      levels: Object.keys(stats.nodesPerLevel || {}).map(Number).sort((a, b) => a - b),
      types: Object.keys(stats.nodesPerType || {}).sort(),
      customTypes: Object.keys(stats.nodesPerCustomType || {}).sort(),
      shapes: Object.keys(stats.nodesPerShape || {}).sort()
    };
    this.levels.clear(); this.types.clear(); this.customTypes.clear(); this.shapes.clear(); this.projects.clear();
    this.supertypeFilter = this.sourceFilter = this.domainFilter = null;
    this._allValues.levels.forEach((l) => this.levels.add(l));
    this._allValues.types.forEach((t) => this.types.add(t));
    this._allValues.customTypes.forEach((t) => this.customTypes.add(t));
    this._allValues.shapes.forEach((s) => this.shapes.add(s));
    this.hideAll = false; this.searchQuery = ''; this.serverSearchIds = null; Logger.debug('[filter] init', this._allValues);
  }
  toggleLevel(v: number) { this.toggle(this.levels, v); }
  toggleType(v: string) { this.toggle(this.types, v); }
  toggleCustomType(v: string) { this.toggle(this.customTypes, v); }
  toggleShape(v: string) { this.toggle(this.shapes, v); }
  selectAll() { if (!this._allValues) return; this.levels = new Set(this._allValues.levels); this.types = new Set(this._allValues.types); this.customTypes = new Set(this._allValues.customTypes); this.shapes = new Set(this._allValues.shapes); this.projects.clear(); this.hideAll = false; this.changed(); }
  clearAll() { this.levels.clear(); this.types.clear(); this.customTypes.clear(); this.shapes.clear(); this.projects.clear(); this.hideAll = true; this.changed(); }
  toggleAll(cat: 'level' | 'type' | 'customType' | 'shape') {
    const all = (this._allValues as any)?.[cat === 'level' ? 'levels' : cat === 'type' ? 'types' : cat === 'customType' ? 'customTypes' : 'shapes'];
    const set = cat === 'level' ? this.levels : cat === 'type' ? this.types : cat === 'customType' ? this.customTypes : this.shapes;
    if (!all?.length) return; const allSelected = all.every((v: any) => (set as any).has(v));
    if (allSelected) (set as any).clear(); else all.forEach((v: any) => (set as any).add(v)); this.changed();
  }
  setSearchQuery(q: string) { this.searchQuery = (q || '').toLowerCase(); if (this.searchQuery) this.hideAll = false; this.changed(); }
  setServerSearchIds(ids: Set<string> | null) { this.serverSearchIds = ids; this.changed(); }
  private toggle(set: Set<any>, v: any) { if (set.has(v)) set.delete(v); else set.add(v); this.changed(); }
  private changed() {
    if (this.levels.size || this.types.size || this.customTypes.size || this.shapes.size || this.projects.size || this.searchQuery) this.hideAll = false;
    this.onUpdate?.();
  }
  private getShape(node: any): string {
    const c = node.metadata?.customType; if (c === 'middle-term') return 'torus';
    const m: Record<string, string> = { fact: 'octahedron', concept: 'octahedron', knowledge: 'octahedron', research: 'octahedron', core: 'dodecahedron', decision: 'dodecahedron', lesson: 'dodecahedron', review: 'tetrahedron', architecture: 'box', convention: 'box', rule: 'icosahedron', skill: 'icosahedron', plan: 'cylinder', workflow: 'cone', note: 'sphere', task: 'sphere', session: 'sphere', preference: 'sphere', improvement: 'cylinder', howto: 'cylinder', exploration: 'cylinder', 'debug-investigation': 'cylinder', event: 'tetrahedron', episode: 'tetrahedron', bug: 'tetrahedron', fix: 'tetrahedron', playbook: 'torus', playbook_version: 'torus', dot: 'torusKnot', unknown: 'sphere' };
    return m[node.type] ?? 'sphere';
  }
  matches(node: any): boolean {
    if (!node || this.hideAll) return false;
    if (this.levels.size && !this.levels.has(node.level)) return false;
    if (this.types.size && !this.types.has(node.type || 'unknown')) return false;
    if (this.customTypes.size) { const ct = node.metadata?.customType; if (ct && !this.customTypes.has(ct)) return false; }
    if (this.shapes.size && !this.shapes.has(this.getShape(node))) return false;
    if (this.projects.size) { const p = node.projectName || '(default)'; if (!this.projects.has(p)) return false; }
    const norm = (v: any) => (v == null || v === '' ? null : v);
    if (norm(this.supertypeFilter) !== null && norm(node.supertype) !== norm(this.supertypeFilter)) return false;
    if (norm(this.sourceFilter) !== null && norm(node.source) !== norm(this.sourceFilter)) return false;
    if (norm(this.domainFilter) !== null && norm(node.domain) !== norm(this.domainFilter)) return false;
    if (this.searchQuery) {
      if (this.searchMode === 'text') { const q = this.searchQuery; const lm = node.label?.toLowerCase().includes(q); const cm = node.content?.toLowerCase().includes(q); if (!lm && !cm) return false; }
      else if (this.serverSearchIds && !this.serverSearchIds.has(node.id)) return false;
    }
    return true;
  }
  apply(data: any[]) { return data.filter((n) => this.matches(n)); }
}
