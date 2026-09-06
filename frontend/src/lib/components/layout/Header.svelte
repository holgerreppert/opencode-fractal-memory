<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { t } from 'svelte-i18n';
	import { page } from '$app/stores';

	// Horizontal menu - clone of original groups but flat as requested
	const nav = [
		{ id: 'visualize', href: '/', label: 'Visualize' },
		{ id: 'dashboard', href: '/', label: 'Dashboard' },
		{ id: 'context', href: '/context', label: 'Context' },
		{ id: 'quality', href: '/quality', label: 'Quality' },
		{ id: 'graph', href: '/graph', label: 'Graph' },
		{ id: 'memory', href: '/memory', label: 'Memory' },
		{ id: 'live-agent', href: '/injections', label: 'Live' },
		{ id: 'settings', href: '/settings', label: 'Settings' },
		{ id: 'backup', href: '/backup', label: 'Backup' }
	] as const;

	let currentPath = $derived($page.url.pathname);

	function isActive(href: string) {
		return currentPath === href || (href !== '/' && currentPath.startsWith(href));
	}
</script>

<AppBar class="preset-filled-surface-100 border-b border-surface-200">
	<AppBar.Toolbar class="gap-4">
		<AppBar.Lead>
			<div class="flex items-center gap-3">
				<span class="h5 font-bold">Fractal Memory</span>
				<span class="badge preset-tonal text-xs hidden md:inline">3D Node Visualization</span>
			</div>
		</AppBar.Lead>
		<AppBar.Trail>
			<nav class="hidden lg:flex items-center gap-1 overflow-x-auto">
				{#each nav as it}
					<a href={it.href} class="btn btn-sm {isActive(it.href) ? 'preset-filled-primary-500' : 'preset-tonal hover:preset-tonal-primary'}" data-tab={it.id}>{it.label}</a>
				{/each}
			</nav>
			<!-- mobile: horizontal scroll -->
			<nav class="flex lg:hidden items-center gap-1 overflow-x-auto max-w-[60vw]">
				{#each nav as it}
					<a href={it.href} class="btn btn-sm whitespace-nowrap {isActive(it.href) ? 'preset-filled-primary-500' : 'preset-tonal'}" data-tab={it.id}>{it.label}</a>
				{/each}
			</nav>
		</AppBar.Trail>
	</AppBar.Toolbar>
</AppBar>
