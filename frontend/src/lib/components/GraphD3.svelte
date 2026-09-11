<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as d3 from 'd3';

	const GRAPH_COLORS = [
		'#4a9eff','#34d399','#fb923c','#a78bfa','#f472b6',
		'#fbbf24','#f87171','#22d3ee','#c084fc','#2dd4bf',
		'#fde047','#fca5a5','#818cf8','#e879f9','#38bdf8',
	];
	const EDGE_COLORS: Record<string, string> = { calls: '#4a9eff', imports: '#34d399', references: '#eab308', extends: '#a78bfa' };
	const EDGE_OPACITIES: Record<string, number> = { EXTRACTED: 0.6, INFERRED: 0.3, AMBIGUOUS: 0.15 };

	let { data = null, query = '', onSelect } = $props<{ data: { nodes: any[]; edges: any[] } | null; query?: string; onSelect?: (n: any)=>void }>();

	let containerEl: HTMLDivElement | undefined = $state(undefined);
	let svg: any = null;
	let containerGroup: any = null;
	let linkGroup: any = null;
	let nodeGroup: any = null;
	let labelGroup: any = null;
	let simulation: any = null;
	let zoom: any = null;
	let tooltipEl: HTMLDivElement | undefined = $state(undefined);
	let nodeMap = new Map<string, any>();
	let nodes: any[] = [];
	let edges: any[] = [];
	let ro: ResizeObserver | null = null;

	function communityColor(c: any) {
		if (c === undefined || c === null || c === '') return '#888';
		const idx = (typeof c === 'string' ? parseInt(c, 10) || 0 : c) % GRAPH_COLORS.length;
		return GRAPH_COLORS[idx] ?? '#888';
	}

	function initSvg() {
		if (!containerEl) return;
		const w = containerEl.clientWidth || 800;
		const h = containerEl.clientHeight || 600;
		svg = d3.select(containerEl).append('svg')
			.attr('width', w).attr('height', h)
			.style('background', '#0a0a0f').style('cursor', 'grab').style('display','block');

		const defs = svg.append('defs');
		for (const [rel, color] of Object.entries(EDGE_COLORS)) {
			defs.append('marker').attr('id', `arrow-${rel}`).attr('viewBox','0 -5 10 10').attr('refX',20).attr('refY',0)
				.attr('markerWidth',8).attr('markerHeight',8).attr('orient','auto')
				.append('path').attr('d','M0,-5L10,0L0,5').attr('fill', color).attr('opacity',0.6);
		}
		zoom = d3.zoom().scaleExtent([0.1, 8]).on('zoom', (e: any) => containerGroup.attr('transform', e.transform));
		svg.call(zoom);
		containerGroup = svg.append('g').attr('class','graph-container');
		linkGroup = containerGroup.append('g').attr('class','links');
		nodeGroup = containerGroup.append('g').attr('class','nodes');
		labelGroup = containerGroup.append('g').attr('class','labels');
		svg.on('click', () => onSelect?.(null));
		ro = new ResizeObserver(() => onResize());
		ro.observe(containerEl);
	}

	function onResize() {
		if (!containerEl || !svg) return;
		const w = containerEl.clientWidth; const h = containerEl.clientHeight;
		svg.attr('width', w).attr('height', h);
		if (simulation) simulation.alpha(0.3).restart();
	}

	function loadFromData(raw: { nodes: any[]; edges: any[] }) {
		const w = containerEl?.clientWidth || 800;
		const h = containerEl?.clientHeight || 600;
		// cap large graphs — keep highest-degree nodes (matches graphology tip: avoid iterating twice, use degreeMap once)
		let srcNodes = raw.nodes;
		if (srcNodes.length > 400) {
			const degTmp = new Map<string, number>();
			for (const e of raw.edges) { degTmp.set(e.source,(degTmp.get(e.source)||0)+1); degTmp.set(e.target,(degTmp.get(e.target)||0)+1); }
			srcNodes = [...raw.nodes].sort((a:any,b:any)=> (degTmp.get(b.id)||0)-(degTmp.get(a.id)||0)).slice(0,400);
		}
		const keepIds = new Set(srcNodes.map((n:any)=> n.id));
		nodes = srcNodes.map((n: any) => ({
			...n, label: n.label ?? n.id, degree: 0,
			communityColor: communityColor(n.community),
			x: w/2 + (Math.random()-0.5)*200, y: h/2 + (Math.random()-0.5)*200,
		}));
		nodeMap.clear();
		nodes.forEach(n => nodeMap.set(n.id, n));
		edges = raw.edges.filter((e: any) => keepIds.has(e.source) && keepIds.has(e.target)).map((e:any) => ({...e}));
		const deg = new Map<string,number>();
		for (const e of edges) { deg.set(e.source,(deg.get(e.source)||0)+1); deg.set(e.target,(deg.get(e.target)||0)+1); }
		for (const n of nodes) n.degree = deg.get(n.id) || 0;
		render();
		if (query) applySearch(query);
	}

	function render() {
		if (!svg) return;
		linkGroup.selectAll('*').remove(); nodeGroup.selectAll('*').remove(); labelGroup.selectAll('*').remove();

		const link = linkGroup.selectAll('line').data(edges).join('line')
			.attr('stroke', (d:any) => EDGE_COLORS[d.relation] ?? '#666')
			.attr('stroke-opacity', (d:any) => (EDGE_OPACITIES as any)[d.confidence] ?? 0.3)
			.attr('stroke-width', (d:any) => d.confidence === 'EXTRACTED' ? 2 : 1)
			.attr('marker-end', (d:any) => `url(#arrow-${d.relation})`);

		const node = nodeGroup.selectAll('g.node').data(nodes).join('g')
			.attr('class','node').style('cursor','pointer')
			.on('mouseenter', (event:any, d:any) => onHover(event,d))
			.on('mousemove', (event:any) => onTooltipMove(event))
			.on('mouseleave', () => onLeave())
			.on('click', (event:any,d:any) => { event.stopPropagation(); onSelect?.(d); });

		node.append('circle')
			.attr('r', (d:any) => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree||0)*1.5)))
			.attr('fill', (d:any) => d.communityColor)
			.attr('stroke', (d:any) => d3.color(d.communityColor)?.darker(0.5) as any)
			.attr('stroke-width',1.5);
		node.append('circle')
			.attr('r', (d:any) => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree||0)*1.5))+2)
			.attr('fill','none').attr('stroke',(d:any)=>d.communityColor).attr('stroke-width',2).attr('opacity',0).attr('class','highlight-ring');

		const label = labelGroup.selectAll('text').data(nodes).join('text')
			.attr('dx', (d:any) => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree||0)*1.5))+4)
			.attr('dy',4).attr('fill','#ccc').attr('font-size','11px').attr('font-family','Inter, sans-serif')
			.text((d:any) => d.label.length>30 ? d.label.slice(0,30)+'…' : d.label);

		if (simulation) simulation.stop();
		const w = containerEl?.clientWidth || 800; const h = containerEl?.clientHeight || 600;
		const manyBody = d3.forceManyBody().strength((d:any)=> -(20 + Math.min(d.degree||0, 20)*2));
		// graphology tip: forEach* is fastest, but D3 here — reduce n² force cost for large graphs
		if (nodes.length > 200) manyBody.distanceMax(200);
		simulation = d3.forceSimulation(nodes)
			.force('link', d3.forceLink(edges).id((d:any)=>d.id).distance((d:any)=>{
				const s = nodeMap.get(d.source.id ?? d.source); const t = nodeMap.get(d.target.id ?? d.target);
				const sd = s ? Math.sqrt(s.degree||0) : 3; const td = t ? Math.sqrt(t.degree||0) : 3;
				return (sd+td)*8+60;
			}).strength((d:any)=> d.confidence==='EXTRACTED'?0.6:0.3))
			.force('charge', manyBody)
			.force('center', d3.forceCenter(w/2, h/2))
			.force('collision', d3.forceCollide().radius((d:any)=> Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree||0)*1.5))+8))
			.alphaDecay(nodes.length > 200 ? 0.04 : 0.02)
			.on('tick', () => {
				link.attr('x1',(d:any)=>d.source.x).attr('y1',(d:any)=>d.source.y).attr('x2',(d:any)=>d.target.x).attr('y2',(d:any)=>d.target.y);
				node.attr('transform',(d:any)=>`translate(${d.x},${d.y})`);
				label.attr('x',(d:any)=>d.x).attr('y',(d:any)=>d.y);
			});
	}

	function onHover(event: any, d: any) {
		if (!tooltipEl) return;
		tooltipEl.style.display='block';
		tooltipEl.innerHTML = `<strong>${d.label}</strong><br><span style="color:#888;">${d.type ?? ''}</span>${d.kind?` · <span style="color:#888;">${d.kind}</span>`:''}<br>${d.file?`<span style="color:#666;font-size:11px;">${d.file}${d.line?`:${d.line}`:''}</span>`:''}<br><span style="color:#666;">degree: ${d.degree||0} · community: ${d.community ?? '—'}</span>`;
		d3.select(event.currentTarget).select('.highlight-ring').attr('opacity',0.4);
	}
	function onTooltipMove(event: any) {
		if (!tooltipEl) return;
		tooltipEl.style.left = (event.clientX+15)+'px'; tooltipEl.style.top = (event.clientY+15)+'px';
	}
	function onLeave() {
		if (tooltipEl) tooltipEl.style.display='none';
		containerGroup?.selectAll('.highlight-ring').attr('opacity',0);
	}

	export function highlightSearch(q: string) { applySearch(q); }
	function applySearch(q: string) {
		if (!q?.trim()) {
			nodeGroup?.selectAll('g.node').attr('opacity',1);
			labelGroup?.selectAll('text').attr('opacity',1);
			linkGroup?.selectAll('line').attr('stroke-opacity', (d:any)=> (EDGE_OPACITIES as any)[d.confidence] ?? 0.3);
			return;
		}
		const qq = q.toLowerCase();
		nodeGroup.selectAll('g.node').attr('opacity',(d:any)=> (d.label.toLowerCase().includes(qq) || (d.file && d.file.toLowerCase().includes(qq))) ? 1 : 0.15);
		labelGroup.selectAll('text').attr('opacity',(d:any)=> (d.label.toLowerCase().includes(qq) || (d.file && d.file.toLowerCase().includes(qq))) ? 1 : 0.1);
		linkGroup.selectAll('line').attr('stroke-opacity',(d:any)=>{
			const s=nodeMap.get(d.source.id ?? d.source); const t=nodeMap.get(d.target.id ?? d.target);
			if(!s||!t) return 0.05;
			const sm = s.label.toLowerCase().includes(qq) || (s.file && s.file.toLowerCase().includes(qq));
			const tm = t.label.toLowerCase().includes(qq) || (t.file && t.file.toLowerCase().includes(qq));
			return (sm||tm) ? ((EDGE_OPACITIES as any)[d.confidence] ?? 0.3) : 0.05;
		});
	}

	$effect(() => { void query; if (nodeGroup) applySearch(query); });
	$effect(() => { if (data && svg) loadFromData(data); });

	onMount(() => { initSvg(); if (data) loadFromData(data); });
	onDestroy(() => { ro?.disconnect(); simulation?.stop(); svg?.remove(); if(tooltipEl) tooltipEl.style.display='none'; });

	export function focusOnNode(id: string) {
		const d = nodeMap.get(id); if(!d || !svg) return;
		const w = containerEl?.clientWidth || 800; const h = containerEl?.clientHeight || 600;
		const t = d3.zoomIdentity.translate(w/2,h/2).scale(1.5).translate(-d.x,-d.y);
		svg.transition().duration(600).call(zoom.transform, t);
	}
</script>

<div bind:this={containerEl} class="w-full h-[560px] rounded-xl overflow-hidden border border-surface-200 bg-[#0a0a0f] relative">
</div>
<div bind:this={tooltipEl} class="fixed hidden bg-black/90 text-white text-xs p-2 rounded-lg shadow z-50 pointer-events-none max-w-[300px] border border-white/10"></div>
