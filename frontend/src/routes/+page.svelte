<script lang="ts">
  import { t } from 'svelte-i18n';
  import VisualizeFilters from '$lib/components/visualize/VisualizeFilters.svelte';
  import VisualizeCanvas from '$lib/components/visualize/VisualizeCanvas.svelte';
  import VisualizeLegend from '$lib/components/visualize/VisualizeLegend.svelte';
  import NodeListPanel from '$lib/components/visualize/NodeListPanel.svelte';
  import DetailPanel from '$lib/components/visualize/DetailPanel.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { nodesStore } from '$lib/stores/nodes.svelte';
  import { Logger } from '$lib/api/logger';
  import { onMount } from 'svelte';
  let query = $state(''); let scope = $state('project'); let layout = $state('shell');
  let selected: any = $state(null);
  let listOpen = $state(false);
  let detailOpen = $state(false);
  onMount(() => nodesStore.load());
  $effect(() => {
    void query;
    const q = query.trim();
    if (q.length >= 2) {
      Logger.debug('[search] example or anything', q);
      nodesStore.search(q);
    } else if (q.length === 0) {
      nodesStore.load();
    }
  });
  function onSelect(n:any){ selected=n; detailOpen=true; Logger.debug('[detail] select', n.label); }
</script>

<div class="space-y-4">
  <VisualizeFilters bind:query bind:scope bind:layout>
    <span class="badge preset-tonal">{nodesStore.filtered.length} / {nodesStore.nodes.length}</span>
    <button class="btn btn-sm preset-tonal" onclick={()=> listOpen=true}>Show list ({nodesStore.filtered.length})</button>
  </VisualizeFilters>
  <VisualizeCanvas nodes={nodesStore.filtered} layout={layout} onSelect={onSelect} />
  <VisualizeLegend />
  <div class="card preset-filled-surface-100 p-3 text-xs opacity-70 flex gap-4">
    <span>{$t('app.title')} API {nodesStore.loading ? 'loading…' : 'ok'}</span>
    <span class="ml-auto">Layout: {layout} · Scope: {scope}</span>
  </div>
</div>

<Modal bind:open={listOpen} title="Results — {nodesStore.filtered.length} nodes">
  {#snippet children()}
    <NodeListPanel nodes={nodesStore.filtered} selectedId={selected?.id ?? null} onSelect={(n)=>{ onSelect(n); listOpen=false; }} />
  {/snippet}
</Modal>

<Modal bind:open={detailOpen} title={selected?.label ?? 'Detail'} onClose={()=> detailOpen=false}>
  {#snippet children()}
    {#key selected?.id}
      <DetailPanel node={selected} onClose={()=> detailOpen=false} />
    {/key}
  {/snippet}
</Modal>
