<script lang="ts">
  import { nodesStore } from '$lib/stores/nodes.svelte';
  import { Progress } from '@skeletonlabs/skeleton-svelte';
  import { onMount } from 'svelte';
  onMount(() => nodesStore.load());
</script>

{#if nodesStore.loading}<Progress value={null} />
{:else if nodesStore.error}<p class="text-error-500 card p-4 preset-filled-error-100">{nodesStore.error}</p>
{:else}
  <div class="table-wrap">
  <table class="table">
    <thead><tr><th>Label</th><th>Type</th></tr></thead>
    <tbody>
    {#each nodesStore.filtered as n (n.id)}
      <tr><td><a class="anchor" href={`/memory/${encodeURIComponent(n.label)}`}>{n.label}</a></td><td><span class="badge preset-filled-secondary-500">{n.type ?? ''}</span></td></tr>
    {/each}
    </tbody>
  </table>
  </div>
{/if}
