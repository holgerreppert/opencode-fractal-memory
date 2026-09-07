<script lang="ts">
	const themes = [
		{ value: 'cerberus', name: 'Cerberus' },
		{ value: 'catppuccin', name: 'Catppuccin' },
		{ value: 'concord', name: 'Concord' },
		{ value: 'crimson', name: 'Crimson' },
		{ value: 'dracula', name: 'Dracula' },
		{ value: 'fennec', name: 'Fennec' },
		{ value: 'hamlindigo', name: 'Hamlindigo' },
		{ value: 'legacy', name: 'Legacy' },
		{ value: 'mint', name: 'Mint' },
		{ value: 'modern', name: 'Modern' },
		{ value: 'mona', name: 'Mona' },
		{ value: 'nosh', name: 'Nosh' },
		{ value: 'nouveau', name: 'Nouveau' },
		{ value: 'pine', name: 'Pine' },
		{ value: 'reign', name: 'Reign' },
		{ value: 'rocket', name: 'Rocket' },
		{ value: 'rose', name: 'Rose' },
		{ value: 'rosepine', name: 'Rosepine' },
		{ value: 'sahara', name: 'Sahara' },
		{ value: 'seafoam', name: 'Seafoam' },
		{ value: 'terminus', name: 'Terminus' },
		{ value: 'vintage', name: 'Vintage' },
		{ value: 'vox', name: 'Vox' },
		{ value: 'wintry', name: 'Wintry' }
	] as const;
	let currentTheme = $state(localStorage.getItem('mem-theme') || 'cerberus');
	function setTheme(theme: string) {
		currentTheme = theme;
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('mem-theme', theme);
	}
</script>

<div class="flex items-center gap-2">
	<span class="text-xs opacity-70">Theme:</span>
	<select
		class="select select-sm"
		value={currentTheme}
		onchange={(e) => setTheme((e.target as HTMLSelectElement).value)}
	>
		{#each themes as t}
			<option value={t.value}>{t.name}</option>
		{/each}
	</select>
</div>
