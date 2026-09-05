<script lang="ts">
  import { t } from 'svelte-i18n';
  import NodeFilter from '$lib/components/NodeFilter.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
</script>

<h1>{$t('nav.memory')}</h1>
<NodeFilter />
<NodeList />
