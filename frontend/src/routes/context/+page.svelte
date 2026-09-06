<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Logger } from '$lib/api/logger';
	import { api } from '$lib/api/accessapi';
	import { onMount } from 'svelte';
	let stats: any = $state(null);
	onMount(async () => {
		try { stats = await api.telemetry(); Logger.debug('[context] stats', stats); } catch (e) { Logger.warn('[context] load failed', e); }
	});
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4"><h1 class="h3">{$t('nav.context') ?? 'Context'}</h1><p class="opacity-70 text-sm">Token history • compression • injection quality</p></div>
	<div class="grid md:grid-cols-3 gap-4">
		<div class="card p-4"><div class="text-xs opacity-60">Nodes</div><div class="h2">{stats?.totalNodes ?? '—'}</div></div>
		<div class="card p-4"><div class="text-xs opacity-60">Edges</div><div class="h2">{stats?.totalEdges ?? '—'}</div></div>
		<div class="card p-4"><div class="text-xs opacity-60">Sessions</div><div class="h2">{stats?.sessions ?? '—'}</div></div>
	</div>
	<pre class="card p-4 text-xs overflow-auto max-h-[400px]">{JSON.stringify(stats ?? {}, null, 2)}</pre>
</div>
