<script lang="ts">
	import { page } from '$app/stores';
	import ThemeSwitcher from '$lib/components/theme/ThemeSwitcher.svelte';

	const nav = [
		{ id: 'visualize', href: '/', label: 'Visualize' },
		{ id: 'hub', href: '/hub', label: 'Hub' },
		{ id: 'dashboard', href: '/dashboard', label: 'Dashboard' },
		{ id: 'context', href: '/context', label: 'Context' },
		{ id: 'quality', href: '/quality', label: 'Quality' },
		{ id: 'graph', href: '/graph', label: 'Graph' },
		{ id: 'memory', href: '/memory', label: 'Memory' },
		{ id: 'live-agent', href: '/live', label: 'Live' },
		{ id: 'settings', href: '/settings', label: 'Settings' },
		{ id: 'backup', href: '/backup', label: 'Backup' }
	] as const;

	let currentPath = $derived($page.url.pathname);

	function isActive(href: string) {
		return currentPath === href || (href !== '/' && currentPath.startsWith(href));
	}
</script>

<header class="preset-filled-surface-100 border-b border-surface-200 px-3 py-1.5 flex items-center gap-3">
	<span class="font-bold text-sm shrink-0">Fractal Memory</span>
	<nav class="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
		{#each nav as it}
			<a href={it.href} class="btn btn-sm h-7 text-xs whitespace-nowrap {isActive(it.href) ? 'preset-filled-primary-500' : 'preset-tonal hover:preset-tonal-primary'}" data-tab={it.id}>{it.label}</a>
		{/each}
	</nav>
	<div class="shrink-0">
		<ThemeSwitcher />
	</div>
</header>
