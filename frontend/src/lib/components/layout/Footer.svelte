<script lang="ts">
	import { t } from 'svelte-i18n';
	let year = new Date().getFullYear();
</script>

<footer class="border-t border-surface-200 preset-filled-surface-100 px-4 py-3 flex justify-between items-center text-xs opacity-80">
	<span>Fractal Memory · {year} · opencode-fractal-memory</span>
</footer>
