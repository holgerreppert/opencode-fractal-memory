<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { api } from '$lib/api/accessapi';
	import DotModal from './DotModal.svelte';
	let { node = null, onClose } = $props<{ node: any | null; onClose: ()=>void }>();
	let editing = $state(false); let draft = $state('');
	let dotOpen = $state(false);
	$effect(()=> { if(node){ draft = node.content ?? ''; editing=false; Logger.debug('[detail] open', node.label); } });
	async function verify(){ if(!node) return; await fetch(`http://127.0.0.1:8787/api/nodes/${node.id}/verify`, {method:'POST'}); Logger.success('[detail] verify', node.id); }
	async function del(){ if(!node) return; if(!confirm('Delete?')) return; await fetch(`http://127.0.0.1:8787/api/nodes/${node.id}`, {method:'DELETE'}); Logger.warn('[detail] delete', node.id); onClose(); }
		async function save(){ if(!node) return; await fetch(`http://127.0.0.1:8787/api/nodes/${node.id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({content: draft})}); Logger.success('[detail] saved', node.id); node.content=draft; editing=false; }

</script>
{#if node}
<div class="card preset-filled-surface-100 h-[560px] flex flex-col overflow-hidden rounded-xl border shadow-sm">
	<div class="p-3 border-b bg-gradient-to-r from-primary-500/10 to-transparent flex justify-between items-center"><span class="font-bold truncate tracking-tight">{node.label}</span><button class="btn btn-sm preset-tonal rounded-full" onclick={onClose}>✕</button></div>
	<div class="p-4 space-y-3 overflow-auto flex-1 text-sm">
		<div class="flex gap-2 text-xs"><span class="badge preset-filled-primary-500 rounded-full">{node.type}</span><span class="badge preset-tonal rounded-full">L{node.level}</span><span class="badge preset-tonal rounded-full">imp {node.importance}</span><span class="badge preset-tonal rounded-full">{node.domain ?? 'general'}</span></div>
		{#if editing}<textarea class="textarea h-[300px] font-mono text-xs rounded-xl" bind:value={draft}></textarea><div class="flex gap-2"><button class="btn btn-sm preset-filled-primary-500 rounded-full" onclick={save}>Save</button><button class="btn btn-sm preset-tonal rounded-full" onclick={()=> editing=false}>Cancel</button></div>{:else}<pre class="whitespace-pre-wrap break-words bg-surface-900 text-surface-50 p-4 rounded-xl text-xs max-h-[380px] overflow-auto leading-relaxed shadow-inner">{node.content}</pre>{/if}
		<div class="flex gap-2 pt-2 border-t border-surface-200"><button class="btn btn-sm preset-tonal rounded-full" onclick={()=> editing=!editing}>{editing?'View':'Edit'}</button><button class="btn btn-sm preset-tonal rounded-full" onclick={verify}>Verify</button><button class="btn btn-sm preset-filled-error-500 rounded-full" onclick={del}>Delete</button></div>
		{#if node.type==='dot'}
			<button class="btn btn-sm preset-filled-secondary-500 rounded-full w-full mt-2" onclick={()=> dotOpen=true}>◈ Open Diagram (modal)</button>
			<DotModal bind:open={dotOpen} dotContent={node.content} title={node.label} />
		{/if}
	</div>
</div>
{:else}<div class="card preset-filled-surface-100 h-[560px] grid place-items-center opacity-60 text-sm">Click a node → content here like original #detail-panel</div>{/if}
