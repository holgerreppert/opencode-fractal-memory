<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { fetchJson } from '$lib/api/accessapi';
	import DotModal from './DotModal.svelte';
	let { node = null, onClose } = $props<{ node: any | null; onClose: () => void }>();
	let editing = $state(false);
	let draft = $state('');
	let dotOpen = $state(false);
	$effect(() => {
		if (node) {
			draft = node.content ?? '';
			editing = false;
			Logger.debug('[detail] open', node.label);
		}
	});
	async function verify() {
		if (!node) return;
		try {
			await fetchJson(`/api/nodes/${node.id}/verify`, { method: 'POST' });
			Logger.success('[detail] verify', node.id);
		} catch (e) { Logger.error('[detail] verify failed', String(e)); }
	}
	async function del() {
		if (!node) return;
		if (!confirm('Delete?')) return;
		try {
			await fetchJson(`/api/nodes/${node.id}`, { method: 'DELETE' });
			Logger.warn('[detail] delete', node.id);
			onClose();
		} catch (e) { Logger.error('[detail] delete failed', String(e)); }
	}
	async function save() {
		if (!node) return;
		try {
			await fetchJson(`/api/nodes/${node.id}`, { method: 'PUT', body: JSON.stringify({ content: draft }) });
			Logger.success('[detail] saved', node.id);
			node.content = draft;
			editing = false;
		} catch (e) { Logger.error('[detail] save failed', String(e)); }
	}

</script>
{#if node}
<div class="card preset-filled-surface-100 h-[560px] flex flex-col overflow-hidden rounded-xl border shadow-sm">
	<div class="p-3 border-b bg-gradient-to-r from-primary-500/10 to-transparent flex justify-between items-center"><span class="font-bold truncate tracking-tight">{node.label}</span><button class="btn btn-sm preset-tonal rounded-full" onclick={onClose}>✕</button></div>
	<div class="p-4 space-y-3 overflow-auto flex-1 text-sm">
		<div class="flex gap-2 text-xs"><span class="badge preset-filled-primary-500 rounded-full">{node.type}</span><span class="badge preset-tonal rounded-full">L{node.level}</span><span class="badge preset-tonal rounded-full">imp {node.importance}</span><span class="badge preset-tonal rounded-full">{node.domain ?? 'general'}</span></div>
		<!-- actions on top — no scroll needed; ◈ as first content element (not header) -->
		<div class="flex gap-2 flex-wrap py-1"><button class="btn btn-sm preset-tonal rounded-full" onclick={()=> editing=!editing}>{editing?'View':'Edit'}</button><button class="btn btn-sm preset-tonal rounded-full" onclick={verify}>Verify</button><button class="btn btn-sm preset-filled-error-500 rounded-full" onclick={del}>Delete</button></div>
		{#if node.type==='dot'}
			<button class="btn btn-sm preset-filled-secondary-500 rounded-full w-full" onclick={()=> dotOpen=true}>◈ Open Diagram</button>
			<DotModal bind:open={dotOpen} dotContent={node.content} title={node.label} />
		{/if}
		{#if node.summary}<div class="bg-primary-500/10 border border-primary-500/30 rounded-xl p-3"><div class="text-xs font-bold text-primary-600 uppercase tracking-wide">Summary (BM25 1×)</div><div class="text-xs leading-relaxed mt-1">{node.summary}</div></div>{/if}
		{#if node.keywords}<div class="bg-secondary-500/10 border border-secondary-500/30 rounded-xl p-3"><div class="text-xs font-bold text-secondary-600 uppercase tracking-wide">Keywords (BM25 ×2)</div><div class="text-xs font-mono mt-1 break-words">{node.keywords}</div></div>{/if}
		{#if node.parentIds?.length}<div class="bg-surface-200/60 border rounded-xl p-3"><div class="text-xs font-bold uppercase tracking-wide text-surface-500">Position — parent_ids vector (fine-grained)</div><div class="text-xs font-mono mt-1 break-words">{node.parentIds.join(' → ')}</div></div>{/if}
		{#if node.tags?.length}<div class="flex gap-1 flex-wrap text-xs">{#each node.tags as t}<span class="chip preset-tonal rounded-full text-[10px]">{t}</span>{/each}</div>{/if}
		{#if editing}<textarea class="textarea h-[300px] font-mono text-xs rounded-xl" bind:value={draft}></textarea><div class="flex gap-2"><button class="btn btn-sm preset-filled-primary-500 rounded-full" onclick={save}>Save</button><button class="btn btn-sm preset-tonal rounded-full" onclick={()=> editing=false}>Cancel</button></div>{:else}<pre class="whitespace-pre-wrap break-words bg-surface-900 text-surface-50 p-4 rounded-xl text-xs max-h-[380px] overflow-auto leading-relaxed shadow-inner">{node.content}</pre>{/if}
	</div>
</div>
{:else}<div class="card preset-filled-surface-100 h-[560px] grid place-items-center text-surface-500 text-sm">Click a node → content here like original #detail-panel</div>{/if}
