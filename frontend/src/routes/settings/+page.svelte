<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/accessapi';
	import TelemetryChart from '$lib/components/TelemetryChart.svelte';

	let config = $state<Record<string, any>>({});
	let saving = $state(false);
	let saved = $state(false);
	let error = $state('');

	let ar = $state<Record<string, any>>({ enabled: false, candidateCount: 30, maxInjectNodes: 5, maxInjectPlaybooks: 3, minQueryLength: 10, injectionCooldownMs: 30000, llmJudgeEnabled: true });
	let ai = $state<Record<string, any>>({ enabled: false, injectOn: 'first', maxResults: 3, maxTokens: 2000, minScore: 0.5 });
	let al = $state<Record<string, any>>({ enabled: true, minFailures: 2, useLlm: false });
	let ac = $state<Record<string, any>>({ enabled: true, minEdits: 1, useLlm: false, maxPerSession: 3 });
	let ol = $state<Record<string, any>>({ enabled: false, model: '', baseUrl: '', mode: 'binary' });

	onMount(async () => {
		try {
			const raw = await api.config();
			config = raw;
			Object.assign(ar, raw.autoRetrieve ?? {});
			Object.assign(ai, raw.autoInjection ?? {});
			Object.assign(al, raw.autoLessons ?? {});
			Object.assign(ac, raw.autoCapture ?? {});
			Object.assign(ol, raw.ollama ?? {});
		} catch (e) { error = String(e); }
	});

	async function handleSave() {
		saving = true; saved = false; error = '';
		config.autoRetrieve = { ...ar };
		config.autoInjection = { ...ai };
		config.autoLessons = { ...al };
		config.autoCapture = { ...ac };
		config.ollama = { ...ol };
		try { await api.configSave(config); saved = true; setTimeout(() => saved = false, 3000); }
		catch (e) { error = String(e); } finally { saving = false; }
	}
</script>

