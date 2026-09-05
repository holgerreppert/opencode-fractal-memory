<script lang="ts">
  import { t } from 'svelte-i18n';
  let query = $state('');
  // centralized api via lib/api/accessapi.ts — no direct fetch here
</script>

<h1>{$t('nav.memory')}</h1>
<p>Search memories via api.search (mirrors /api/nodes). Placeholder for NodeList + filter.</p>
<input bind:value={query} placeholder="auth flow" />
