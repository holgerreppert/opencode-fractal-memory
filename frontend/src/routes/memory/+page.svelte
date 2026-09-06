<script lang="ts">
  import { t } from 'svelte-i18n';
  import NodeFilter from '$lib/components/NodeFilter.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
</script>

<div class="space-y-4 card p-4">
<h1 class="h3">{$t('nav.memory')}</h1>
<NodeFilter />
<NodeList />
</div>
