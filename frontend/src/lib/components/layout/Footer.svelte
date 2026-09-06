<script lang="ts">
	import { t } from 'svelte-i18n';
	let year = new Date().getFullYear();
</script>

<footer class="border-t border-surface-200 bg-surface-50 px-4 py-3 flex justify-between items-center text-xs opacity-70">
	<span>Fractal Memory · {year} · opencode-fractal-memory</span>
	<span class="flex gap-3">
		<a href="http://127.0.0.1:8787/" class="anchor">Alpine :8787</a>
		<a href="http://127.0.0.1:8788/" class="anchor">Svelte :8788</a>
	</span>
</footer>
