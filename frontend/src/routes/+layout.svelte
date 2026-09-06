<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/../app.css';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen flex flex-col">
	<Header />
	<div class="flex-1 p-4">
		{@render children()}
	</div>
	<Footer />
</div>
