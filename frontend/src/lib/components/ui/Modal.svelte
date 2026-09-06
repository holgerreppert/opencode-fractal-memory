<script lang="ts">
	import { Logger } from '$lib/api/logger';
	let { open = $bindable(false), title, children, onClose } = $props<{ open: boolean; title?: string; children?: any; onClose?: ()=>void }>();
	let w = $state(900); let h = $state(700); let isFull = $state(false);
	let dragging = $state(false); let startX = 0; let startY = 0; let startW = 0; let startH = 0;
	function close(){ open=false; onClose?.(); Logger.debug('[modal] close', title); }
	$effect(()=> { if(open) Logger.debug('[modal] open', title); });
	function onPointerDown(e: PointerEvent){ dragging=true; startX=e.clientX; startY=e.clientY; startW=w; startH=h; (e.target as Element).setPointerCapture(e.pointerId); }
	function onPointerMove(e: PointerEvent){ if(!dragging) return; w=Math.max(360, Math.min(window.innerWidth*0.95, startW + (e.clientX-startX))); h=Math.max(360, Math.min(window.innerHeight*0.95, startH + (e.clientY-startY))); }
	function onPointerUp(e: PointerEvent){ dragging=false; try{(e.target as Element).releasePointerCapture(e.pointerId);}catch{} }
</script>
{#if open}
<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<button class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick={close} aria-label="close"></button>
	<div class="relative card preset-filled-surface-100 flex flex-col shadow-2xl overflow-hidden rounded-2xl border border-surface-200 {isFull ? 'inset-0 !w-screen !h-screen !max-w-none !max-h-none rounded-none' : ''}" style="{isFull ? '' : `width:${w}px;height:${h}px;min-width:360px;min-height:360px;` } background: radial-gradient(circle at top, rgba(255,255,255,0.8), transparent 60%), var(--color-surface-100);">
		<div class="flex justify-between items-center p-4 border-b bg-surface-50/70 backdrop-blur gap-2"><h2 class="h4 truncate tracking-tight flex-1">{title ?? ''}</h2>
			<button class="btn btn-sm preset-tonal rounded-full" onclick={()=> isFull=!isFull} title="Fullscreen">{isFull ? '🗗' : '⛶'}</button>
			<button class="btn btn-sm preset-tonal rounded-full" onclick={close}>✕</button>
		</div>
		<div class="overflow-auto flex-1 p-2 md:p-4 bg-white/60 dark:bg-surface-900/40">{@render children?.()}</div>
		{#if !isFull}<button class="absolute bottom-1 right-1 w-8 h-8 cursor-nwse-resize opacity-50 hover:opacity-100 text-xs grid place-items-center select-none bg-surface-200 rounded" onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} title="Drag to resize x/y">◢</button>{/if}
	</div>
</div>
{/if}
