<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchJson } from '$lib/api/accessapi';
	import DetailPanel from '$lib/components/visualize/DetailPanel.svelte';

	let hub = $state<any>(null);
	let children = $state<any[]>([]);
	let leaves = $state<any[]>([]);
	let loading = $state(true);
	let error = $state('');
	let filter = $state('');
	let selected = $state<any>(null);

	let filteredChildren = $derived.by(() => {
		if (!filter.trim()) return children;
		const q = filter.toLowerCase();
		return children.filter((c: any) => `${c.label} ${c.summary ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(q));
	});
	let filteredLeaves = $derived.by(() => {
		if (!filter.trim()) return leaves;
		const q = filter.toLowerCase();
		return leaves.filter((l: any) => `${l.label} ${l.summary ?? ''} ${l.keywords ?? ''}`.toLowerCase().includes(q));
	});

	onMount(async () => {
		try {
			const pickHub = (arr: any[]) => arr.find((n: any) => n.label === 'fact:opencode-fractal-memory-hub') ?? null;
			let found: any = null;
			try {
				const j = await fetchJson<any>(`/api/search?q=${encodeURIComponent('fact:opencode-fractal-memory-hub')}&scope=all&mode=hybrid`);
				const arr = Array.isArray(j) ? j : ((j as any).results ?? (j as any).nodes ?? []);
				found = pickHub(arr);
			} catch {}
			const lj = await fetchJson<any>(`/api/nodes?scope=all&limit=10000`);
			const all: any[] = Array.isArray(lj) ? lj : ((lj as any).nodes ?? (lj as any).results ?? []);
			if (!found) found = all.find((n: any) => n.label === 'fact:opencode-fractal-memory-hub') ?? null;
			hub = found;
			if (!hub) throw new Error('fact:opencode-fractal-memory-hub not found');
			const hubId = hub.id;
			const hubLabel = hub.label;
			const hasParent = (n: any, ids: Set<string>, labels: Set<string>) => {
				const pids: string[] = n.parentIds ?? n.parent_ids ?? [];
				return pids.some((pid: string) => ids.has(pid) || labels.has(pid));
			};
			children = all
				.filter((n: any) => {
					const pids: string[] = n.parentIds ?? n.parent_ids ?? [];
					return pids.includes(hubId) || pids.includes(hubLabel);
				})
				.sort((a: any, b: any) => (a.label ?? '').localeCompare(b.label ?? ''));
			const childIds = new Set(children.map((c: any) => c.id));
			const childLabels = new Set(children.map((c: any) => c.label));
			leaves = all
				.filter((n: any) => {
					if (n.id === hubId || childIds.has(n.id)) return false;
					return hasParent(n, childIds, childLabels);
				})
				.sort((a: any, b: any) => (a.label ?? '').localeCompare(b.label ?? ''));
		} catch (e: any) {
			error = String(e?.message ?? e);
			console.error('[hub] load failed', e);
		} finally {
			loading = false;
		}
	});
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 space-y-3">
		<div class="flex flex-wrap gap-3 items-center justify-between">
			<h3 class="h3">Project Hub — fine-grained network</h3>
			<input class="input w-full max-w-[280px] rounded-full text-sm" placeholder="Filter hub…" bind:value={filter} />
		</div>
		<p class="text-sm text-surface-600">
			{#if hub}{hub.label}{:else}fact:opencode-fractal-memory-hub{/if} → L1 arch / convention → L2 lesson / fix. Position is central — pick most specific parent via search + network before set.
		</p>
		{#if loading}<div class="text-sm text-surface-500 animate-pulse">Loading hub…</div>{/if}
		{#if error}<p class="preset-filled-error-500 text-sm p-3 rounded-xl">{error}</p>{/if}
	</div>

	{#if hub}
		<button class="card preset-tonal p-4 space-y-3 w-full text-left hover:preset-filled-surface-200 transition" onclick={() => (selected = hub)}>
			<h4 class="h4 flex items-center gap-2">{hub.label} <span class="badge preset-filled-primary-500">{hub.type}</span></h4>
			{#if hub.summary}<div class="preset-filled-surface-100 p-3 rounded-xl text-sm">{hub.summary}</div>{/if}
			{#if hub.keywords}<div class="preset-tonal p-2 text-xs font-mono rounded-xl">Keywords (BM25 ×2): {hub.keywords}</div>{/if}
			<pre class="bg-surface-900 text-surface-50 p-3 text-xs whitespace-pre-wrap rounded-xl max-h-[160px] overflow-auto">{hub.content?.slice(0, 600)}{(hub.content?.length ?? 0) > 600 ? '…' : ''}</pre>
			<span class="text-xs text-surface-500">Click for full detail →</span>
		</button>
	{/if}

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">L1 — Structural map ({filteredChildren.length}{filter ? ` / ${children.length}` : ''})</h4>
			<div class="space-y-2">
				{#each filteredChildren as c (c.id)}
					<button class="card preset-outlined-surface-200 p-3 w-full text-left hover:preset-tonal transition" onclick={() => (selected = c)}>
						<div class="flex gap-2 items-center"><span class="badge preset-tonal text-xs">{c.type}</span><span class="text-xs font-bold truncate">{c.label}</span></div>
						{#if c.summary}<div class="text-xs text-surface-600 mt-1 line-clamp-2">{c.summary}</div>{/if}
						{#if c.keywords}<div class="text-[10px] font-mono text-surface-500 mt-1 truncate">{c.keywords}</div>{/if}
						<div class="text-[10px] font-mono text-surface-500 mt-1 truncate" title={(c.parentIds ?? c.parent_ids ?? []).join(' → ')}>parent_ids: {(c.parentIds ?? c.parent_ids ?? []).join(' → ').slice(0, 80)}</div>
					</button>
				{:else}
					<p class="text-sm text-surface-500 p-2">{filter ? 'No matches' : 'No L1 nodes yet'}</p>
				{/each}
			</div>
		</div>

		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">L2 — Leaves under L1 ({filteredLeaves.length}{filter ? ` / ${leaves.length}` : ''})</h4>
			<div class="space-y-2">
				{#each filteredLeaves as l (l.id)}
					<button class="card preset-outlined-surface-200 p-3 w-full text-left hover:preset-tonal transition" onclick={() => (selected = l)}>
						<div class="flex gap-2 items-center"><span class="badge preset-filled-secondary-500 text-xs">{l.type}</span><span class="text-xs font-bold truncate">{l.label}</span></div>
						{#if l.summary}<div class="text-xs text-surface-600 mt-1 line-clamp-2">{l.summary}</div>{/if}
						<div class="text-[10px] font-mono text-surface-500 mt-1 truncate" title={(l.parentIds ?? l.parent_ids ?? []).join(' → ')}>parent_ids: {(l.parentIds ?? l.parent_ids ?? []).join(' → ').slice(0, 80)}</div>
					</button>
				{:else}
					<div class="text-sm text-surface-500 p-2">
						{#if filter}No matches{:else}No leaves yet — create via <code class="preset-tonal px-1 rounded">project_hub(set, parent_ids="arch:specific,fact:opencode-fractal-memory-hub")</code>{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

{#if selected}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onclick={() => (selected = null)} role="presentation"></div>
	<div class="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
		<div class="pointer-events-auto w-full max-w-[640px] max-h-[90vh] overflow-auto rounded-xl bg-surface-50 dark:bg-surface-900 shadow-2xl border border-surface-200">
			<DetailPanel node={selected} onClose={() => (selected = null)} />
		</div>
	</div>
{/if}
