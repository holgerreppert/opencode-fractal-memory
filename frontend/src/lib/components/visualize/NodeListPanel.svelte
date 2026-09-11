<script lang="ts">
	import { Logger } from '$lib/api/logger';
	let { nodes = [], selectedId = null, onSelect } = $props<{ nodes: any[]; selectedId: string | null; onSelect: (n:any)=>void }>();
	let q = $state('');
	let debouncedQ = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void q;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => { debouncedQ = q; }, 150);
		return () => { if (debounceTimer) clearTimeout(debounceTimer); };
	});
	let filtered = $derived.by(() => debouncedQ ? nodes.filter((n:any)=> (n.label+n.content).toLowerCase().includes(debouncedQ.toLowerCase())) : nodes);
	let visible = $derived(!debouncedQ && filtered.length > 200 ? filtered.slice(0, 200) : filtered);
	$effect(()=> { Logger.debug('[list] visible', visible.length, '/', nodes.length, !debouncedQ && filtered.length > 200 ? '(windowed 200)' : ''); });
</script>
<div class="card preset-filled-surface-100 flex flex-col h-[560px] overflow-hidden rounded-xl border shadow-sm">
	<div class="p-3 border-b bg-surface-50/70 flex gap-2"><input class="input flex-1 rounded-full" placeholder="Filter list..." bind:value={q} /><span class="badge preset-filled-primary-500 rounded-full">{filtered.length}</span></div>
	<div class="overflow-auto flex-1 divide-y divide-surface-200">
		{#each visible as n (n.id)}<button class="w-full text-left p-3 hover:bg-surface-100 dark:hover:bg-surface-800 text-xs transition {selectedId===n.id?'preset-filled-primary-500 text-white':''}" onclick={()=> onSelect(n)}><div class="font-bold truncate">{n.label}</div><div class="text-surface-500 truncate">{n.type} · L{n.level} · {n.importance?.toFixed?.(2) ?? n.importance}</div></button>{:else}<p class="p-4 text-surface-500 text-sm">No nodes</p>{/each}
		{#if !debouncedQ && filtered.length > 200}<p class="p-2 text-xs text-surface-500 text-center">Showing 200 of {filtered.length} — use filter to see more</p>{/if}
	</div>
</div>
