<script lang="ts">
	import { nodesStore } from '$lib/stores/nodes.svelte';
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	onMount(() => { nodesStore.load(); Logger.debug('[dashboard] mount'); });
	let byType = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const n of nodesStore.nodes) m[n.type ?? 'unknown'] = (m[n.type ?? 'unknown'] ?? 0) + 1;
		return Object.entries(m).sort((a,b)=>b[1]-a[1]);
	});
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4"><h3 class="h3">Dashboard</h3><p class="text-sm opacity-80">Stats by type · level · domain</p></div>
	<div class="grid md:grid-cols-4 gap-4">
		<div class="card preset-tonal p-4"><div class="text-xs opacity-70">Total</div><div class="h4">{nodesStore.nodes.length}</div></div>
		{#each byType.slice(0,3) as [k,v] (k)}<div class="card preset-tonal p-4"><div class="text-xs opacity-70">{k}</div><div class="h4">{v}</div></div>{/each}
	</div>
	<div class="card preset-outlined-surface-200 p-4 space-y-3"><h4 class="h4 mb-2">By type</h4><div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{#each byType as [k,v] (k)}<tr><td>{k}</td><td>{v}</td></tr>{/each}</tbody></table></div></div>
</div>
