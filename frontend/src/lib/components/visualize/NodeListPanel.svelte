<script lang="ts">
	import { Logger } from '$lib/api/logger';
	let { nodes = [], selectedId = null, onSelect } = $props<{ nodes: any[]; selectedId: string | null; onSelect: (n:any)=>void }>();
	let q = $state(''); let filtered = $derived.by(()=> q ? nodes.filter((n:any)=> (n.label+n.content).toLowerCase().includes(q.toLowerCase())) : nodes);
	$effect(()=> { Logger.debug('[list] visible', filtered.length, '/', nodes.length); });
</script>
<div class="card preset-filled-surface-100 flex flex-col h-[560px] overflow-hidden rounded-xl border shadow-sm">
	<div class="p-3 border-b bg-surface-50/70 flex gap-2"><input class="input flex-1 rounded-full" placeholder="Filter list..." bind:value={q} /><span class="badge preset-filled-primary-500 rounded-full">{filtered.length}</span></div>
	<div class="overflow-auto flex-1 divide-y divide-surface-200">
		{#each filtered as n (n.id)}<button class="w-full text-left p-3 hover:bg-surface-100 dark:hover:bg-surface-800 text-xs transition {selectedId===n.id?'preset-filled-primary-500 text-white':''}" onclick={()=> onSelect(n)}><div class="font-bold truncate">{n.label}</div><div class="opacity-60 truncate">{n.type} · L{n.level} · {n.importance?.toFixed?.(2) ?? n.importance}</div></button>{:else}<p class="p-4 opacity-60 text-sm">No nodes</p>{/each}
	</div>
</div>
