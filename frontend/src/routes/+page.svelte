<script lang="ts">
  import { t } from 'svelte-i18n';
  import { api } from '$lib/api/accessapi';
  let health = $state<{ ok: boolean } | null>(null);
  let error = $state<string | null>(null);
  $effect(() => {
    api.health().then(r => health = r).catch(e => error = String(e));
  });
</script>

<h1>{$t('app.title')} — Dashboard</h1>
{#if error}<p style="color:red">{error}</p>{:else if health}<p>API {health.ok ? 'ok' : 'fail'} · <a href="/memory">{$t('nav.memory')}</a></p>{:else}<p>Loading…</p>{/if}
