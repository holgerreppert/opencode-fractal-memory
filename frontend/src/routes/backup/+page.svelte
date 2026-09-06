<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	type Backup = { id: string; size: number; created: string };
	let list: Backup[] = $state([]); let loading = $state(false);
	async function load() {
		loading = true;
		try {
			const res: any = await fetch('http://127.0.0.1:8787/api/backup').then((r) => r.json());
			list = (Array.isArray(res) ? res : res.backups ?? []) as Backup[];
			Logger.debug('[backup] loaded', list.length);
		} catch (e) { Logger.warn('[backup] failed', e); } finally { loading = false; }
	}
	async function create() {
		try { await fetch('http://127.0.0.1:8787/api/backup', { method: 'POST' }); Logger.success('[backup] created'); await load(); } catch (e) { Logger.error('[backup] create failed', e); }
	}
	onMount(load);
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center"><h1 class="h3">Backup</h1><button class="btn preset-filled-primary-500" onclick={create}>Create backup</button></div>
	{#if loading}<p class="opacity-60 text-sm">Loading…</p>{:else}
	<div class="card p-4"><div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Size</th><th>Created</th></tr></thead><tbody>{#each list as b (b.id)}<tr><td>{b.id}</td><td>{b.size}</td><td>{b.created}</td></tr>{:else}<tr><td colspan="3" class="opacity-60">No backups</td></tr>{/each}</tbody></table></div></div>
	{/if}
</div>
