<script lang="ts">
  import { onMount } from 'svelte';
let hub = $state<any>(null);
let children = $state<any[]>([]);
let leaves = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  onMount(async () => {
    try {
      const pickHub = (arr: any[]) => arr.find((n:any) => n.label === 'fact:opencode-fractal-memory-hub') ?? arr[0] ?? null;
      let found: any = null;
      try {
        const r = await fetch(`http://127.0.0.1:8787/api/search?q=${encodeURIComponent('fact:opencode-fractal-memory-hub')}&scope=all&mode=hybrid`);
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j.results ?? j.nodes ?? []);
        found = pickHub(arr);
      } catch {}
      let all: any[] = [];
      try {
        const lr = await fetch('http://127.0.0.1:8787/api/nodes?scope=all&limit=10000');
        const lj = await lr.json();
        all = Array.isArray(lj) ? lj : (lj.nodes ?? lj.results ?? []);
        if (!found) found = all.find((n:any) => n.label === 'fact:opencode-fractal-memory-hub') ?? null;
      } catch {}
      hub = found;
      if (!hub) throw new Error('fact:opencode-fractal-memory-hub not found');
      if (all.length === 0) {
        const lr = await fetch('http://127.0.0.1:8787/api/nodes?scope=all&limit=10000');
        const lj = await lr.json();
        all = Array.isArray(lj) ? lj : (lj.nodes ?? []);
      }
      const hubId = hub.id;
      const hubLabel = hub.label;
      const hasParent = (n:any, ids:Set<string>, labels:Set<string>) => {
        const pids:string[] = n.parentIds ?? n.parent_ids ?? [];
        return pids.some((pid:string) => ids.has(pid) || labels.has(pid));
      };
      children = all.filter((n:any) => {
        const pids:string[] = n.parentIds ?? n.parent_ids ?? [];
        return pids.includes(hubId) || pids.includes(hubLabel);
      }).sort((a:any,b:any) => (a.label??'').localeCompare(b.label??''));
      const childIds = new Set(children.map((c:any)=>c.id));
      const childLabels = new Set(children.map((c:any)=>c.label));
      leaves = all.filter((n:any) => {
        if (n.id === hubId || childIds.has(n.id)) return false;
        return hasParent(n, childIds, childLabels);
      }).sort((a:any,b:any) => (a.label??'').localeCompare(b.label??''));
    } catch(e:any){ error = String(e?.message ?? e); console.error('[hub] load failed', e); }
    finally { loading = false; }
  });
</script>

<div class="space-y-4">
  <div class="card preset-filled-surface-100 p-4 space-y-3">
    <h3 class="h3">Project Hub — crystal-clear fine-grained network</h3>
    <p class="text-sm opacity-80">Hub {hub?.label ?? 'fact:opencode-fractal-memory-hub'} → L1 arch/convention → L2 lesson/fix. Position is central — pick most specific parent via search+network before set.</p>
    {#if loading}<div class="text-xs opacity-70">Loading hub…</div>{/if}
    {#if error}<p class="variant-filled-error-500 text-sm p-2">{error}</p>{/if}
  </div>
  {#if hub}
    <div class="card preset-tonal p-4 space-y-3">
      <h4 class="h4">{hub.label} <span class="badge preset-filled-primary-500">{hub.type}</span></h4>
      {#if hub.summary}<div class="variant-filled-surface-100 p-3"><b>Summary:</b> {hub.summary}</div>{/if}
      {#if hub.keywords}<div class="variant-filled-surface-200 p-2 text-xs font-mono"><b>Keywords (BM25 ×2):</b> {hub.keywords}</div>{/if}
      <pre class="variant-soft-surface-900 p-3 text-sm text-surface-100 whitespace-pre-wrap">{hub.content?.slice(0,400)}</pre>
    </div>
  {/if}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div class="card preset-outlined-surface-200 p-4 space-y-3">
      <h4 class="h4">L1 — Structural map ({children.length})</h4>
      <div class="space-y-2 mt-2">
        {#each children as c}
          <div class="card preset-outlined-surface-200 p-3">
            <div class="flex gap-2 items-center"><span class="badge preset-tonal">{c.type}</span><span class="text-xs">{c.label}</span></div>
            {#if c.summary}<div class="text-xs opacity-90 mt-1">{c.summary}</div>{/if}
            {#if c.keywords}<div class="text-[10px] font-mono opacity-70 mt-1">{c.keywords}</div>{/if}
            <div class="text-[10px] font-mono opacity-70 mt-1">parent_ids: {(c.parentIds ?? []).join(' → ').slice(0,80)}</div>
          </div>
        {/each}
      </div>
    </div>
    <div class="card preset-outlined-surface-200 p-4 space-y-3">
      <h4 class="h4">L2 — Leaves under L1 ({leaves.length})</h4>
      <div class="space-y-2 mt-2">
        {#each leaves as l}
          <div class="card preset-outlined-surface-200 p-3">
            <div class="flex gap-2 items-center"><span class="badge preset-filled-secondary-500">{l.type}</span><span class="text-xs">{l.label}</span></div>
            {#if l.summary}<div class="text-xs opacity-90 mt-1">{l.summary}</div>{/if}
            <div class="text-[10px] font-mono opacity-70 mt-1">parent_ids: {(l.parentIds ?? []).join(' → ').slice(0,80)}</div>
          </div>
        {/each}
        {#if leaves.length===0}<div class="text-xs opacity-70">No leaves yet — create via <code>project_hub(set, parent_ids="arch:specific,fact:opencode-fractal-memory-hub")</code></div>{/if}
      </div>
    </div>
  </div>
</div>
