<script lang="ts">
	import { onMount } from 'svelte';
	import { backupApi, formatSize, type BackupEntry, type BackupSourceInfo } from '$lib/api/backup';
	import { Logger } from '$lib/api/logger';

	let sources: BackupSourceInfo[] = $state([]);
	let backups: BackupEntry[] = $state([]);
	let loading = $state(false);
	let working = $state(false);
	let message = $state('');
	let msgType = $state<'info' | 'error' | 'success'>('info');

	// create form
	let selected = $state<Set<string>>(new Set());
	let label = $state('');

	// restore target (name of the backup whose sources will be restored)
	let restoreName = $state('');

	function setMsg(text: string, type: 'info' | 'error' | 'success' = 'info') {
		message = text;
		msgType = type;
	}

	async function load() {
		loading = true;
		try {
			const [s, b] = await Promise.all([backupApi.sources(), backupApi.list()]);
			sources = s;
			backups = b.backups ?? [];
		} catch (e) {
			Logger.warn('[backup] load failed', e);
			setMsg('Failed to load backups', 'error');
		} finally {
			loading = false;
		}
	}

	function toggleSource(key: string) {
		const next = new Set(selected);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selected = next;
	}

	function allKeys(): string[] {
		return sources.filter((s) => s.exists).map((s) => s.key);
	}

	async function create() {
		const keys = selected.size ? [...selected] : allKeys();
		if (keys.length === 0) return setMsg('No sources available to back up', 'error');
		working = true;
		try {
			const res = await backupApi.create(keys, label.trim() || undefined);
			if (!res.success) return setMsg(res.error ?? 'Backup failed', 'error');
			label = '';
			setMsg(`Backup ${res.backup?.name} created`, 'success');
			await load();
		} catch (e) {
			Logger.error('[backup] create failed', e);
			setMsg(e instanceof Error ? e.message : String(e), 'error');
		} finally {
			working = false;
		}
	}

	async function restore(name: string, keys: string[]) {
		if (keys.length === 0) return;
		working = true;
		setMsg(`Restoring ${name} …`);
		try {
			const res = await backupApi.restore(name, keys);
			if (!res.success) return setMsg(res.error ?? 'Restore failed', 'error');
			setMsg(`Restored ${name} (pre-restore snapshot: ${res.preRestoreBackup})`, 'success');
			await load();
		} catch (e) {
			Logger.error('[backup] restore failed', e);
			setMsg(e instanceof Error ? e.message : String(e), 'error');
		} finally {
			working = false;
		}
	}

	async function remove(name: string) {
		if (!confirm(`Delete backup ${name}?`)) return;
		working = true;
		try {
			const res = await backupApi.delete(name);
			if (!res.success) return setMsg(res.error ?? 'Delete failed', 'error');
			setMsg(`Deleted ${name}`, 'success');
			await load();
		} catch (e) {
			Logger.error('[backup] delete failed', e);
			setMsg(e instanceof Error ? e.message : String(e), 'error');
		} finally {
			working = false;
		}
	}

	function sourceKeys(b: BackupEntry): string[] {
		return Object.keys(b.sources);
	}

	function humanDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
	}

	onMount(load);
</script>

<div class="space-y-6">
	<!-- Create -->
	<div class="card preset-filled-surface-100 p-5 space-y-4">
		<div class="flex justify-between items-center">
			<h3 class="h3">Create backup</h3>
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={working}
				onclick={() => create()}
			>
				{working ? 'Working…' : 'Create backup'}
			</button>
		</div>

		<div>
			<p class="text-sm opacity-70 mb-2">Sources (whole directories) — unselected = back up all that exist</p>
			<div class="flex gap-2 flex-wrap">
				{#each sources as s (s.key)}
					<button
						class="chip {selected.has(s.key) ? 'preset-filled-primary-500 text-white' : 'preset-outlined-surface-200'}"
						disabled={!s.exists}
						onclick={() => toggleSource(s.key)}
						title={s.exists ? s.label : `${s.label} (not present)`}
					>
						{s.label}
					</button>
				{/each}
			</div>
		</div>

		<div>
			<label class="text-sm opacity-70" for="backup-label">Label (optional)</label>
			<input
				id="backup-label"
				class="input mt-1"
				placeholder="e.g. pre-migration"
				bind:value={label}
			/>
		</div>
	</div>

	<!-- Message -->
	{#if message}
		<div class="card p-3 text-sm {msgType === 'error' ? 'preset-filled-tertiary-500' : msgType === 'success' ? 'preset-filled-primary-500' : 'preset-outlined-surface-200'}">
			{message}
		</div>
	{/if}

	<!-- List -->
	<div class="card preset-outlined-surface-200 p-5 space-y-3">
		<h3 class="h3">Backups</h3>
		{#if loading}
			<p class="text-sm opacity-70">Loading…</p>
		{:else if backups.length === 0}
			<p class="opacity-70 text-sm">No backups</p>
		{:else}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Label</th>
							<th>Sources</th>
							<th>Size</th>
							<th>Created</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each backups as b (b.name)}
							<tr>
								<td class="font-mono text-xs">{b.name}</td>
								<td>{b.label ?? '—'}</td>
								<td>
									<span class="flex gap-1 flex-wrap">
										{#each sourceKeys(b) as k (k)}
											<span class="badge preset-tonal text-xs">{k}</span>
										{/each}
									</span>
								</td>
								<td>{formatSize(b.totalSize)}</td>
								<td>{humanDate(b.date)}</td>
								<td>
									<span class="flex gap-1">
										<button
											class="btn btn-sm preset-tonal"
											disabled={working}
											onclick={() => restore(b.name, sourceKeys(b))}
										>
											Restore
										</button>
										<button
											class="btn btn-sm preset-filled-tertiary-500"
											disabled={working}
											onclick={() => remove(b.name)}
										>
											Delete
										</button>
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
