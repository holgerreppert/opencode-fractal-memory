<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/accessapi';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import TelemetryChart from '$lib/components/TelemetryChart.svelte';

	let config: any = $state({
		adaptivePressure: {}, autoRetrieve: { excludeTypes: [] }, autoInjection: {}, autoLessons: {}, autoCapture: {}, autoDistill: {},
		ollama: {}, llmCompression: {}, embeddings: { chunking: {} }, commandCompression: {},
		graph: {}, ranking: { featureWeights: {}, gate: {}, rerank: {}, recency: {} },
		injectionVisibility: {}, contextCompression: {}, outputTokenControl: {}, reReadElimination: {},
		outputOffloading: {}, toolDedup: {}, errorPruning: {}, journal: {}, management: {}, sessionLog: {},
		autoDiscover: {}, autoConsolidate: {}, predictiveRating: {}, smallModel: {}
	});
	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');
	let rawJson = $state('');
	let accordionValue = $state(['memory']);

	onMount(async () => {
		try {
			const raw = await api.config();
			// defensive: ensure nested objects exist for Skeleton Accordion bindings (Immutable 33 crash)
			raw.adaptivePressure ??= {};
			raw.autoRetrieve ??= { excludeTypes: [] };
			raw.autoInjection ??= {};
			raw.autoLessons ??= {};
			raw.autoCapture ??= {};
			raw.ollama ??= {};
			raw.llmCompression ??= {};
			raw.embeddings ??= { chunking: {} };
			raw.embeddings.chunking ??= {};
			raw.commandCompression ??= {};
			raw.graph ??= {};
			raw.ranking ??= { featureWeights: {}, gate: {}, rerank: {}, recency: {} };
			raw.ranking.featureWeights ??= {};
			raw.ranking.gate ??= {};
			raw.ranking.rerank ??= {};
			raw.ranking.recency ??= {};
			raw.injectionVisibility ??= {};
			raw.contextCompression ??= {};
			raw.outputTokenControl ??= {};
			raw.reReadElimination ??= {};
			raw.outputOffloading ??= {};
			raw.toolDedup ??= {};
			raw.errorPruning ??= {};
			raw.journal ??= {};
			raw.management ??= {};
			raw.sessionLog ??= {};
			raw.autoDiscover ??= {};
			raw.autoConsolidate ??= {};
			raw.predictiveRating ??= {};
			raw.autoDistill ??= {};
			raw.smallModel ??= {};
			config = raw;
			rawJson = JSON.stringify(raw, null, 2);
		} catch (e) { error = String(e); }
	});

	async function handleSave() {
		saving = true; saved = false; error = '';
		try {
			try { const parsed = JSON.parse(rawJson); config = { ...config, ...parsed }; } catch (_e) { /* ignore: rawJson not valid JSON until edited */ }
			await api.configSave(config);
			saved = true;
			rawJson = JSON.stringify(config, null, 2);
			setTimeout(() => saved = false, 3000);
		} catch (e) { error = String(e); } finally { saving = false; }
	}
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center gap-3">
		<div><h3 class="h3">Settings</h3><p class="text-sm opacity-70">All {Object.keys(config).length} top-level keys from <code>opencode-mem.json</code> · <code>config.ts:7</code> — Skeleton Accordion</p></div>
		<button class="btn btn-sm preset-filled-primary-500" onclick={handleSave} disabled={saving}>{saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}</button>
	</div>
	{#if error}<div class="card preset-filled-error-500 p-4 text-sm text-surface-50">{error}</div>{/if}

	<Accordion value={accordionValue} onValueChange={(e) => (accordionValue = e.value)} multiple>
		<Accordion.Item value="memory" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Memory & Storage</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">Default TTL (days)</span><input type="number" class="input" bind:value={config.defaultTtlDays}></label>
					<label class="label"><span class="label-text">Log Level</span><select class="input" bind:value={config.logLevel}><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select></label>
					<label class="label"><span class="label-text">Cache Size (nodes)</span><input type="number" class="input" bind:value={config.cacheSize}></label>
					<label class="label"><span class="label-text">Cache TTL (hours)</span><input type="number" class="input" bind:value={config.cacheTTLHours}></label>
					<label class="label"><span class="label-text">Max Inject Tokens</span><input type="number" class="input" bind:value={config.maxInjectionTokens}></label>
					<label class="label"><span class="label-text">Core Inject Tokens</span><input type="number" class="input" bind:value={config.coreInjectionTokens}></label>
					<label class="label"><span class="label-text">Auto-Compress Threshold</span><input type="number" step="0.05" class="input" bind:value={config.autoCompressThreshold}></label>
					<label class="label"><span class="label-text">High / Critical Threshold</span><div class="flex gap-1"><input type="number" step="0.05" class="input" bind:value={config.highContextThreshold}><input type="number" step="0.05" class="input" bind:value={config.criticalContextThreshold}></div></label>
					<label class="label"><span class="label-text">Middle-Term Capture</span><select class="input" bind:value={config.enableMiddleTermCapture}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="adaptive" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Adaptive Pressure</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
					<label class="label"><span class="label-text">Enabled</span><select class="input" bind:value={config.adaptivePressure.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Warn</span><input type="number" step="0.05" class="input" bind:value={config.adaptivePressure.warnThreshold}></label>
					<label class="label"><span class="label-text">Aggressive</span><input type="number" step="0.05" class="input" bind:value={config.adaptivePressure.aggressiveThreshold}></label>
					<label class="label"><span class="label-text">Critical</span><input type="number" step="0.05" class="input" bind:value={config.adaptivePressure.criticalThreshold}></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="injection" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Auto-Retrieve & Injection</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0 space-y-3">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">AR Enabled</span><select class="input" bind:value={config.autoRetrieve.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Candidate Count</span><input type="number" class="input" bind:value={config.autoRetrieve.candidateCount}></label>
					<label class="label"><span class="label-text">Max Inject Nodes</span><input type="number" class="input" bind:value={config.autoRetrieve.maxInjectNodes}></label>
					<label class="label"><span class="label-text">Max Inject Playbooks</span><input type="number" class="input" bind:value={config.autoRetrieve.maxInjectPlaybooks}></label>
					<label class="label"><span class="label-text">Min Query Length</span><input type="number" class="input" bind:value={config.autoRetrieve.minQueryLength}></label>
					<label class="label"><span class="label-text">Cooldown ms</span><input type="number" class="input" bind:value={config.autoRetrieve.injectionCooldownMs}></label>
					<label class="label"><span class="label-text">Min Injection Score</span><input type="number" step="0.05" class="input" bind:value={config.autoRetrieve.minInjectionScore}></label>
					<label class="label"><span class="label-text">LLM Judge</span><select class="input" bind:value={config.autoRetrieve.llmJudgeEnabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Exclude Types</span><input type="text" class="input" value={config.autoRetrieve.excludeTypes?.join(',')} oninput={(e)=> config.autoRetrieve.excludeTypes = (e.target as HTMLInputElement).value.split(',').map(s=>s.trim()).filter(Boolean)}></label>
				</div>
				<div class="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-surface-200">
					<label class="label"><span class="label-text">Auto-Injection Enabled</span><select class="input" bind:value={config.autoInjection.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Inject On</span><select class="input" bind:value={config.autoInjection.injectOn}><option value="first">first</option><option value="always">always</option></select></label>
					<label class="label"><span class="label-text">Max Results</span><input type="number" class="input" bind:value={config.autoInjection.maxResults}></label>
					<label class="label"><span class="label-text">Max Tokens</span><input type="number" class="input" bind:value={config.autoInjection.maxTokens}></label>
				</div>
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">Auto-Lessons Enabled</span><select class="input" bind:value={config.autoLessons.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Min Failures</span><input type="number" class="input" bind:value={config.autoLessons.minFailures}></label>
					<label class="label"><span class="label-text">Use LLM</span><select class="input" bind:value={config.autoLessons.useLlm}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Auto-Capture Enabled</span><select class="input" bind:value={config.autoCapture.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Min Edits</span><input type="number" class="input" bind:value={config.autoCapture.minEdits}></label>
					<label class="label"><span class="label-text">Max/Session</span><input type="number" class="input" bind:value={config.autoCapture.maxPerSession}></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="ai" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">AI — Ollama / Embeddings / LLM Compression</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
					<label class="label"><span class="label-text">Ollama Enabled</span><select class="input" bind:value={config.ollama.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Model</span><input type="text" class="input" bind:value={config.ollama.model}></label>
					<label class="label"><span class="label-text">Base URL</span><input type="text" class="input" bind:value={config.ollama.baseUrl}></label>
					<label class="label"><span class="label-text">Mode / Strategy</span><div class="flex gap-1"><select class="input" bind:value={config.ollama.mode}><option value="binary">binary</option><option value="score">score</option></select><select class="input" bind:value={config.ollama.strategy}><option value="llm">llm</option><option value="cross-encoder">cross-encoder</option></select></div></label>
					<label class="label"><span class="label-text">LLM Compression</span><select class="input" bind:value={config.llmCompression.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Max Summary Tokens</span><input type="number" class="input" bind:value={config.llmCompression.maxSummaryTokens}></label>
					<label class="label"><span class="label-text">Embed Chunking</span><select class="input" bind:value={config.embeddings.chunking.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Max Segments</span><input type="number" class="input" bind:value={config.embeddings.chunking.maxSegments}></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="command" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Command Compression</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">Enabled</span><select class="input" bind:value={config.commandCompression.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Max Lines</span><input type="number" class="input" bind:value={config.commandCompression.maxLines}></label>
					<label class="label"><span class="label-text">NetWin Min Tokens</span><input type="number" class="input" bind:value={config.commandCompression.netWinMinTokens}></label>
					<label class="label"><span class="label-text">Verbatim Below</span><input type="number" class="input" bind:value={config.commandCompression.verbatimBelowLines}></label>
					<label class="label"><span class="label-text">Benign / Error Thr</span><div class="flex gap-1"><input type="number" class="input" bind:value={config.commandCompression.benignThreshold}><input type="number" class="input" bind:value={config.commandCompression.errorThreshold}></div></label>
					<label class="label"><span class="label-text">Fuzzy Dedup</span><select class="input" bind:value={config.commandCompression.fuzzyDedupEnabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Delta Compression</span><select class="input" bind:value={config.commandCompression.deltaCompressionEnabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Structural Shape</span><select class="input" bind:value={config.commandCompression.structuralShapeDetection}><option value={true}>On</option><option value={false}>Off</option></select></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="graph" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Code Graph & Ranking</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
					<label class="label"><span class="label-text">Graph Enabled</span><select class="input" bind:value={config.graph.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
					<label class="label"><span class="label-text">Max Files</span><input type="number" class="input" bind:value={config.graph.maxFiles}></label>
					<label class="label"><span class="label-text">Auto-Skeletonize</span><input type="number" class="input" bind:value={config.graph.autoSkeletonizeMinLines}></label>
					<label class="label"><span class="label-text">Ranking Rerank</span><select class="input" bind:value={config.ranking.rerank.mode}><option value="keyword">keyword</option><option value="cross-encoder">cross-encoder</option><option value="off">off</option></select></label>
					<label class="label"><span class="label-text">Semantic / BM25 / Quality</span><div class="flex gap-1"><input type="number" step="0.05" class="input" bind:value={config.ranking.featureWeights.semantic}><input type="number" step="0.05" class="input" bind:value={config.ranking.featureWeights.bm25}><input type="number" step="0.05" class="input" bind:value={config.ranking.featureWeights.quality}></div></label>
					<label class="label"><span class="label-text">Gate Min Score</span><input type="number" step="0.05" class="input" bind:value={config.ranking.gate.minScore}></label>
					<label class="label"><span class="label-text">Recency Half-Life (h)</span><input type="number" class="input" bind:value={config.ranking.recency.halfLifeHours}></label>
					<label class="label"><span class="label-text">Injection Visibility</span><select class="input" bind:value={config.injectionVisibility.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="context" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Context & Output</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">Context Compression</span><select class="input" bind:value={config.contextCompression.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Max Hist Nodes</span><input type="number" class="input" bind:value={config.contextCompression.maxHistoryNodesPerSession}></label>
					<label class="label"><span class="label-text">Nudge Threshold</span><input type="number" step="0.05" class="input" bind:value={config.contextCompression.nudgePressureThreshold}></label>
					<label class="label"><span class="label-text">Output Token Control</span><select class="input" bind:value={config.outputTokenControl.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">OTC Mode</span><select class="input" bind:value={config.outputTokenControl.mode}><option value="off">off</option><option value="always-on">always-on</option><option value="adaptive">adaptive</option></select></label>
					<label class="label"><span class="label-text">Max Sentences</span><input type="number" class="input" bind:value={config.outputTokenControl.maxSentences}></label>
					<label class="label"><span class="label-text">Re-Read Elim.</span><select class="input" bind:value={config.reReadElimination.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Output Offloading Thr</span><input type="number" class="input" bind:value={config.outputOffloading.thresholdChars}></label>
					<label class="label"><span class="label-text">Tool Dedup</span><select class="input" bind:value={config.toolDedup.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
				</div>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="auto" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Automation & Sessions</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0">
				<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
					<label class="label"><span class="label-text">Journal Enabled</span><select class="input" bind:value={config.journal.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Management Server Enabled</span><select class="input" bind:value={config.management.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Management Port</span><input type="number" class="input" bind:value={config.management.port}></label>
					<label class="label"><span class="label-text">Session Logging</span><select class="input" bind:value={config.sessionLog.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Auto-Discover</span><select class="input" bind:value={config.autoDiscover.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Auto-Consolidate</span><select class="input" bind:value={config.autoConsolidate.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
					<label class="label"><span class="label-text">Predictive Rating</span><select class="input" bind:value={config.predictiveRating.enabled}><option value={true}>On</option><option value={false}>Off</option></select></label>
				</div>
				<p class="text-xs opacity-60">Logs session events to <code>~/.config/opencode/logs/sessionlog.log</code></p>
			</Accordion.ItemContent>
		</Accordion.Item>

		<Accordion.Item value="advanced" class="card preset-outlined-surface-200">
			<Accordion.ItemTrigger class="flex justify-between items-center w-full p-4 h-auto">
				<span class="h4 m-0">Advanced — Full JSON</span><Accordion.ItemIndicator class="group text-surface-500"><span class="inline-block transition group-data-[state=open]:rotate-180">▸</span></Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent class="p-4 pt-0 space-y-2">
				<p class="text-xs opacity-60">All 30 top-level keys — edit anything (smallModel, perTool, squeezExtraction, etc.). Save merges JSON over the form above.</p>
				<textarea class="textarea font-mono text-xs h-[360px]" bind:value={rawJson}></textarea>
			</Accordion.ItemContent>
		</Accordion.Item>
	</Accordion>

	<TelemetryChart />
</div>