<div class="space-y-4">
	<div class="card preset-filled-surface-100 p-4 flex justify-between items-center gap-3">
		<div>
			<h3 class="h3">Settings</h3>
			<p class="text-sm opacity-70">Configure memory, injection, compression, and AI settings.</p>
		</div>
		<div class="flex gap-2">
			<button class="btn btn-sm preset-tonal" onclick={handleSave} disabled={saving}>
				{saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
			</button>
		</div>
	</div>

	{#if error}<div class="card variant-filled-error-500 p-4 text-sm text-surface-50">{error}</div>{/if}

	<!-- Memory & Storage -->
	<div class="card preset-outlined-surface-200 p-4 space-y-3">
		<h4 class="h4">Memory &amp; Storage</h4>
		<fieldset class="fieldset space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="label"><span class="label-text">Default TTL (days)</span><input type="number" class="input" bind:value={config.defaultTtlDays} min="0" max="3650"></label>
				<label class="label"><span class="label-text">Log Level</span><select class="input" bind:value={config.logLevel}><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select></label>
				<label class="label"><span class="label-text">Cache Size (max nodes)</span><input type="number" class="input" bind:value={config.cacheSize} min="1" max="64"></label>
				<label class="label"><span class="label-text">Cache TTL (hours)</span><input type="number" class="input" bind:value={config.cacheTTLHours} min="1" max="72"></label>
				<label class="label"><span class="label-text">Middle-Term Capture</span><select class="input" bind:value={config.enableMiddleTermCapture}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
			</div>
		</fieldset>
	</div>

	<!-- Injection & Retrieval -->
	<div class="card preset-outlined-surface-200 p-4 space-y-3">
		<h4 class="h4">Injection &amp; Retrieval</h4>
		<fieldset class="fieldset space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="label"><span class="label-text">Max Injection Tokens</span><input type="number" class="input" bind:value={config.maxInjectionTokens} min="500" max="32000"></label>
				<label class="label"><span class="label-text">Core Injection Tokens</span><input type="number" class="input" bind:value={config.coreInjectionTokens} min="100" max="8000"></label>
				<label class="label"><span class="label-text">Auto-Compress Threshold</span><input type="number" class="input" bind:value={config.autoCompressThreshold} min="0" max="1" step="0.05"></label>
				<label class="label"><span class="label-text">High Context Threshold</span><input type="number" class="input" bind:value={config.highContextThreshold} min="0" max="1" step="0.05"></label>
				<label class="label"><span class="label-text">Critical Context Threshold</span><input type="number" class="input" bind:value={config.criticalContextThreshold} min="0" max="1" step="0.05"></label>
				<label class="label"><span class="label-text">Auto-Retrieve Enabled</span><select class="input" bind:value={ar.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Candidate Count</span><input type="number" class="input" bind:value={ar.candidateCount} min="5" max="100"></label>
				<label class="label"><span class="label-text">Max Inject Nodes</span><input type="number" class="input" bind:value={ar.maxInjectNodes} min="1" max="20"></label>
				<label class="label"><span class="label-text">Max Inject Playbooks</span><input type="number" class="input" bind:value={ar.maxInjectPlaybooks} min="0" max="10"></label>
				<label class="label"><span class="label-text">Min Query Length</span><input type="number" class="input" bind:value={ar.minQueryLength} min="1" max="100"></label>
				<label class="label"><span class="label-text">Injection Cooldown (ms)</span><input type="number" class="input" bind:value={ar.injectionCooldownMs} min="1000" max="120000" step="1000"></label>
				<label class="label"><span class="label-text">LLM Judge Enabled</span><select class="input" bind:value={ar.llmJudgeEnabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
			</div>
		</fieldset>
	</div>

	<!-- Auto-Injection & Lessons -->
	<div class="card preset-outlined-surface-200 p-4 space-y-3">
		<h4 class="h4">Auto-Injection &amp; Lessons</h4>
		<fieldset class="fieldset space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="label"><span class="label-text">Auto-Injection Enabled</span><select class="input" bind:value={ai.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Inject On</span><select class="input" bind:value={ai.injectOn}><option value="first">First message only</option><option value="always">Every message</option></select></label>
				<label class="label"><span class="label-text">Auto-Injection Max Results</span><input type="number" class="input" bind:value={ai.maxResults} min="1" max="20"></label>
				<label class="label"><span class="label-text">Auto-Injection Max Tokens</span><input type="number" class="input" bind:value={ai.maxTokens} min="100" max="8000"></label>
				<label class="label"><span class="label-text">Auto-Injection Min Score</span><input type="number" class="input" bind:value={ai.minScore} min="0" max="1" step="0.05"></label>
				<label class="label"><span class="label-text">Auto-Lessons Enabled</span><select class="input" bind:value={al.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Min Failures for Lesson</span><input type="number" class="input" bind:value={al.minFailures} min="1" max="10"></label>
				<label class="label"><span class="label-text">Lessons Use LLM</span><select class="input" bind:value={al.useLlm}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Auto Work Capture</span><select class="input" bind:value={ac.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Min Edits for Capture</span><input type="number" class="input" bind:value={ac.minEdits} min="1" max="50"></label>
				<label class="label"><span class="label-text">Work Capture Use LLM</span><select class="input" bind:value={ac.useLlm}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Max Work Nodes per Session</span><input type="number" class="input" bind:value={ac.maxPerSession} min="1" max="20"></label>
			</div>
		</fieldset>
	</div>

	<!-- AI & Compression -->
	<div class="card preset-outlined-surface-200 p-4 space-y-3">
		<h4 class="h4">AI &amp; Compression</h4>
		<fieldset class="fieldset space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="label"><span class="label-text">Ollama Enabled</span><select class="input" bind:value={ol.enabled}><option value={true}>Enabled</option><option value={false}>Disabled</option></select></label>
				<label class="label"><span class="label-text">Ollama Model</span><input type="text" class="input" bind:value={ol.model} placeholder="qwen2.5-coder:1.5b"></label>
				<label class="label"><span class="label-text">Ollama Base URL</span><input type="text" class="input" bind:value={ol.baseUrl} placeholder="http://localhost:11434"></label>
				<label class="label"><span class="label-text">Ollama Mode</span><select class="input" bind:value={ol.mode}><option value="binary">Binary (relevant/not)</option><option value="rerank">Re-rank</option></select></label>
			</div>
		</fieldset>
	</div>

	<TelemetryChart />
</div>
