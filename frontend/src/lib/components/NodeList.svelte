<script lang="ts">
  import { nodesStore } from '$lib/stores/nodes.svelte';
  import { onMount } from 'svelte';
  onMount(() => nodesStore.load());
</script>

{#if nodesStore.loading}<p>Loading…</p>
{:else if nodesStore.error}<p style="color:red">{nodesStore.error}</p>
{:else}
  <ul>
    {#each nodesStore.filtered as n (n.id)}
      <li><a href={`/memory/${encodeURIComponent(n.label)}`}>{n.label}</a> — {n.type ?? ''}</li>
    {/each}
  </ul>
{/if}
