<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { Logger } from '$lib/api/logger';
	let { open = $bindable(false), dotContent = '', title = 'Diagram' } = $props<{ open: boolean; dotContent: string; title?: string }>();
	let svg: string | null = $state(null); let loading = $state(false);
	let scale = $state(1); let offset = $state({ x: 0, y: 0 });
	let dragging = $state(false); let start = $state({ x: 0, y: 0, ox: 0, oy: 0 });
	let vizInstance: any = null;
	$effect(() => { if (open && dotContent) { scale = 1; offset = { x: 0, y: 0 }; render(); } });
	function onPointerDown(e: PointerEvent){ dragging=true; start={x:e.clientX, y:e.clientY, ox: offset.x, oy: offset.y}; (e.currentTarget as Element).setPointerCapture(e.pointerId); }
	function onPointerMove(e: PointerEvent){ if(!dragging) return; offset={ x: start.ox + (e.clientX-start.x), y: start.oy + (e.clientY-start.y)}; }
	function onPointerUp(e: PointerEvent){ dragging=false; try{(e.currentTarget as Element).releasePointerCapture(e.pointerId);}catch{} }

	function fixDotSyntax(src: string): string {
		let out = src;
		out = out.replace(/\["([^"]*?)"\]/g, '[label="$1"]');
		out = out.replace(/"([^"]*?)"/g, (_, inner: string) => '"' + inner.replace(/\n/g, '\\n') + '"');
		out = out.replace(/-->/g, '->');
		out = out.replace(/<--/g, '<-');
		out = out.replace(/(\w[\w.]*)\s*->\s*\|("[^"]*")\|\s*(\w[\w.]*)/g, '$1 -> $3 [label=$2]');
		out = out.replace(/(\w[\w.]*)\s*<-\s*\|("[^"]*")\|\s*(\w[\w.]*)/g, '$1 <- $3 [label=$2]');
		return out;
	}

	async function render() {
		if (!dotContent) return; loading = true; svg = null;
		try {
			if (!vizInstance) {
				const Viz = (window as any).Viz;
				if (!Viz) throw new Error('viz.js not loaded');
				vizInstance = await Viz.instance();
			}
			const fixed = fixDotSyntax(dotContent);
			svg = vizInstance.renderSVGElement(fixed).outerHTML;
			Logger.success('[dot-modal] rendered');
		} catch (e: any) { const msg = e?.message || e?.stack || JSON.stringify(e) || String(e); Logger.error('[dot-modal] failed', msg); svg = `<pre class="text-red-400">Render failed: ${msg}</pre>`; } finally { loading = false; }
	}
</script>
<Modal bind:open title={title ?? '◈ Diagram'}>{#snippet children()}
	{#if loading}<div class="p-8 grid place-items-center opacity-70">Rendering…</div>
	{:else if svg}
		<div class="flex gap-2 p-2 border-b bg-surface-50/70">
			<button class="btn btn-sm preset-tonal rounded-full" onclick={() => scale = Math.min(3, +(scale * 1.2).toFixed(2))}>＋ Zoom in</button>
			<button class="btn btn-sm preset-tonal rounded-full" onclick={() => scale = Math.max(0.2, +(scale / 1.2).toFixed(2))}>－ Zoom out</button>
			<button class="btn btn-sm preset-tonal rounded-full" onclick={() => { scale = 1; offset = { x: 0, y: 0 }; }}>Reset</button>
			<span class="ml-auto text-xs opacity-80">{Math.round(scale * 100)}%</span>
		</div>
		<div class="p-4 overflow-auto max-h-[60vh] bg-surface-900 rounded-xl border cursor-grab active:cursor-grabbing select-none" role="img" onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} onwheel={(e) => { e.preventDefault(); const f = e.deltaY > 0 ? 0.9 : 1.1; scale = Math.max(0.2, Math.min(3, +(scale * f).toFixed(2))); }}>{@html svg.replace('<svg', `<svg style="transform: translate(${offset.x}px, ${offset.y}px) scale(${scale}); transform-origin: center;"`)}</div>
	{:else}<pre class="p-4 text-xs whitespace-pre-wrap bg-surface-900 text-white rounded-xl">{dotContent}</pre>{/if}
{/snippet}</Modal>