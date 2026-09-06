<script lang="ts">
	import { onMount } from 'svelte';
	import { Logger } from '$lib/api/logger';
	import { SceneController } from '$lib/visualize/SceneController';
	import { NodeFilterEngine } from '$lib/visualize/NodeFilterEngine';
	let { nodes = [], layout = 'shell', onSelect } = $props<{ nodes?: any[]; layout?: string; onSelect?: (n:any)=>void }>();
	let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
	let mounted = $state(false);
	let hoverLabel = $state<string | null>(null);
	let ctrl: SceneController | undefined;
	let filter = new NodeFilterEngine();

	$effect(() => {
		void nodes.length; void layout;
		if (ctrl) {
			Logger.debug('[visualize] OOP rebuild', nodes.length, layout);
			ctrl.buildFromData(nodes, layout);
		}
	});

	onMount(() => {
		mounted = true;
		Logger.debug('[visualize] mount OOP', { nodes: nodes.length });
		if (!canvasEl) return;
		ctrl = new SceneController(canvasEl);
		// bridge SceneController click → Svelte onSelect so brain+node both work via one path
		(window as any).showDetail = (n:any)=> onSelect?.(n);
		ctrl.buildFromData(nodes, layout);
		return () => ctrl?.dispose();
	});

	function onMove(e: MouseEvent) { hoverLabel = e.shiftKey ? 'shift' : `${nodes.length} nodes · ${layout}`; }
	// no handleClick — exact parity with app.js: SceneController owns click via _onClick → window.showDetail
	// (removing the old x→idx fallback that selected random nodes on drag)
</script>

<div class="card preset-outlined-surface-200 overflow-hidden relative">
	<canvas bind:this={canvasEl} class="block w-full h-[560px] bg-surface-900" onmousemove={onMove}></canvas>
	{#if !mounted}
		<div class="absolute inset-0 grid place-items-center bg-surface-900 text-white/70">Loading Three…</div>
	{/if}
	<div class="absolute bottom-3 left-3 right-3 flex justify-between items-center pointer-events-none">
		<span class="badge preset-tonal text-xs">{nodes.length} nodes · OOP {layout} · shapes/colors/sizes</span>
		<span class="text-xs opacity-60 hidden md:inline">{hoverLabel ?? 'Svelte 5 • Skeleton • Three r185 OOP'}</span>
	</div>
</div>
<div id="tooltip" class="fixed hidden bg-surface-900 text-white text-xs p-2 rounded shadow z-50 pointer-events-none"></div>
