<script lang="ts">
	import { t } from 'svelte-i18n';
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	const BASE = 'http://127.0.0.1:8787';
	let dashboard: any = $state(null);
	let compress: any = $state(null);
	let tokens: any = $state(null);
	let injection: any = $state(null);
	let pressure: any = $state(null);
	let archive: any = $state(null);
	let live: any = $state(null);
	let embeddings: any = $state(null);
	let loading = $state(true);
	let error = $state('');
	let showRaw = $state(false);
	async function jget(path:string){ const r=await fetch(`${BASE}${path}`); if(!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); }
	onMount(async () => {
		try {
			const [d,c,t,i,p,a,l,e] = await Promise.all([
				jget('/api/context-dashboard').catch(()=>null),
				jget('/api/compress-stats?days=30&limit=20').catch(()=>null),
				jget('/api/token-history?days=30&limit=100').catch(()=>null),
				jget('/api/injection-quality?limit=100').catch(()=>null),
				jget('/api/context-pressure?days=30&limit=500').catch(()=>null),
				jget('/api/context-archive').catch(()=>null),
				jget('/api/live').catch(()=>null),
				jget('/api/embeddings-status').catch(()=>null),
			]);
			dashboard=d; compress=c; tokens=t; injection=i; pressure=p; archive=a; live=l; embeddings=e;
			Logger.debug('[context] loaded 8787 parity', { d, c, t, i, p, a });
		} catch(e:any){ error=String(e?.message??e); Logger.warn('[context] load failed', e); }
		finally { loading=false; }
	});
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center">
		<div><h3 class="h3">{$t('nav.context') ?? 'Context'}</h3><p class="text-sm opacity-70">What fills the LLM window — memory + injections + compression + embeddings (mirrors :8787 Context Dashboard)</p></div>
		<label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={showRaw} /> raw JSON</label>
	</div>
	{#if loading}<div class="card p-6 text-sm opacity-70">Loading…</div>{/if}
	{#if error}<pre class="card preset-outlined-surface-200 p-4 text-xs text-error-500 whitespace-pre-wrap">{error}</pre>{/if}

	<!-- Context Dashboard — memory + overhead + embeddings -->
	{#if dashboard}
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">Context Dashboard</h4>
			<p class="text-sm opacity-70 mb-3">Breakdown of what occupies the LLM context window. Conversation tokens estimated from compression chars /4. Use <code>context(mode="total_tokens")</code> for live turn data.</p>
			<div class="grid md:grid-cols-2 gap-3 text-xs">
				<div class="space-y-1">
					<div class="flex justify-between border-b border-surface-200 dark:border-surface-700 py-1"><span class="opacity-70">Memory nodes</span><span>{dashboard.memory?.totalNodes ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Memory tokens</span><span>{dashboard.memory?.totalTokens?.toLocaleString?.() ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Active rules</span><span>{dashboard.memory?.rules ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Compression calls</span><span>{dashboard.compression?.totalCalls ?? compress?.total?.calls ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Compression saved</span><span>{dashboard.compression?.savingsPercent != null ? `${dashboard.compression.savingsPercent}%` : compress?.total?.savingsPercent != null ? `${Math.round(compress.total.savingsPercent)}%` : '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Total injections</span><span>{dashboard.injectionAggregate?.total ?? dashboard.injections?.length ?? injection?.metrics?.length ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Avg nodes/inj</span><span>{dashboard.injectionAggregate?.avgNodes ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Avg tokens/inj</span><span>{dashboard.injectionAggregate?.avgTokens?.toLocaleString?.() ?? '—'}</span></div>
					<div class="flex justify-between border-b py-1"><span class="opacity-70">Est. conversation tokens</span><span>{dashboard.compression ? Math.round((dashboard.compression.originalChars ?? 0)/4).toLocaleString() : '—'}</span></div>
				</div>
				<div class="space-y-1">
					{#if embeddings}
						<div class="text-[11px] font-bold opacity-80">Embedding engine</div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Runtime</span><span class="preset-tonal badge text-[10px]">{embeddings.runtime ?? '—'}</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Backend</span><span>{embeddings.backend ?? '—'}</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Optimization</span><span>{embeddings.graphOptimizationLevel ?? '—'}</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Threads</span><span>auto ({embeddings.intraOpNumThreads ?? '—'})</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Model</span><span class="text-[11px]">{embeddings.model ?? '—'}</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Dimensions</span><span>{embeddings.dimensions ?? '—'}</span></div>
						<div class="flex justify-between border-b py-1"><span class="opacity-70">Cross-encoder</span><span class="text-[10px]">{embeddings.crossEncoderModel ?? '—'}</span></div>
					{/if}
					<div class="flex justify-between border-t border-surface-300 dark:border-surface-700 pt-2 mt-2 font-bold"><span>Est. total in context</span><span>{dashboard.memory && dashboard.overhead ? (dashboard.memory.totalTokens + (dashboard.overhead.systemPromptTokens??0) + (dashboard.overhead.toolDefTokens??0) + Math.round((dashboard.compression?.originalChars??0)/4)).toLocaleString() : '—'} tokens</span></div>
					<div class="flex justify-between text-[11px] opacity-70"><span>System prompts</span><span>~{(dashboard.overhead?.systemPromptTokens ?? 0).toLocaleString()}</span></div>
					<div class="flex justify-between text-[11px] opacity-70"><span>Tool definitions</span><span>~{(dashboard.overhead?.toolDefTokens ?? 0).toLocaleString()}</span></div>
				</div>
			</div>
			{#if dashboard.memory?.byLevel?.length}
				<div class="mt-4">
					<h4 class="text-xs font-bold opacity-80 mb-1">Memory by level</h4>
					<table class="table table-sm w-full text-xs"><thead><tr class="opacity-70"><th class="text-left">Level</th><th class="text-right">Nodes</th><th class="text-right">Tokens</th></tr></thead><tbody>{#each dashboard.memory.byLevel as l}<tr class="border-b border-surface-200 dark:border-surface-700"><td>L{l.level}</td><td class="text-right">{l.count}</td><td class="text-right">{l.tokens.toLocaleString()}</td></tr>{/each}</tbody></table>
				</div>
			{/if}
			{#if dashboard.memory?.byType?.length}
				<div class="mt-3">
					<h4 class="text-xs font-bold opacity-80 mb-1">Memory by type</h4>
					<table class="table table-sm w-full text-xs"><thead><tr class="opacity-70"><th class="text-left">Type</th><th class="text-right">Nodes</th><th class="text-right">Tokens</th></tr></thead><tbody>{#each dashboard.memory.byType as t}<tr class="border-b"><td>{t.type}</td><td class="text-right">{t.count}</td><td class="text-right">{t.tokens.toLocaleString()}</td></tr>{/each}</tbody></table>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Pressure -->
	{#if pressure?.entries}
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">Context pressure — {pressure.entries.length} samples</h4>
			<p class="text-sm opacity-70 mb-2">Per-turn pressure recorded by context-compress hook (N% | N msg &gt;500 tok | archived N).</p>
			<div class="flex gap-4 text-xs">
				<span>Current: <b>{pressure.entries.at(-1)?.pressurePct ?? '—'}%</b></span>
				<span>Avg: <b>{Math.round(pressure.entries.reduce((s:any,e:any)=>s+(e.pressurePct??0),0)/pressure.entries.length)}%</b></span>
				<span class="opacity-70">{new Date(pressure.entries.at(-1)?.timestamp ?? '').toLocaleString()}</span>
			</div>
			<div class="overflow-auto mt-2"><table class="table table-sm w-full text-xs"><thead><tr class="opacity-70"><th>When</th><th>Pressure</th><th>Tokens</th></tr></thead><tbody>{#each pressure.entries.slice(-15) as e}<tr class="border-b"><td class="font-mono text-[11px]">{(e.timestamp ?? e.createdAt ?? '').slice(0,19).replace('T',' ')}</td><td>{e.pressurePct ?? e.pressure ?? '—'}%</td><td>{e.totalTokens ?? '—'}</td></tr>{/each}</tbody></table></div>
		</div>
	{/if}

	<!-- Archive registry -->
	{#if archive}
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">Archived context — {archive.totalIndexes ?? 0} indexes / {archive.totalChains ?? 0} history nodes</h4>
			<p class="text-sm opacity-70 mb-2">Every <code>archivecontext</code> batch — fetch via <code>memory(mode="fetch", label="contexthistory:index:&lt;sessionId&gt;")</code>.</p>
			<div class="overflow-auto"><table class="table table-sm w-full text-[11px]"><thead><tr class="opacity-70"><th>Ref</th><th>Status</th><th>Topic</th><th>Description</th><th>Node label</th></tr></thead><tbody>{#each (archive.entries ?? []).slice(0,50) as e}<tr class="border-b"><td class="font-mono text-[10px]">{e.ref ?? '—'}</td><td>{e.status ?? 'archived'}</td><td>{e.topic ?? '—'}</td><td class="max-w-[260px] truncate">{(e.summary ?? e.description ?? '').slice(0,120)}</td><td class="font-mono text-[10px]">{e.label ?? '—'}</td></tr>{/each}</tbody></table></div>
		</div>
	{/if}

	<!-- Compression -->
	{#if compress}
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">Compression — {compress.total?.calls ?? 0} calls · {compress.total?.savingsPercent != null ? Math.round(compress.total.savingsPercent) : '—'}% saved</h4>
			<div class="flex gap-4 text-xs mb-2"><span>{((compress.total?.originalChars ?? 0)/1000).toFixed(0)}K → {((compress.total?.compressedChars ?? 0)/1000).toFixed(0)}K</span><span class="opacity-70">avg {compress.total?.calls ? Math.round(((compress.total.originalChars - compress.total.compressedChars)/compress.total.calls)).toLocaleString() : '—'}/call</span></div>
			{#if compress.byStrategy?.length}
				<table class="table table-sm w-full text-[11px] mb-3"><thead><tr class="opacity-70"><th>Strategy</th><th class="text-right">Calls</th><th class="text-right">Raw K</th><th class="text-right">Comp K</th><th class="text-right">Saved</th></tr></thead><tbody>{#each compress.byStrategy as s}<tr class="border-b"><td class="text-primary-500">{s.strategy}</td><td class="text-right">{s.calls}</td><td class="text-right">{(s.raw/1000).toFixed(0)}</td><td class="text-right">{(s.comp/1000).toFixed(0)}</td><td class="text-right">{s.raw?Math.round((1-s.comp/s.raw)*100):0}%</td></tr>{/each}</tbody></table>
			{/if}
			{#if compress.recent?.length}
				<h4 class="text-xs font-bold opacity-80">Recent compressions</h4>
				<table class="table table-sm w-full text-[11px]"><thead><tr class="opacity-70"><th>When</th><th>Strategy</th><th class="text-right">Before</th><th class="text-right">After</th><th class="text-right">Saved</th></tr></thead><tbody>{#each compress.recent.slice(0,10) as r}<tr class="border-b"><td>{new Date(r.timestamp).toLocaleTimeString()}</td><td class="text-primary-500">{r.strategy}</td><td class="text-right font-mono">{(r.originalChars/1000).toFixed(1)}K</td><td class="text-right font-mono">{(r.compressedChars/1000).toFixed(1)}K</td><td class="text-right">{Math.round(r.savingsRatio*100)}%</td></tr>{/each}</tbody></table>
			{/if}
		</div>
	{/if}

	<!-- Token history -->
	{#if tokens}
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4">Token history — {tokens.totalTurns ?? tokens.recentTurns?.length ?? '—'} turns · {tokens.totalSessions ?? '—'} sessions</h4>
			<div class="grid md:grid-cols-4 gap-2 text-xs mb-3">
				<span>In: <b>{(tokens.totalInputTokens ?? 0).toLocaleString()}</b></span><span>Out: <b>{(tokens.totalOutputTokens ?? 0).toLocaleString()}</b></span><span>Rsn: <b>{(tokens.totalReasoningTokens ?? 0).toLocaleString()}</b></span><span class="text-warning-500">Cost: <b>${(tokens.totalCost ?? 0).toFixed(4)}</b></span>
			</div>
			{#if tokens.bySession?.length}
				<table class="table table-sm w-full text-[11px] mb-3"><thead><tr class="opacity-70"><th>Session</th><th class="text-right">Turns</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Cost</th></tr></thead><tbody>{#each tokens.bySession as s}<tr class="border-b"><td class="font-mono text-[10px]">{s.sessionId.slice(0,8)}</td><td class="text-right">{s.turns}</td><td class="text-right">{s.inputTokens.toLocaleString()}</td><td class="text-right">{s.outputTokens.toLocaleString()}</td><td class="text-right">{s.cost.toFixed(4)}</td></tr>{/each}</tbody></table>
			{/if}
			{#if tokens.recentTurns?.length}
				<h4 class="text-xs font-bold opacity-80">Recent turns</h4>
				<table class="table table-sm w-full text-[11px]"><thead><tr class="opacity-70"><th>When</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Cost</th><th>Model</th></tr></thead><tbody>{#each tokens.recentTurns.slice(0,10) as t}<tr class="border-b"><td>{new Date(t.timestamp).toLocaleTimeString()}</td><td class="text-right">{t.inputTokens.toLocaleString()}</td><td class="text-right">{t.outputTokens.toLocaleString()}</td><td class="text-right">{t.cost?.toFixed(4) ?? '—'}</td><td class="text-[10px]">{(t.model ?? '').split('/').pop() ?? '—'}</td></tr>{/each}</tbody></table>
			{/if}
		</div>
	{/if}

	<!-- Live -->
	{#if live}
		<div class="grid md:grid-cols-2 gap-4">
			<div class="card preset-outlined-surface-200 p-4 space-y-3"><h4 class="h4">Live injections — {live.injections?.length ?? live.entries?.length ?? '—'}</h4><div class="text-xs opacity-70 font-mono max-h-[200px] overflow-auto">{JSON.stringify(live.injections ?? live.entries ?? live, null, 2).slice(0,1200)}</div></div>
			<div class="card preset-outlined-surface-200 p-4 space-y-3"><h4 class="h4">Live compressions — {live.compressions?.length ?? '—'}</h4><div class="text-xs opacity-70 font-mono max-h-[200px] overflow-auto">{JSON.stringify(live.compressions ?? '', null, 2).slice(0,1200)}</div></div>
		</div>
	{/if}

	{#if showRaw}
		<details open class="card preset-outlined-surface-200 p-4"><summary class="h4 cursor-pointer">Raw JSON</summary><pre class="text-xs overflow-auto max-h-[400px] mt-2">{JSON.stringify({dashboard, compress, tokens, pressure, archive, injection, live, embeddings}, null, 2)}</pre></details>
	{/if}
</div>
