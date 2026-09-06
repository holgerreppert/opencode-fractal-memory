<script lang="ts">
  import { onMount } from 'svelte';
  let canvas = $state<HTMLCanvasElement|null>(null);
  let ready = $state(false);
  // Lazy Three.js + viz-global.js dot rendering — port of management/public/glb-loader.js + viz-global.js
  onMount(async () => {
    ready = true;
    // placeholder: init SceneController when graph lib available
    // const viz = await import('$lib/vendor/viz-global.js'); // Viz.instance()
  });
</script>

<canvas bind:this={canvas} class="w-full h-[400px] border"></canvas>
{#if !ready}<p>Loading graph…</p>{:else}<p>GraphCanvas ready — will render DOT via Viz.instance() + Three.js brain mesh when wired.</p>{/if}
