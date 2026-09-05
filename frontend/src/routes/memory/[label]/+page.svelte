<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api/accessapi';
  let node = $state<unknown>(null);
  let err = $state<string|null>(null);
  $effect(() => {
    const label = $page.params.label;
    if (label) api.getNode(decodeURIComponent(label)).then(r => node = r.node).catch(e => err = String(e));
  });
</script>

{#if err}<p style="color:red">{err}</p>
{:else if node}<pre>{JSON.stringify(node, null, 2)}</pre>
{:else}<p>Loading…</p>{/if}
