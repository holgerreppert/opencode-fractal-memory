<script lang="ts">
	let { counts = null, overlay = false } = $props<{ counts?: Record<string, number> | null; overlay?: boolean }>();
	// Real legend — mirrors SceneController.ts LEVEL_COLORS/TYPE_SHAPES/TYPE_COLORS
	const LEVEL_COLORS: Record<number,string> = { 0:'#4a9eff', 1:'#34d399', 2:'#fb923c', 3:'#a78bfa', 4:'#f472b6', 5:'#fbbf24' };
	const TYPE_ROWS: { shape:string; color:string; types:string[] }[] = [
		{ shape:'◆', color:'#34d399', types:['fact','concept','knowledge','research','summary'] },
		{ shape:'⬢', color:'#fbbf24', types:['core','decision','lesson'] },
		{ shape:'▲', color:'#a78bfa', types:['review','bug','fix','event'] },
		{ shape:'■', color:'#4a9eff', types:['architecture','convention'] },
		{ shape:'⬣', color:'#f472b6', types:['rule','skill'] },
		{ shape:'⬯', color:'#60a5fa', types:['plan','workflow','howto'] },
		{ shape:'●', color:'#9ca3af', types:['note','task','session'] },
		{ shape:'◎', color:'#06b6d4', types:['dot ◈'] },
	];
	let open = $state(false);
</script>
{#if overlay}
<div class="absolute top-3 right-3 z-10 bg-white/95 backdrop-blur border border-surface-200 p-2.5 rounded-xl shadow-xl max-w-[320px] text-surface-900">
	<div class="flex items-center gap-2">
		<button class="btn btn-sm preset-filled-primary-500 py-1 h-6 text-[10px]" onclick={() => (open = !open)} aria-expanded={open}>Legend {open ? '▾' : '▸'}</button>
		{#if !open}<span class="text-[11px] text-surface-600">Levels 0–5 · 8 shapes · dot ◈</span>{/if}
	</div>
	{#if open}
		<div class="mt-2 pt-2 border-t border-surface-200 space-y-2">
			<div class="flex flex-wrap gap-1.5">{#each Object.entries(LEVEL_COLORS) as [lvl,c]}<span class="flex items-center gap-1 text-[11px]"><span class="size-2.5 rounded-full shrink-0" style="background:{c}"></span>L{lvl}</span>{/each}<span class="text-[10px] text-surface-500 ml-1">size = importance</span></div>
			<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-tight">{#each TYPE_ROWS as r}<span class="flex items-center gap-1"><span class="text-[12px] shrink-0" style="color:{r.color}">{r.shape}</span><span class="truncate">{r.types.join(', ')}</span></span>{/each}</div>
			<div class="text-[10px] text-surface-500">Edges: <span class="text-[#4a9eff]">● hub parent</span> · <span class="text-surface-600">● generic</span></div>
		</div>
	{/if}
</div>
{:else}
<div class="card preset-filled-surface-100 p-2 flex flex-wrap gap-2 items-center text-xs">
	<button class="btn btn-sm preset-tonal py-1 h-6 text-xs" onclick={() => (open = !open)} aria-expanded={open}>Legend {open ? '▾' : '▸'}</button>
	{#if !open}<span class="text-surface-600 text-[11px]">Levels 0–5 · shapes · dot ◈ — click ▸</span>
	{:else}
		<div class="w-full mt-1 pt-2 border-t border-surface-200 space-y-2">
			<div class="flex flex-wrap gap-1.5">{#each Object.entries(LEVEL_COLORS) as [lvl,c]}<span class="flex items-center gap-1 text-[11px]"><span class="size-2.5 rounded-full" style="background:{c}"></span>L{lvl}</span>{/each}</div>
			<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">{#each TYPE_ROWS as r}<span class="flex items-center gap-1"><span style="color:{r.color}">{r.shape}</span>{r.types.join(', ')}</span>{/each}</div>
		</div>
	{/if}
</div>
{/if}
