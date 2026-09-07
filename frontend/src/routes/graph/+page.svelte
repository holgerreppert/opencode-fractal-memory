<script lang="ts">
	import { t } from 'svelte-i18n';
	import { onMount } from 'svelte';
	import { api } from '$lib/api/accessapi';
	import VisualizeCanvas from '$lib/components/visualize/VisualizeCanvas.svelte';
	import { Logger } from '$lib/api/logger';

	let nodes: any[] = $state([]);
	let layout = $state('force');
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const data = await api.graph('');
			if (data.error) { error = data.error; loading = false; return; }
			const rawNodes = data.nodes ?? [];
			const edges = data.edges ?? [];
			const nodeMap = new Map<string, Set<string>>();
			for (const e of edges) {
				if (!nodeMap.has(e.source)) nodeMap.set(e.source, new Set());
				nodeMap.get(e.source)!.add(e.target);
			}
			nodes = rawNodes.map((n: any, i: number) => ({
				id: n.id ?? `node-${i}`,
				label: n.label ?? n.id ?? `Node ${i}`,
				type: n.type ?? 'file',
				kind: n.kind ?? '',
				file: n.file ?? '',
				line: n.line ?? 0,
				parentIds: Array.from(nodeMap.get(n.id) ?? []),
				depth: 0
			}));
			loading = false;
		} catch (e) { error = String(e); loading = false; }
	});
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center gap-3">
		<div>
			<h3 class="h3">Code Graph</h3>
			<p class="text-sm opacity-70">Explore code structure, dependencies, and relationships.</p>
		</div>
		<div class="flex gap-2">
			<select bind:value={layout} class="input select-sm">
				<option value="force">Force</option>
				<option value="shell">Shell</option>
				<option value="type-cluster">Type Cluster</option>
				<option value="brain">Brain</option>
				<option value="hub">Hub</option>
			</select>
		</div>
	</div>
	{#if loading}
		<div class="card p-6 text-sm opacity-90">Loading graph…</div>
	{:else if error}
		<div class="card p-6 text-sm opacity-90">{error}</div>
	{:else}
		<VisualizeCanvas {nodes} {layout} />
	{/if}
</div>
