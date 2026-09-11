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
  let query = $state(''); let scope = $state('project'); let layout = $state('hub');
  let selected: any = $state(null);
  let listOpen = $state(false);
  let detailOpen = $state(false);
  onMount(() => nodesStore.load());
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const q = query.trim();
    void nodesStore.searchMode;
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length >= 2) {
      searchTimer = setTimeout(() => { nodesStore.search(q, { mode: nodesStore.searchMode }); }, 250);
    } else if (q.length === 0) {
      if (nodesStore.query) { nodesStore.query = ''; nodesStore.clearFilters(); nodesStore.load(); }
    }
    return () => { if (searchTimer) clearTimeout(searchTimer); };
  });
  function onSelect(n:any){ selected=n; detailOpen=true; Logger.debug('[detail] select', n.label); }
</script>

<div class="space-y-2">
  <VisualizeFilters bind:query bind:scope bind:layout>
    <span class="badge preset-tonal text-[10px]">{nodesStore.filtered.length} / {nodesStore.nodes.length}</span>
    <button class="btn btn-sm preset-tonal h-7 text-xs" onclick={()=> listOpen=true}>List ({nodesStore.filtered.length})</button>
  </VisualizeFilters>
  <div class="relative">
    <VisualizeCanvas nodes={nodesStore.filtered} layout={layout} onSelect={onSelect} statusLabel="{$t('app.title')} · {layout} · {scope}{nodesStore.loading ? ' · loading' : ''}" />
    <VisualizeLegend overlay={true} />
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
