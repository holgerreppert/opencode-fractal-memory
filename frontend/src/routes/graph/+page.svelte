<script lang="ts">
  import { t } from 'svelte-i18n';
  import GraphCanvas from '$lib/components/GraphCanvas.svelte';
</script>
<h1>{$t('nav.graph')}</h1>
<GraphCanvas />
