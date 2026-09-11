<script lang="ts">
  import { nodesStore } from '$lib/stores/nodes.svelte';
  let q = $state('');
  let t: ReturnType<typeof setTimeout> | null = null;
  function onSearch() { if (q.trim().length >= 2) nodesStore.search(q, { mode: nodesStore.searchMode }); else if (!q.trim()) nodesStore.load(); }
  function onInput() { if (t) clearTimeout(t); t = setTimeout(onSearch, 300); }
  function onClear() { q=''; nodesStore.query=''; nodesStore.clearFilters(); nodesStore.load(); }
</script>

<div class="flex flex-col gap-2">
  <div class="flex gap-2">
    <input bind:value={q} oninput={onInput} class="input text-sm flex-1" placeholder="Search memories — live (≥2 chars) [{nodesStore.searchMode}]" onkeydown={(e)=>{ if(e.key==='Enter') onSearch(); if(e.key==='Escape') onClear(); }} />
    <select class="select w-[110px]" bind:value={nodesStore.searchMode} onchange={onSearch}><option value="hybrid">hybrid</option><option value="bm25">bm25</option><option value="text">text</option></select>
    <button class="btn btn-sm preset-filled-primary-500" onclick={onSearch}>Search</button>
    <button class="btn btn-sm preset-tonal" onclick={onClear}>Clear</button>
  </div>
  <div class="flex gap-1 flex-wrap">
    {#each Object.entries(nodesStore.typeCounts).sort((a,b)=>b[1]-a[1]) as [chip,cnt] (chip)}<button class="chip text-xs px-2 py-1 {nodesStore.activeTypes.has(chip) ? 'preset-filled-primary-500 text-white' : 'preset-tonal'}" onclick={()=>nodesStore.toggleType(chip)}>{chip}<span class="badge text-[10px] ml-1 {nodesStore.activeTypes.has(chip) ? 'preset-filled-surface-50 text-primary-600' : 'preset-filled-surface-200'}">{cnt}</span></button>{/each}
    {#each Object.entries(nodesStore.levelCounts).sort((a,b)=>+a[0]-+b[0]) as [lvl,cnt] (lvl)}<button class="chip text-xs px-2 py-1 {nodesStore.activeLevels.has(+lvl) ? 'preset-filled-secondary-500 text-white' : 'preset-tonal'}" onclick={()=>nodesStore.toggleLevel(+lvl)}>L{lvl}<span class="badge text-[10px] ml-1 preset-filled-surface-200">{cnt}</span></button>{/each}
  </div>
</div>
