<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { register, init, t } from 'svelte-i18n';
	import '$lib/../app.css';
	import { onMount } from 'svelte';

	let { children } = $props();

	// i18n infra english-only v1 per plan — locales in src/locales/{en}.json, $t("{key}") single-brace
	register('en', () => import('../locales/en.json'));
	onMount(() => init({ fallbackLocale: 'en', initialLocale: 'en' }));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="flex gap-4 p-4 border-b">
	<a href="/" class="font-bold">{$t('nav.dashboard')}</a>
	<a href="/memory">{$t('nav.memory')}</a>
	<a href="/graph">{$t('nav.graph')}</a>
	<a href="/injections">{$t('nav.injections')}</a>
	<a href="/settings">{$t('nav.settings')}</a>
</nav>

{@render children()}
