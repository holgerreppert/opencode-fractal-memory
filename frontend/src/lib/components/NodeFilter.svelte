<script lang="ts">
  import { nodesStore } from '$lib/stores/nodes.svelte';
  let q = $state('');
  function onSearch() { nodesStore.search(q); }
</script>

<input bind:value={q} placeholder="Search memories" />
<button onclick={onSearch}>Search</button>
<button onclick={() => { q=''; nodesStore.load(); }}>Clear</button>
