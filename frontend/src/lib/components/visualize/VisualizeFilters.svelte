<script lang="ts">
	import { nodesStore } from '$lib/stores/nodes.svelte';
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	let { query = $bindable(''), scope = $bindable('all'), layout = $bindable('shell'), children } = $props();
	const layouts = ['shell', 'type-cluster', 'brain', 'force'] as const;
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
	$effect(() => {
		// persist
		try {
			localStorage.setItem(LS_KEY, JSON.stringify({ scope, layout, query }));
		} catch {}
	});
	// reactive scope switching like original buildScopeButtons
	$effect(() => { void scope; nodesStore.setScope(scope, null); });
</script>

<div class="card preset-filled-surface-100 p-3 flex flex-col lg:flex-row gap-3 items-center shadow-sm flex-wrap">
	<div class="relative flex-1 min-w-[220px] max-w-[420px] flex items-center shrink-0">
		<span class="absolute left-3 opacity-40 pointer-events-none">🔍</span>
		<input autofocus class="input w-full pl-9 pr-20 rounded-full border-2 focus:border-primary-500 text-surface-900 dark:text-white bg-white dark:bg-surface-800 min-w-0" placeholder="Search memory… (⌘K) — Enter to search, Esc clear" bind:value={query} onkeydown={(e)=> { if(e.key==='Escape') query=''; if(e.key==='Enter' && query.trim()) Logger.debug('[search] enter', query); }} />
		<div class="absolute right-1 flex items-center gap-1">
			{#if query}<button class="btn btn-sm preset-tonal rounded-full px-2 text-xs shrink-0" onclick={()=> { query=''; Logger.debug('[search] clear'); }}>✕</button>{/if}
			<span class="badge preset-filled-primary-500 rounded-full text-[10px] px-1.5 shrink-0">{query.length ? '↩' : '/'}</span>
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
	<div class="flex gap-1 flex-wrap">
		{#each layouts as l (l)}
			<button class="btn btn-sm {layout === l ? 'preset-filled-primary-500' : 'preset-tonal'}" onclick={() => layout = l}>{l}</button>
		{/each}
	</div>
	<div class="ml-auto flex gap-1 flex-wrap">
		{#each Object.entries(nodesStore.typeCounts ?? Object.fromEntries(['concept','fact','lesson','dot'].map(t=>[t, nodesStore.nodes.filter(n=>n.type===t).length]))) as [chip, cnt] (chip)}<button class="chip preset-tonal rounded-full text-xs px-3 py-1 hover:preset-filled-primary-500 flex items-center gap-1" onclick={()=> query=chip}>{chip}<span class="badge preset-filled-surface-200 rounded-full px-1.5 text-[10px]">{cnt}</span></button>{/each}
		{#each Object.entries(nodesStore.levelCounts ?? {}).sort((a,b)=>+a[0]-+b[0]) as [lvl, cnt] (lvl)}<button class="chip preset-tonal rounded-full text-xs px-3 py-1">L{lvl}<span class="badge preset-filled-surface-200 rounded-full px-1.5 text-[10px] ml-1">{cnt}</span></button>{/each}
	</div>
	{#if children}<span class="ml-2">{@render children()}</span>{/if}
	<!-- original .filter-btn / activeFilterChips / clearAll + level chips like management/public/index.html:580-590 -->
	<div class="flex flex-wrap gap-1 mt-2 w-full">
		{#each ['Level 0','Level 1','Type fact','◈ dot'] as c (c)}<span class="filter-btn active"><span class="chip-label">{c}</span> <button onclick={()=> query=c} class="ml-1">×</button></span>{/each}
		<button class="filter-btn select-all-btn">Clear all</button>
	</div>
</div>
