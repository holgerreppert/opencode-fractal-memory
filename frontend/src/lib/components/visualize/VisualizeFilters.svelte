<script lang="ts">
	import { nodesStore } from '$lib/stores/nodes.svelte';
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	let { query = $bindable(''), scope = $bindable('all'), layout = $bindable('shell'), children } = $props();
	const layouts = ['hub', 'shell', 'type-cluster', 'brain', 'force'] as const;
	const LS_KEY = 'fractal-visualize';
	// remember option in localStorage like original management/public/search-state.js localStorage scope/layout/query
	onMount(() => {
		nodesStore.loadScopes();
		try {
			const raw = localStorage.getItem(LS_KEY);
			if (raw) {
				const saved = JSON.parse(raw);
				if (saved.scope) scope = saved.scope;
				if (saved.layout) layout = saved.layout;
				if (saved.query !== undefined) query = saved.query;
				Logger.debug('[visualize] localStorage restore', saved);
			}
		} catch (e) { Logger.warn('[visualize] localStorage restore failed', e); }
	});
	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void scope; void layout; void query;
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			try { localStorage.setItem(LS_KEY, JSON.stringify({ scope, layout, query })); } catch {}
		}, 200);
		return () => { if (persistTimer) clearTimeout(persistTimer); };
	});
	// reactive scope switching — guard against double fetch during localStorage restore
	$effect(() => {
		void scope;
		if (scope !== (nodesStore as any).scope && scope !== (nodesStore as any)._scope) nodesStore.setScope(scope, null);
	});
</script>

<div class="card preset-filled-surface-100 p-2 flex flex-col lg:flex-row gap-2 items-center flex-wrap">
	<div class="relative flex-1 min-w-[220px] max-w-[420px] flex items-center shrink-0">
		<span class="absolute left-3 text-surface-500 pointer-events-none">🔍</span>
		<input class="input w-full pl-9 pr-20 text-surface-900 dark:text-white bg-white dark:bg-surface-800 min-w-0" placeholder="Search memory… ({nodesStore.searchMode})" bind:value={query} onkeydown={(e)=> { if(e.key==='Escape') { query=''; nodesStore.query=''; nodesStore.clearFilters(); nodesStore.load(); } if(e.key==='Enter' && query.trim()) nodesStore.search(query.trim(), { mode: nodesStore.searchMode }); }} />
		<div class="absolute right-1 flex items-center gap-1">
			{#if query}<button class="btn btn-sm preset-tonal px-2 text-xs shrink-0" onclick={()=> { query=''; nodesStore.query=''; nodesStore.clearFilters(); nodesStore.load(); Logger.debug('[search] clear'); }}>✕</button>{/if}
			<span class="badge preset-filled-primary-500 text-[10px] px-1.5 shrink-0" title="{nodesStore.searchMode}">{nodesStore.searchMode === 'hybrid' ? '↩ hybrid' : nodesStore.searchMode}</span>
		</div>
	</div>
	<select class="select w-full md:w-[260px]" bind:value={scope}>
		<option value="all">all</option>
		<option value="global">global</option>
		<option value="project">project (current)</option>
		{#each nodesStore.availableScopes as s}
			{#if s.projectName}<option value={`project:${s.projectName}`}>{s.projectName}</option>{/if}
		{/each}
	</select>
	<div class="flex gap-1 flex-wrap items-center">
		<select class="select w-[110px] h-7 text-xs py-0" bind:value={nodesStore.searchMode} title="Search mode">
			<option value="hybrid">hybrid</option>
			<option value="bm25">bm25</option>
			<option value="text">text</option>
		</select>
		{#each layouts as l (l)}
			<button class="btn btn-sm h-7 text-xs px-2 {layout === l ? 'preset-filled-primary-500' : 'preset-tonal'}" onclick={() => layout = l}>{l}</button>
		{/each}
	</div>
	<div class="ml-auto flex gap-1 flex-wrap items-center">
		{#each Object.entries(nodesStore.typeCounts).sort((a,b)=>b[1]-a[1]) as [chip, cnt] (chip)}<button class="chip text-[10px] px-2 py-0.5 h-5 {nodesStore.activeTypes.has(chip) ? 'preset-filled-primary-500 text-white' : 'preset-tonal'}" onclick={() => nodesStore.toggleType(chip)} title="Filter by type {chip}">{chip}<span class="badge {nodesStore.activeTypes.has(chip) ? 'preset-filled-surface-50 text-primary-600' : 'preset-filled-surface-200'} text-[9px] px-1 ml-1">{cnt}</span></button>{/each}
		{#each Object.entries(nodesStore.levelCounts).sort((a,b)=>+a[0]-+b[0]) as [lvl, cnt] (lvl)}<button class="chip text-[10px] px-2 py-0.5 h-5 {nodesStore.activeLevels.has(+lvl) ? 'preset-filled-secondary-500 text-white' : 'preset-tonal'}" onclick={() => nodesStore.toggleLevel(+lvl)} title="Filter by level L{lvl}">L{lvl}<span class="badge preset-filled-surface-200 text-[9px] px-1 ml-1">{cnt}</span></button>{/each}
		{#if nodesStore.activeTypes.size || nodesStore.activeLevels.size}<button class="btn btn-sm preset-outlined-surface-200 text-[10px] h-5 px-2" onclick={() => nodesStore.clearFilters()}>Clear</button>{/if}
	</div>
	{#if children}<span class="ml-2">{@render children()}</span>{/if}
</div>
