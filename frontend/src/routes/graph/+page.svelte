<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/accessapi';
	import GraphD3 from '$lib/components/GraphD3.svelte';

	let data: { nodes: any[]; edges: any[] } | null = $state(null);
	let query = $state('');
	let selected: any = $state(null);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const res = await api.graph('');
			if ((res as any).error) { error = (res as any).error; loading = false; return; }
			data = { nodes: (res as any).nodes ?? [], edges: (res as any).edges ?? [] };
			loading = false;
		} catch (e) { error = String(e); loading = false; }
	});
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex flex-wrap justify-between items-center gap-3">
		<div>
			<h3 class="h3">Code Graph</h3>
			<p class="text-sm text-surface-500">D3 force layout — same as :8787. Search dims non-matches, hover for file:line.</p>
		</div>
		<div class="flex gap-2 items-center">
			<input class="input w-[220px] rounded-full text-sm" placeholder="Search label/file…" bind:value={query} />
			{#if data}<span class="badge preset-tonal text-xs">{data.nodes.length} nodes · {data.edges.length} edges</span>{/if}
		</div>
	</div>

	{#if loading}
		<div class="card preset-filled-surface-100 p-6 text-sm text-surface-500 animate-pulse">Loading graph…</div>
	{:else if error}
		<div class="card preset-filled-error-500 p-6 text-sm">{error}</div>
	{:else if data}
		<GraphD3 {data} {query} onSelect={(n)=> selected = n} />
		{#if selected}
			<div class="card preset-filled-surface-100 p-4 space-y-2">
				<div class="flex justify-between items-center"><span class="font-bold text-sm">{selected.label}</span><button class="btn btn-sm preset-tonal rounded-full" onclick={()=> selected=null}>✕</button></div>
				<div class="flex gap-2 text-xs"><span class="badge preset-tonal">{selected.type}</span><span class="badge preset-tonal">{selected.kind ?? '—'}</span><span class="badge preset-tonal">{selected.community ?? '—'}</span></div>
				{#if selected.file}<div class="text-xs font-mono text-surface-500">{selected.file}{selected.line ? `:${selected.line}` : ''}</div>{/if}
				<div class="text-xs text-surface-500">degree {selected.degree ?? 0}</div>
			</div>
		{/if}
	{/if}
</div>
