<script lang="ts">
	import { Logger } from '$lib/api/logger';
	import { onMount, onDestroy } from 'svelte';
	const BASE = 'http://127.0.0.1:8787';
	let filter = $state('');
	let data: any = $state({ turns: [], toolCalls: [], injections: [], compressions: [], session: {}, tokenHistory: {} });
	let entries: any[] = $state([]);
	let status = $state('');
	let loading = $state(true);
	let pollTimer: any;
	function escHtml(s: any) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
	function fmtDuration(ms: number) { const s = Math.floor(ms / 1000); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`; const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
	async function poll() {
		try {
			const r = await fetch(`${BASE}/api/live`);
			if (!r.ok) { loading = false; return; }
			const j = await r.json();
			if (j.error) { loading = false; return; }
			data = j;
		const t = j.turns ?? [], tc = j.toolCalls ?? [], inj = j.injections ?? [], comp = j.compressions ?? [], intents = j.intents ?? [];
		const all: any[] = [];
		for (const x of intents) {
			const ts = x.timestamp ?? 0; const turn = x.turn ?? '?'; const text = x.raw_text ?? ''; const sess = (x.session_id ?? '').slice(-4);
			all.push({ ts, text: `[intent] T${turn} ${text}`, kind: 'intent', tsFmt: new Date(ts).toLocaleTimeString(), turn, content: text, sess });
		}
			for (const x of t) {
				const ts = x.timestamp; const role = x.role ?? 'unknown'; const content = (x.content ?? '').slice(0, 500);
				all.push({ ts, text: `[turn] ${role.toUpperCase()}: ${content}`, kind: 'turn', tsFmt: new Date(ts).toLocaleTimeString(), role, content });
			}
			for (const x of tc) {
				const ts = x.timestamp ?? x.ts ?? 0; const name = x.tool_name ?? '?'; const args = x.args_json ? JSON.stringify(x.args_json).slice(0, 120) : ''; const preview = (x.output_preview ?? '').slice(0, 200); const ok = x.success ? '✓' : x.success === 0 ? '✗' : '→';
				all.push({ ts, text: `[tool] ${ok} ${name} ${args}`, kind: 'tool', tsFmt: new Date(ts).toLocaleTimeString(), name, args, preview, ok });
			}
			for (const x of inj) {
				const ts = x.timestamp ?? 0; const mode = x.injection_mode ?? '?'; const strat = x.rerank_strategy ?? '?'; const nodes = x.injected_node_count ?? '?'; const toks = (x.injected_tokens ?? 0).toLocaleString();
				let contentHtml = ''; let rawContent = x.injected_content;
				if (typeof rawContent === 'string') { try { rawContent = JSON.parse(rawContent); } catch { rawContent = null; } }
				if (Array.isArray(rawContent) && rawContent.length > 0) {
					contentHtml = rawContent.map((entry: any) => {
						const label = entry.label ?? 'unknown'; const snippet = (entry.snippet ?? '').slice(0, 400);
						return `<div class="my-1 px-2 rounded" style="background:var(--color-secondary-500);border-left:3px solid var(--color-secondary-400);"><div style="color:var(--color-secondary-100);font-weight:600;font-size:12px;">${escHtml(label)} <span style="color:var(--color-surface-200);font-weight:400;">[${escHtml(entry.type ?? '')}]</span></div><div style="color:var(--color-surface-100);font-size:12px;white-space:pre-wrap;word-break:break-word;">${escHtml(snippet)}${entry.snippet && entry.snippet.length > 300 ? '…' : ''}</div></div>`;
					}).join('');
				}
				all.push({ ts, text: `[inj] ${mode} / ${strat} / ${nodes}n / ${toks}t`, kind: 'inj', tsFmt: new Date(ts).toLocaleTimeString(), mode, strat, nodes, toks, contentHtml });
			}
			for (const x of comp) {
				const ts = x.timestamp ?? 0; const cmd = x.cmd_preview || x.command || '?'; const strat = x.strategy ?? '?'; const savings = x.savings_ratio ? Math.round((1 - x.savings_ratio) * 100) : 0; const orig = (x.original_chars ?? 0).toLocaleString(); const compr = (x.compressed_chars ?? 0).toLocaleString();
				all.push({ ts, text: `[comp] ${cmd} / ${strat} / ${orig}→${compr} (-${savings}%)`, kind: 'comp', tsFmt: new Date(ts).toLocaleTimeString(), cmd, strat, savings, orig, compr });
			}
			all.sort((a: any, b: any) => a.ts - b.ts);
			entries = all;
			status = `${t.length} turns · ${tc.length} tools · ${inj.length} injections · ${comp.length} compressions · ${intents.length} intents`;
		} catch (e) { console.error('[live] poll failed', e); }
		finally { loading = false; }
	}
	onMount(() => { Logger.debug('[live] mount'); poll(); pollTimer = setInterval(poll, 2000); return () => clearInterval(pollTimer); });
	onDestroy(() => clearInterval(pollTimer));
	let filtered = $derived(filter ? entries.filter((e: any) => e.text.toLowerCase().includes(filter.toLowerCase())) : entries);
	let sess = $derived(data.session ?? {});
	let tHist = $derived(data.tokenHistory ?? {});
	let totals = $derived({ input: tHist.totalInputTokens ?? 0, output: tHist.totalOutputTokens ?? 0, reasoning: tHist.totalReasoningTokens ?? 0 });
	let turns = $derived(data.turns ?? []);
	let lastTurn = $derived(turns.length > 0 ? turns[0] : null);
</script>
<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center gap-3">
		<div><h3 class="h3">Live Agent Feed</h3><p class="text-sm opacity-80">Real-time conversation feed. Polls every 2s. Shows last 100 turns.</p></div>
		<span class="badge preset-tonal text-xs">{status || '… polling'}</span>
	</div>
	{#if loading}
		<div class="card p-6 text-sm opacity-80">Loading live feed…</div>
	{:else}
		<div class="flex flex-col lg:flex-row gap-3" style="height:calc(100vh - 160px);">
			<div class="flex-[2] flex flex-col min-h-[400px]">
				<div class="flex gap-2 mb-2 shrink-0">
					<input class="input text-sm flex-1" id="live-filter-input" placeholder="Filter feed…" bind:value={filter} />
					<span id="live-feed-status" class="text-xs opacity-80 leading-8 shrink-0">{status}</span>
				</div>
				<div id="live-feed" class="flex-1 overflow-y-auto font-mono text-sm leading-6 bg-surface-50 dark:bg-surface-900 rounded-lg p-3 space-y-1" style="white-space:pre-wrap;">
					{#each filtered as e, i (e.ts + '|' + e.kind + '|' + e.text + '|' + i)}
						{#if e.kind === 'intent'}
							<div class="py-1 px-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800"><span class="opacity-90">{e.tsFmt}</span> <span style="color:var(--color-tertiary-400);font-weight:600;">INTENT</span> <span class="opacity-70">T{e.turn}</span> <span class="opacity-100 whitespace-pre-wrap break-words">{escHtml(e.content)}</span></div>
						{:else if e.kind === 'turn'}
							<div class="py-1 px-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800" style="color:var(--color-primary-400);"><span class="opacity-90">{e.tsFmt}</span> <strong>{e.role.toUpperCase()}</strong> <span class="opacity-100 whitespace-pre-wrap break-words">{escHtml(e.content)}</span></div>
						{:else if e.kind === 'tool'}
							<div class="py-1 px-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800"><span class="opacity-90">{e.tsFmt}</span> <strong style="color:{e.ok === '✓' ? 'var(--color-success-400)' : e.ok === '✗' ? 'var(--color-error-400)' : 'var(--color-warning-400)'};">{e.ok} {escHtml(e.name)}</strong> <span class="opacity-90">{escHtml(e.args)}</span> <span style="color:var(--color-surface-300);">{escHtml(e.preview)}</span></div>
						{:else if e.kind === 'inj'}
							<div class="py-1 px-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800"><span class="opacity-90">{e.tsFmt}</span> <span style="color:var(--color-secondary-400);font-weight:600;">INJECT</span> {escHtml(e.mode)} / {escHtml(e.strat)} / {e.nodes}n / {e.toks}t{@html e.contentHtml}</div>
						{:else if e.kind === 'comp'}
							<div class="py-1 px-1 rounded hover:bg-surface-100 dark:hover:bg-surface-800"><span class="opacity-90">{e.tsFmt}</span> <span style="color:var(--color-warning-400);font-weight:600;">COMPRESS</span> {escHtml(e.cmd)} / {escHtml(e.strat)} / {e.orig}→{e.compr} <span style="color:var(--color-success-400);">-{e.savings}%</span></div>
						{/if}
					{:else}
						<div class="text-center py-8 opacity-70 text-sm">No live data yet</div>
					{/each}
				</div>
			</div>
			<div class="flex-1 flex flex-col min-h-[280px]">
				<h4 class="text-xs font-bold opacity-90 uppercase mb-2 shrink-0 ml-1">Context</h4>
				<div id="live-context" class="flex-1 overflow-y-auto font-mono text-xs leading-5 bg-surface-50 dark:bg-surface-900 rounded-lg p-3 space-y-1">
					<div class="ctx-row"><span class="ctx-label">Session</span><span class="ctx-value">{escHtml(sess.session_id ?? '—')}</span></div>
					<div class="ctx-row"><span class="ctx-label">Status</span><span class="ctx-value">{escHtml(sess.status ?? '—')}</span></div>
					<div class="ctx-row"><span class="ctx-label">Uptime</span><span class="ctx-value">{sess.started_at ? fmtDuration(Date.now() - sess.started_at) : '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">Tool Calls</span><span class="ctx-value">{sess.total_tool_calls ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">File Reads</span><span class="ctx-value">{sess.file_reads ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">File Edits</span><span class="ctx-value">{sess.file_edits ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">Bash Commands</span><span class="ctx-value">{sess.bash_commands ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">Memory Tools</span><span class="ctx-value">{sess.memory_tools ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">Injections</span><span class="ctx-value">{sess.injection_count ?? '—'}</span></div>
					<div class="ctx-row"><span class="ctx-label">Injected Tokens</span><span class="ctx-value">{(sess.injected_tokens ?? 0).toLocaleString()}</span></div>
					<div class="border-t border-surface-200 dark:border-surface-700 pt-2 mt-2">
						<div class="ctx-row"><span class="ctx-label">Total Input Tokens</span><span class="ctx-value">{totals.input.toLocaleString()}</span></div>
						<div class="ctx-row"><span class="ctx-label">Total Output Tokens</span><span class="ctx-value">{totals.output.toLocaleString()}</span></div>
						<div class="ctx-row"><span class="ctx-label">Total Reasoning</span><span class="ctx-value">{totals.reasoning.toLocaleString()}</span></div>
					</div>
					<div class="border-t border-surface-200 dark:border-surface-700 pt-2 mt-2">
						<div class="ctx-row"><span class="ctx-label">Last Turn</span><span class="ctx-value">{lastTurn ? new Date(lastTurn.timestamp).toLocaleTimeString() : '—'}</span></div>
						<div class="ctx-row"><span class="ctx-label">Last Role</span><span class="ctx-value">{lastTurn ? lastTurn.role : '—'}</span></div>
						<div class="ctx-row"><span class="ctx-label">Conversation Turns</span><span class="ctx-value">{turns.length}</span></div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
