<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/accessapi';

	let metrics: any = $state(null);
	let err = $state<string|null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			metrics = await api.telemetry();
		} catch(e) { err = String(e); }
		finally { loading = false; }
	});
</script>

<div class="card p-4 space-y-3">
	<h4 class="h4">Telemetry</h4>
	{#if loading}
		<p class="text-xs opacity-80">Loading…</p>
	{:else if err}
		<p class="text-error text-xs">{err}</p>
	{:else}
		{@const d = metrics?.days ?? []}
		{@const c = metrics?.compressions ?? []}
		<div class="grid grid-cols-2 gap-3">
			<div><p class="text-[11px] opacity-80">Total Compressions</p><p class="h2">{c?.length ?? 0}</p></div>
			<div><p class="text-[11px] opacity-80">Saved Ratio</p><p class="h2">{c?.length ? (c.reduce((s:any, x:any) => s + (x.savings_ratio ?? 0), 0) / c.length * 100).toFixed(1) : '—'}%</p></div>
		</div>
		{#if c?.length}
			<div class="space-y-1">
				{#each c.slice(-20) as item}
					<div class="flex items-center gap-2 text-[11px]">
						<span class="opacity-80 w-[80px] truncate">{item.strategy ?? '—'}</span>
						<div class="flex-1 h-2 rounded-full overflow-hidden" style="background:var(--color-surface-200)">
							<div class="h-full rounded-full" style="width:{Math.min((item.savings_ratio ?? 0) * 100, 100)}%;background:var(--color-primary-500)"></div>
						</div>
						<span class="opacity-90 w-[60px] text-right">{(item.savings_ratio ?? 0) * 100 | 0}%</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if d?.length}
			<div>
				<p class="text-[11px] opacity-80 mt-2">Token History (last 7 days)</p>
				<div class="flex items-end gap-1 h-16 mt-1">
					{#each d.slice(-14) as day}
						<div class="flex-1 rounded-t" style="height:{Math.max(day.totalInputTokens ?? day.totalOutputTokens ?? 0, 1)}px;background:var(--color-primary-500);opacity:0.8"></div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
