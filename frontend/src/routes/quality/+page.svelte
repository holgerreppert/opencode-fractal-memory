<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { onMount } from 'svelte';
	const BASE = 'http://127.0.0.1:8787';
	let metrics: any[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	let showRaw = $state(false);
	// derived aggregates
	let total = $derived(metrics.length);
	let withRerank = $derived(metrics.filter((m:any)=> m.rerankStrategy));
	let strategies = $derived([...new Set(withRerank.map((m:any)=> m.rerankStrategy).filter(Boolean))]);
	let allScores = $derived(metrics.flatMap((m:any)=> m.rerankScores ?? []));
	let avgScore = $derived(allScores.length ? (allScores.reduce((a:number,b:number)=>a+b,0)/allScores.length).toFixed(3) : '—');
	let totalReranked = $derived(withRerank.reduce((s:number,m:any)=> s + (m.preRerankIds?.length ?? m.injectedNodeCount ?? 0),0));
	let totalSelected = $derived(metrics.reduce((s:number,m:any)=> s + (m.injectedNodeCount ?? 0),0));
	let passRate = $derived(totalReranked ? ((totalSelected/totalReranked)*100).toFixed(1) : '—');
	let typeDist = $derived((()=>{ const d:Record<string,number>={}; for(const m of metrics) if(m.injectedNodeTypes) for(const [t,c] of Object.entries(m.injectedNodeTypes as Record<string,number>)) d[t]=(d[t]??0)+c; return Object.entries(d).sort((a,b)=>b[1]-a[1]); })());
	let stratCounts = $derived((()=>{ const c:Record<string,number>={}; for(const m of metrics){ const s=m.rerankStrategy||'none'; c[s]=(c[s]??0)+1;} return Object.entries(c).sort((a,b)=>b[1]-a[1]); })());
	let scoreBuckets = $derived((()=>{ const b:Record<string,number>={}; const SZ=0.1; for(const m of metrics) for(const s of (m.rerankScores??[])){ const k=Math.floor(s/SZ)*SZ; const key=`${k.toFixed(1)}–${(k+SZ).toFixed(1)}`; b[key]=(b[key]??0)+1;} return Object.entries(b).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])); })());
	let dayCounts = $derived((()=>{ const d:Record<string,number>={}; for(const m of metrics){ const k=new Date(m.timestamp).toLocaleDateString(); d[k]=(d[k]??0)+1;} return Object.entries(d).sort((a,b)=> +new Date(a[0]) - +new Date(b[0])); })());
	let stratAvgs = $derived((()=>{ const m:Record<string,number[]>={}; for(const x of metrics) if(x.rerankScores?.length){ const s=x.rerankStrategy||'none'; (m[s]??=[]).push(...x.rerankScores);} return Object.entries(m).map(([k,v])=>[k, v.reduce((a:number,b:number)=>a+b,0)/v.length] as const).sort((a,b)=>b[1]-a[1]); })());
	onMount(async () => {
		try {
			const r = await fetch(`${BASE}/api/injection-quality?limit=100`);
			if(!r.ok) throw new Error(`${r.status}`);
			const j = await r.json();
			metrics = j.metrics ?? j ?? [];
			Logger.debug('[quality] metrics', metrics.length);
		} catch(e:any){ error=String(e?.message??e); Logger.warn('[quality] failed', e); }
		finally { loading=false; }
	});
	function bar(p:number){ return `width:${Math.max(2,p*100)}%`; }
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center">
		<div><h3 class="h3">Quality — injection quality</h3><p class="text-sm opacity-70">Every auto-retrieval: reranker scores, pass rate, type mix &amp; strategy (mirrors :8787 Quality)</p></div>
		<label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={showRaw} /> raw JSON</label>
	</div>
	{#if loading}<div class="card p-6 text-sm opacity-70">Loading injection quality…</div>
	{:else if error}<div class="card variant-filled-error-500 p-4 text-sm text-surface-50">{error}</div>
	{:else if metrics.length===0}
		<div class="card preset-outlined-surface-200 p-8 text-center space-y-2">
			<div class="text-3xl">◎</div>
			<div class="h4">No injections yet</div>
			<p class="text-sm opacity-70">Auto-retrieve fires when you chat. Run a prompt ≥ <code>autoRetrieve.minQueryLength</code> chars and check <code>/api/injection-quality</code>.</p>
		</div>
	{:else}
		<!-- Summary -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="card preset-tonal p-4"><div class="text-xs opacity-70">Total injections</div><div class="h2">{total}</div><div class="text-[11px] opacity-70">{withRerank.length} with rerank · {strategies.join(', ')||'—'}</div></div>
			<div class="card preset-tonal p-4"><div class="text-xs opacity-70">Pass rate</div><div class="h2">{passRate}%</div><div class="text-[11px] opacity-70">{totalSelected} / {totalReranked || '—'} selected</div></div>
			<div class="card preset-tonal p-4"><div class="text-xs opacity-70">Avg rerank score</div><div class="h2">{avgScore}</div><div class="text-[11px] opacity-70">{allScores.length} scores</div></div>
			<div class="card preset-tonal p-4"><div class="text-xs opacity-70">Node types injected</div><div class="text-sm mt-1 flex flex-wrap gap-1">{#each typeDist.slice(0,6) as [t,c]}<span class="badge preset-filled-surface-200 text-[10px]">{t}:{c}</span>{/each}{#if typeDist.length===0}<span class="text-xs opacity-70">—</span>{/if}</div></div>
		</div>
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<div class="grid md:grid-cols-2 gap-4 text-xs">
				<div><div class="font-bold opacity-80 mb-1">By strategy</div>{#each stratCounts as [s,c]}<div class="flex justify-between border-b border-surface-200 dark:border-surface-700 py-1"><span class="badge preset-tonal text-[10px]">{s}</span><span>{c}</span></div>{/each}</div>
				<div><div class="font-bold opacity-80 mb-1">Top types</div>{#each typeDist.slice(0,8) as [t,c]}<div class="flex justify-between border-b py-1"><span>{t}</span><span class="badge preset-filled-primary-500 text-[10px]">{c}</span></div>{/each}</div>
			</div>
		</div>
		<!-- Charts — simple bar rows (no external deps, matches 8787 canvas bar/timeline) -->
		<div class="grid md:grid-cols-2 gap-4">
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5 mb-3">Rerank score distribution</h4>
				{#if scoreBuckets.length===0}<div class="text-xs opacity-70">No scores</div>
				{:else}
					<div class="space-y-1">
						{#each scoreBuckets as [k,c]}
							{@const max = Math.max(...scoreBuckets.map(([,v])=>v))}
							<div class="flex items-center gap-2 text-xs"><span class="w-[88px] font-mono text-[11px] opacity-80">{k}</span><div class="flex-1 h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden"><div class="h-full bg-primary-500 rounded-full" style={bar(c/max)}></div></div><span class="w-6 text-right text-[11px]">{c}</span></div>
						{/each}
					</div>
				{/if}
			</div>
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5 mb-3">Strategy avg score</h4>
				{#if stratAvgs.length===0}<div class="text-xs opacity-70">No rerank scores</div>
				{:else}
					<div class="space-y-1">
						{#each stratAvgs as [k,avg]}
							<div class="flex items-center gap-2 text-xs"><span class="w-[88px] badge preset-tonal text-[10px]">{k}</span><div class="flex-1 h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden"><div class="h-full bg-secondary-500 rounded-full" style={bar(avg)}></div></div><span class="w-10 text-right font-mono text-[11px]">{avg.toFixed(3)}</span></div>
						{/each}
					</div>
				{/if}
			</div>
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5 mb-3">Injection timeline</h4>
				{#if dayCounts.length===0}<div class="text-xs opacity-70">No days</div>
				{:else}
					<div class="space-y-1">
						{#each dayCounts as [d,c]}
							{@const max = Math.max(...dayCounts.map(([,v])=>v))}
							<div class="flex items-center gap-2 text-xs"><span class="w-[88px] text-[11px] opacity-80">{d}</span><div class="flex-1 h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden"><div class="h-full bg-tertiary-500 rounded-full" style={bar(c/max)}></div></div><span class="w-6 text-right text-[11px]">{c}</span></div>
						{/each}
					</div>
				{/if}
			</div>
			<div class="card preset-outlined-surface-200 p-4 space-y-3">
				<h4 class="h5 mb-3">Node types injected</h4>
				{#if typeDist.length===0}<div class="text-xs opacity-70">—</div>
				{:else}
					<div class="space-y-1">
						{#each typeDist as [t,c]}
							{@const max = Math.max(...typeDist.map(([,v])=>v))}
							<div class="flex items-center gap-2 text-xs"><span class="w-[88px] text-[11px]">{t}</span><div class="flex-1 h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden"><div class="h-full bg-success-500 rounded-full" style={bar(c/max)}></div></div><span class="w-6 text-right text-[11px]">{c}</span></div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<!-- Table -->
		<div class="card preset-outlined-surface-200 p-4 space-y-3">
			<h4 class="h4 mb-2">Recent injections — {metrics.length} (newest first)</h4>
			<div class="overflow-auto">
				<table class="table table-hover w-full text-xs">
					<thead><tr class="opacity-70"><th class="text-left p-2">Time</th><th class="text-left p-2">Strategy</th><th class="text-right p-2">Count</th><th class="text-right p-2">Scores</th><th class="text-right p-2">Duration</th><th class="text-left p-2">Types</th><th class="text-left p-2">Query</th></tr></thead>
					<tbody>
						{#each metrics.slice(0,50) as m}
							<tr class="hover:preset-tonal">
								<td class="p-2 font-mono text-[11px] opacity-80">{new Date(m.timestamp).toLocaleTimeString()}</td>
								<td class="p-2"><span class="badge preset-tonal text-[10px]">{m.rerankStrategy ?? 'none'}</span></td>
								<td class="p-2 text-right font-mono">{m.preRerankIds?.length ?? '?'} → {m.injectedNodeCount}</td>
								<td class="p-2 text-right font-mono text-[11px]">{m.rerankScores ? m.rerankScores.map((s:number)=>s.toFixed(2)).join(', ') : '—'}</td>
								<td class="p-2 text-right">{m.rerankDurationMs ? `${m.rerankDurationMs}ms` : '—'}</td>
								<td class="p-2 text-[11px]">{m.injectedNodeTypes ? Object.entries(m.injectedNodeTypes).map(([t,c])=>`${t}:${c}`).join(' ') : '—'}</td>
								<td class="p-2 text-[11px] opacity-70 max-w-[180px] truncate">{m.queryText ? m.queryText.slice(0,48) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
	{#if showRaw}
		<details open class="card preset-outlined-surface-200 p-4"><summary class="h4 cursor-pointer">Raw JSON</summary><pre class="text-xs overflow-auto max-h-[400px] mt-2">{JSON.stringify({metrics}, null, 2)}</pre></details>
	{/if}
</div>
