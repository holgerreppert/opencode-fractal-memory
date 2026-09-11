<script lang="ts">
	import { onMount } from 'svelte';
	import { Logger } from '$lib/api/logger';
	import { SceneController } from '$lib/visualize/SceneController';
import { NodeFilterEngine } from '$lib/visualize/NodeFilterEngine';
import { hubSubgraph } from '$lib/visualize/hub-utils';
let { nodes = [], layout = 'hub', onSelect, statusLabel = '' } = $props<{ nodes?: any[]; layout?: string; onSelect?: (n:any)=>void; statusLabel?: string }>();
	let isFullscreen = $state(false);
	let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
	let containerEl: HTMLDivElement | undefined = $state(undefined);
	let mounted = $state(false);
	let hoverLabel = $state<string | null>(null);
	let ctrl: SceneController | undefined;
	let filter = new NodeFilterEngine();
	let tipEl: HTMLDivElement | undefined = $state(undefined);


	$effect(() => {
		void nodes.length; void layout;
		if (ctrl) {
			const data = layout === 'hub' ? hubSubgraph(nodes) : nodes;
			Logger.debug('[visualize] OOP rebuild', nodes.length, layout, layout==='hub' ? `hub-only ${data.length}` : '');
			ctrl.buildFromData(data, layout);
		}
	});

	onMount(() => {
		mounted = true;
		Logger.debug('[visualize] mount OOP', { nodes: nodes.length });
		if (!canvasEl) return;
		ctrl = new SceneController(canvasEl);
		(window as any).showDetail = (n: any) => onSelect?.(n);
		if (tipEl) (ctrl as any).tooltipEl = tipEl;
		const data = layout === 'hub' ? hubSubgraph(nodes) : nodes;
		ctrl.buildFromData(data, layout);
		let ro: ResizeObserver | null = null;
		if (containerEl && typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(() => ctrl?.resize());
			ro.observe(containerEl);
		}
		return () => {
			ro?.disconnect();
			ctrl?.dispose();
		};
	});

	function onMove(e: MouseEvent) { hoverLabel = e.shiftKey ? 'shift' : `${nodes.length} nodes · ${layout}`; }
	async function toggleFullscreen() {
		try {
			if (!document.fullscreenElement) { await containerEl?.requestFullscreen(); isFullscreen = true; }
			else { await document.exitFullscreen(); isFullscreen = false; }
			setTimeout(()=> ctrl?.resize(), 150);
		} catch (e) { Logger.warn('[canvas] fullscreen failed', e); }
	}
	$effect(() => {
		function onFsChange(){ isFullscreen = !!document.fullscreenElement; setTimeout(()=> ctrl?.resize(), 100); }
		document.addEventListener('fullscreenchange', onFsChange);
		return () => document.removeEventListener('fullscreenchange', onFsChange);
	});
	// no handleClick — exact parity with app.js: SceneController owns click via _onClick → window.showDetail
	// (removing the old x→idx fallback that selected random nodes on drag)
</script>

<div bind:this={containerEl} class="card preset-outlined-surface-200 overflow-hidden relative {isFullscreen ? 'border-0 rounded-none' : ''}">
	<canvas bind:this={canvasEl} class="block w-full {isFullscreen ? 'h-[100vh]' : 'h-[560px]'} bg-surface-900" onmousemove={onMove}></canvas>
	{#if !mounted}
		<div class="absolute inset-0 grid place-items-center bg-surface-900 text-white/70">Loading Three…</div>
	{/if}
	<div class="absolute top-2 left-2 flex gap-1 pointer-events-auto">
		<button class="btn btn-sm bg-surface-800/80 backdrop-blur border border-white/10 text-white text-[10px] h-6 px-2" onclick={toggleFullscreen} title="Fullscreen">{isFullscreen ? '✕ Exit fullscreen' : '⛶ Fullscreen'}</button>
	</div>
	<div class="absolute bottom-2 left-2 right-2 flex justify-between items-center pointer-events-none gap-2">
		<span class="badge preset-tonal text-[10px] px-1.5">{layout==='hub' ? hubSubgraph(nodes).length : nodes.length} · {layout}</span>
		<span class="text-[10px] text-white/60 hidden sm:inline truncate">{statusLabel || (hoverLabel ?? 'Svelte 5 • Skeleton • Three r185')}</span>
	</div>
</div>
<div bind:this={tipEl} class="fixed hidden bg-surface-900 text-white text-xs p-2 rounded shadow z-50 pointer-events-none"></div>
