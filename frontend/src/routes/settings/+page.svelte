<script lang="ts">
  import { t } from 'svelte-i18n';
  import TelemetryChart from '$lib/components/TelemetryChart.svelte';
</script>
<div class="card p-4 space-y-4">
<h1 class="h3">{$t('nav.settings')}</h1>
<p>Config UI — mirrors /api/system/health.</p>
<TelemetryChart />
</div>
