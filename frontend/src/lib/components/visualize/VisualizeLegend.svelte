<script lang="ts">
	const items = [
		{ color: 'bg-primary-500', label: 'fact' },
		{ color: 'bg-secondary-500', label: 'lesson' },
		{ color: 'bg-tertiary-500', label: 'knowledge' },
		{ color: 'bg-success-500', label: 'concept' },
		{ color: 'bg-warning-500', label: 'dot ◈' }
	];
</script>

<div class="card preset-filled-surface-100 p-3 flex flex-wrap gap-3 items-center">
	<span class="text-xs opacity-60 uppercase">Legend</span>
	{#each items as it}
		<span class="flex items-center gap-2 text-sm"><span class="size-3 rounded-full {it.color}"></span>{it.label}</span>
	{/each}
	<span class="ml-auto text-xs opacity-60">Level • Type • Importance</span>
</div>
