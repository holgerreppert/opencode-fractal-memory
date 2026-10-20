<script lang="ts">
	import { api } from '$lib/api/accessapi';
	import { onMount } from 'svelte';

	type StrategySwitch = { timestamp: number; from: string; to: string; scoreBefore?: number; scoreAfter: number };
	type QualityTrend = { timestamp: number; strategyId: string; score: number; queriesReplayed: number; sessionsReplayed: number };
	type BetaAdaptation = { timestamp: number; field: string; oldValue: number; newValue: number; reason: string };
	type ActiveStrategy = { strategyId: string; score: number; scoreHistory: number[]; queriesReplayed: number; sessionsReplayed: number; updatedAt: number };

	let active = $state<ActiveStrategy | null>(null);
	let trends = $state<QualityTrend[]>([]);
	let switches = $state<StrategySwitch[]>([]);
	let adaptations = $state<BetaAdaptation[]>([]);
	let loading = $state(true);
	let error = $state('');

	let strategyPerf = $derived((() => {
		const agg = new Map<string, { count: number; scoreSum: number; min: number; max: number }>();
		for (const t of trends) {
			const e = agg.get(t.strategyId) ?? { count: 0, scoreSum: 0, min: t.score, max: t.score };
			e.count++;
			e.scoreSum += t.score;
			e.min = Math.min(e.min, t.score);
			e.max = Math.max(e.max, t.score);
			agg.set(t.strategyId, e);
		}
		return [...agg.entries()]
			.map(([id, d]) => ({ id, avg: d.scoreSum / d.count, min: d.min, max: d.max, runs: d.count }))
			.sort((a, b) => b.avg - a.avg);
	})());

	function ago(ts: number) {
		const ms = Date.now() - ts;
		if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
		if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
		if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
		return `${Math.round(ms / 86400000)}d ago`;
	}

	function strategyColor(id: string) {
		if (id === 'cross-encoder') return 'preset-filled-success-500';
		if (id.startsWith('intent-')) return 'preset-filled-warning-500';
		return 'preset-filled-primary-500';
	}

	onMount(async () => {
		try {
			const data = await api.dreamRsi();
			active = data.activeStrategy;
			trends = data.history.trends;
			switches = data.history.switches;
			adaptations = data.history.adaptations;
		} catch (e: any) {
			error = String(e?.message ?? e);
		} finally {
			loading = false;
		}
	});
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4">
		<h3 class="h3">Dream-RSI &mdash; Recursive Self-Improvement</h3>
		<p class="text-sm opacity-70 mt-1">Strategy evolution, score trends, and adaptive parameters from the replay evaluator.</p>
	</div>

	{#if loading}
		<div class="card p-6 text-sm opacity-70">Loading Dream-RSI data&hellip;</div>
	{:else if error}
		<div class="card preset-tonal p-4 text-sm text-error-500">{error}</div>
	{:else if !active}
		<div class="card preset-outlined-surface-200 p-8 text-center space-y-2">
			<div class="text-3xl">&circ;</div>
			<div class="h4">No active strategy yet</div>
			<p class="text-sm opacity-70">Dream-RSI runs at session idle. Chat a bit and it will evaluate retrieval strategies automatically.</p>
		</div>
	{:else}
		<!-- Active strategy stats -->
		<div class="grid grid-cols-2 md:grid-cols-5 gap-3">
			<div class="card preset-tonal p-4">
				<div class="text-xs opacity-70">Active Strategy</div>
				<div class="h2 text-secondary-500">{active.strategyId}</div>
			</div>
			<div class="card preset-tonal p-4">
				<div class="text-xs opacity-70">Score</div>
				<div class="h2 text-success-500">{active.score.toFixed(3)}</div>
			</div>
			<div class="card preset-tonal p-4">
				<div class="text-xs opacity-70">Queries</div>
				<div class="h2">{active.queriesReplayed}</div>
			</div>
			<div class="card preset-tonal p-4">
				<div class="text-xs opacity-70">Sessions</div>
				<div class="h2">{active.sessionsReplayed}</div>
			</div>
			<div class="card preset-tonal p-4">
				<div class="text-xs opacity-70">Updated</div>
				<div class="text-sm mt-1 opacity-80">{ago(active.updatedAt)}</div>
			</div>
		</div>

		<!-- Score Trend SVG -->
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h5">Score Trend</h4>
			{#if trends.length === 0}
				<div class="text-xs opacity-70">No score data yet</div>
			{:else}
				{@const scores = trends.map(t => t.score)}
				{@const minS = Math.min(...scores, 0)}
				{@const maxS = Math.max(...scores, 1)}
				{@const range = maxS - minS || 1}
				{@const w = 700}
				{@const h = 180}
				{@const padL = 40}
				{@const padR = 20}
				{@const padT = 20}
				{@const padB = 30}
				{@const chartW = w - padL - padR}
				{@const chartH = h - padT - padB}
				{@const step = trends.length > 1 ? chartW / (trends.length - 1) : 0}
				<svg viewBox="0 0 {w} {h}" class="w-full" style="height:180px;">
					<line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" />
					<line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" />
					{#each scores as s, i}
						{@const x = padL + (trends.length > 1 ? i * step : chartW / 2)}
						{@const y = padT + chartH - ((s - minS) / range) * chartH}
						{#if i > 0}
							{@const prevX = padL + (i - 1) * step}
							{@const prevY = padT + chartH - ((scores[i - 1] - minS) / range) * chartH}
							<line x1={prevX} y1={prevY} x2={x} y2={y} stroke="#6af" stroke-width="2" />
						{/if}
						<circle cx={x} cy={y} r="4" class={trends[i].strategyId === 'cross-encoder' ? 'fill-success-500' : 'fill-primary-500'} />
					{/each}
					<text x={padL - 4} y={padT + 4} text-anchor="end" fill="#888" font-size="9">{maxS.toFixed(2)}</text>
					<text x={padL - 4} y={padT + chartH + 4} text-anchor="end" fill="#888" font-size="9">{minS.toFixed(2)}</text>
				</svg>
			{/if}
		</div>

		<!-- Two-column: Switches + Adaptations -->
		<div class="grid md:grid-cols-2 gap-4">
			<!-- Strategy Switches -->
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5">Strategy Switches</h4>
				{#if switches.length === 0}
					<div class="text-xs opacity-70">No switches recorded yet</div>
				{:else}
					<div class="space-y-2">
						{#each switches.slice(-10).reverse() as sw}
							<div class="flex items-center gap-2 text-xs border-b border-surface-200 dark:border-surface-700 pb-2">
								<span class="opacity-60 w-16 shrink-0">{ago(sw.timestamp)}</span>
								<span class="badge preset-tonal text-[10px]">{sw.from}</span>
								<span class="opacity-50">&rarr;</span>
								<span class="badge {strategyColor(sw.to)} text-[10px]">{sw.to}</span>
								{#if sw.scoreBefore !== undefined}
									<span class="opacity-60">{sw.scoreBefore.toFixed(3)} &rarr; {sw.scoreAfter.toFixed(3)}</span>
								{:else}
									<span class="opacity-60">{sw.scoreAfter.toFixed(3)}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Beta Adaptations -->
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5">Beta Adaptations</h4>
				{#if adaptations.length === 0}
					<div class="text-xs opacity-70">No adaptations recorded yet</div>
				{:else}
					<div class="space-y-2">
						{#each adaptations.slice(-10).reverse() as ad}
							<div class="flex items-center gap-2 text-xs border-b border-surface-200 dark:border-surface-700 pb-2">
								<span class="opacity-60 w-16 shrink-0">{ago(ad.timestamp)}</span>
								<span class="font-mono">{ad.field}</span>
								<span class="text-error-500">{ad.oldValue.toFixed(3)}</span>
								<span class="opacity-50">&rarr;</span>
								<span class="text-success-500">{ad.newValue.toFixed(3)}</span>
								<span class="badge preset-tonal text-[10px]">{ad.reason}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Strategy Performance Table -->
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h5">Strategy Performance</h4>
			{#if strategyPerf.length === 0}
				<div class="text-xs opacity-70">No strategies evaluated yet</div>
			{:else}
				<div class="overflow-auto">
					<table class="table table-hover w-full text-xs">
						<thead>
							<tr class="opacity-70">
								<th class="text-left p-2">Strategy</th>
								<th class="text-right p-2">Avg</th>
								<th class="text-right p-2">Min</th>
								<th class="text-right p-2">Max</th>
								<th class="text-right p-2">Runs</th>
							</tr>
						</thead>
						<tbody>
							{#each strategyPerf as s}
								<tr class="hover:preset-tonal {s.id === active.strategyId ? 'preset-tonal' : ''}">
									<td class="p-2">
										<span class="badge {strategyColor(s.id)} text-[10px]">{s.id}</span>
										{#if s.id === active.strategyId}<span class="text-success-500 ml-1">&starf;</span>{/if}
									</td>
									<td class="p-2 text-right font-mono">{s.avg.toFixed(3)}</td>
									<td class="p-2 text-right font-mono opacity-70">{s.min.toFixed(3)}</td>
									<td class="p-2 text-right font-mono opacity-70">{s.max.toFixed(3)}</td>
									<td class="p-2 text-right">{s.runs}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>
