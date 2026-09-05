<script lang="ts">
  import { t } from 'svelte-i18n';
  import TelemetryChart from '$lib/components/TelemetryChart.svelte';
</script>
<h1>{$t('nav.settings')}</h1>
<p>Config UI — mirrors /api/system/health.</p>
<TelemetryChart />
