<script lang="ts">
  import { nodesStore } from '$lib/stores/nodes.svelte';
  let q = $state('');
  function onSearch() { nodesStore.search(q); }
</script>

<div class="flex gap-2">
  <input bind:value={q} class="input text-sm flex-1" placeholder="Search memories" />
  <button class="btn btn-sm preset-tonal" onclick={onSearch}>Search</button>
  <button class="btn btn-sm preset-tonal" onclick={() => { q=''; nodesStore.load(); }}>Clear</button>
</div>
