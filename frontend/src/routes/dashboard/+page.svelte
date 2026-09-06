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
	<div class="card preset-filled-surface-100 p-4"><h1 class="h3">Dashboard</h1><p class="opacity-70 text-sm">Stats by type • level • domain</p></div>
	<div class="grid md:grid-cols-4 gap-4">
		<div class="card p-4"><div class="text-xs opacity-60">Total</div><div class="h2">{nodesStore.nodes.length}</div></div>
		{#each byType.slice(0,3) as [k,v] (k)}<div class="card p-4"><div class="text-xs opacity-60">{k}</div><div class="h2">{v}</div></div>{/each}
	</div>
	<div class="card p-4"><h2 class="h4 mb-2">By type</h2><div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>{#each byType as [k,v] (k)}<tr><td>{k}</td><td>{v}</td></tr>{/each}</tbody></table></div></div>
</div>
