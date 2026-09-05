<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/accessapi';
  let metrics = $state<unknown>(null);
  let err = $state<string|null>(null);
  onMount(async () => {
    try { metrics = await api.telemetry(); } catch(e){ err = String(e); }
  });
</script>

{#if err}<p style="color:red">{err}</p>
{:else if metrics}<pre>{JSON.stringify(metrics,null,2)}</pre>
{:else}<p>Loading telemetry…</p>{/if}
