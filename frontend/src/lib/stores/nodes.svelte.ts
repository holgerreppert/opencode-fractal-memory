// Step 4 — Nodes store with runes (port of Alpine NodeFilterEngine)
import { api } from '$lib/api/accessapi';

export type Node = { id: string; label: string; content: string; type?: string };

class NodesStore {
  query = $state('');
  nodes = $state<Node[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  filtered = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.nodes;
    return this.nodes.filter((n) => (n.label + n.content).toLowerCase().includes(q));
  });

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const res = await api.listNodes();
      this.nodes = (res.nodes as Node[]) ?? [];
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }

  async search(q: string) {
    this.query = q;
    if (!q.trim()) return this.load();
    this.loading = true;
    try {
      const res = await api.search(q);
      this.nodes = (res.results as Node[]) ?? [];
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }
}

export const nodesStore = new NodesStore();
