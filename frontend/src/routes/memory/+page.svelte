<script lang="ts">
  import { t } from 'svelte-i18n';
  import NodeFilter from '$lib/components/NodeFilter.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
</script>

<div class="space-y-4">
  <div class="card p-4">
    <h3 class="h3">{$t('nav.memory')}</h3>
    <NodeFilter />
    <NodeList />
  </div>
</div>
