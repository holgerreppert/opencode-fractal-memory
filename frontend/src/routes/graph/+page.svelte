<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { GraphController } from '$lib/graph/GraphController';
  import { Logger } from '$lib/api/logger';
  import { api } from '$lib/api/accessapi';
  let container: HTMLElement | undefined = $state(undefined);
  let ctrl: GraphController | undefined;
  onMount(() => {
    if (!container) return;
    ctrl = new GraphController(container);
    (async () => {
      try { const data = await api.graph(''); ctrl!.build(data); Logger.debug('[graph] loaded'); } catch (e) { Logger.warn('[graph] failed', e); }
    })();
    return () => ctrl?.dispose();
  });
</script>
<div class="card p-4 space-y-4">
<h1 class="h3">{$t('nav.graph')}</h1>
<div bind:this={container} id="graph-viz-container" class="min-h-[400px] card preset-outlined-surface-200"></div>
</div>
