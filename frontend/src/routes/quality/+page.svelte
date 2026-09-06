<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { api } from '$lib/api/accessapi';
	import { onMount } from 'svelte';
	let quality: any = $state(null);
	onMount(async () => {
		try { quality = await fetch('http://127.0.0.1:8787/api/injection-quality').then(r=>r.json()); Logger.debug('[quality]', quality); } catch (e) { Logger.warn('[quality] failed', e); }
	});
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4"><h1 class="h3">Quality</h1><p class="opacity-70 text-sm">Injection quality • compression stats</p></div>
	<div class="card p-4"><pre class="text-xs overflow-auto max-h-[500px]">{JSON.stringify(quality ?? {}, null, 2)}</pre></div>
</div>
