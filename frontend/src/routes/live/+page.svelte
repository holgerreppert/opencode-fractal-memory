<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	let feed: any[] = $state([]);
	let timer: any;
	onMount(() => {
		Logger.debug('[live] mount');
		const poll = async () => {
			try { const res = await fetch('http://127.0.0.1:8787/api/live').then(r=> r.json()); feed = (res.turns ?? []).slice(0,20); } catch (e) { Logger.warn('[live] poll failed', e); }
		};
		poll(); timer = setInterval(poll, 3000);
		return () => clearInterval(timer);
	});
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4"><h1 class="h3">Live Agent</h1><p class="opacity-70 text-sm">SSE /api/live — last 20 turns</p></div>
	<div class="card p-4 space-y-2 max-h-[600px] overflow-auto">
		{#each feed as t (t.id)}<div class="border-b py-2 text-xs"><strong>{t.role}</strong> {t.tool_name ?? ''}<pre class="whitespace-pre-wrap opacity-70">{JSON.stringify(t.content ?? '').slice(0,200)}</pre></div>{:else}<p class="opacity-60 text-sm">No turns yet</p>{/each}
	</div>
</div>
