const GRAPH_COLORS = [
  "#4a9eff", "#34d399", "#fb923c", "#a78bfa", "#f472b6",
  "#fbbf24", "#f87171", "#22d3ee", "#c084fc", "#fb923c",
  "#2dd4bf", "#fde047", "#fca5a5", "#818cf8", "#e879f9",
  "#34d399", "#fbbf24", "#38bdf8", "#a78bfa", "#f472b6",
];

const EDGE_COLORS = {
  calls: "#4a9eff",
  imports: "#34d399",
  references: "#eab308",
  extends: "#a78bfa",
};

const EDGE_OPACITIES = {
  EXTRACTED: 0.6,
  INFERRED: 0.3,
  AMBIGUOUS: 0.15,
};

// oxlint-disable-next-line no-unused-vars (used globally from app.js)
class GraphViz {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`Container #${containerId} not found`);

    this.width = this.container.clientWidth || 800;
    this.height = this.container.clientHeight || 600;
    this.nodeMap = new Map();
    this.nodes = [];
    this.edges = [];
    this.simulation = null;
    this.svg = null;
    this.onNodeClick = null;
    this.tooltip = null;

    this._initSVG();
    this._initTooltip();
  }

  _initSVG() {
    this.svg = d3.select(`#${this.container.id}`)
      .append("svg")
      .attr("width", this.width)
      .attr("height", this.height)
      .style("background", "#0a0a0f")
      .style("cursor", "grab");

    this.defs = this.svg.append("defs");

    this._addArrowMarkers();

    this.zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        this.containerGroup.attr("transform", event.transform);
      });

    this.svg.call(this.zoom);

    this.containerGroup = this.svg.append("g").attr("class", "graph-container");
    this.linkGroup = this.containerGroup.append("g").attr("class", "links");
    this.nodeGroup = this.containerGroup.append("g").attr("class", "nodes");
    this.labelGroup = this.containerGroup.append("g").attr("class", "labels");

    this.resizeObserver = new ResizeObserver(() => this._onResize());
    this.resizeObserver.observe(this.container);
  }

  _addArrowMarkers() {
    for (const [rel, color] of Object.entries(EDGE_COLORS)) {
      this.defs.append("marker")
        .attr("id", `arrow-${rel}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color)
        .attr("opacity", 0.6);
    }
  }

  _initTooltip() {
    this.tooltip = d3.select("body").append("div")
      .attr("class", "graph-tooltip")
      .style("display", "none")
      .style("position", "fixed")
      .style("background", "rgba(0,0,0,0.9)")
      .style("color", "#fff")
      .style("padding", "8px 12px")
      .style("border-radius", "6px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("z-index", "200")
      .style("max-width", "300px")
      .style("border", "1px solid rgba(255,255,255,0.1)");
  }

  _onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    if (this.svg) {
      this.svg.attr("width", this.width).attr("height", this.height);
    }
    if (this.simulation) {
      this.simulation.alpha(0.3).restart();
    }
  }

  _communityColor(community) {
    if (!community && community !== 0) return "#888";
    const idx = (typeof community === "string" ? parseInt(community, 10) || 0 : community) % GRAPH_COLORS.length;
    return GRAPH_COLORS[idx] || "#888";
  }

  loadFromJSON(graphJSON) {
    this.nodes = graphJSON.nodes.map(n => ({
      ...n,
      degree: 0,
      communityColor: this._communityColor(n.community),
      x: this.width / 2 + (Math.random() - 0.5) * 200,
      y: this.height / 2 + (Math.random() - 0.5) * 200,
    }));

    this.nodeMap.clear();
    this.nodes.forEach(n => this.nodeMap.set(n.id, n));

    this.edges = [];
    for (const e of graphJSON.edges) {
      if (this.nodeMap.has(e.source) && this.nodeMap.has(e.target)) {
        this.edges.push({ ...e, source: e.source, target: e.target });
      }
    }

    const degreeMap = new Map();
    for (const e of this.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    }
    for (const n of this.nodes) {
      n.degree = degreeMap.get(n.id) || 0;
    }

    this._render();
  }

  _render() {
    this.linkGroup.selectAll("*").remove();
    this.nodeGroup.selectAll("*").remove();
    this.labelGroup.selectAll("*").remove();

    const link = this.linkGroup.selectAll("line")
      .data(this.edges)
      .join("line")
      .attr("stroke", d => EDGE_COLORS[d.relation] || "#666")
      .attr("stroke-opacity", d => EDGE_OPACITIES[d.confidence] || 0.3)
      .attr("stroke-width", d => d.confidence === "EXTRACTED" ? 2 : 1)
      .attr("marker-end", d => `url(#arrow-${d.relation})`);

    const node = this.nodeGroup.selectAll("g.node")
      .data(this.nodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => this._onNodeHover(event, d))
      .on("mousemove", (event) => this._onTooltipMove(event))
      .on("mouseleave", () => this._onNodeLeave())
      .on("click", (event, d) => {
        event.stopPropagation();
        if (this.onNodeClick) this.onNodeClick(d);
      });

    node.append("circle")
      .attr("r", d => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree || 0) * 1.5)))
      .attr("fill", d => d.communityColor)
      .attr("stroke", d => d3.color(d.communityColor).darker(0.5))
      .attr("stroke-width", 1.5);

    node.append("circle")
      .attr("r", d => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree || 0) * 1.5)) + 2)
      .attr("fill", "none")
      .attr("stroke", d => d.communityColor)
      .attr("stroke-width", 2)
      .attr("opacity", 0)
      .attr("class", "highlight-ring");

    const label = this.labelGroup.selectAll("text")
      .data(this.nodes)
      .join("text")
      .attr("dx", d => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree || 0) * 1.5)) + 4)
      .attr("dy", 4)
      .attr("fill", "#ccc")
      .attr("font-size", "11px")
      .attr("font-family", "Inter, sans-serif")
      .text(d => d.label.length > 30 ? d.label.slice(0, 30) + "…" : d.label);

    this.svg.on("click", () => {
      if (this.onNodeClick) this.onNodeClick(null);
    });

    if (this.simulation) this.simulation.stop();

    this.simulation = d3.forceSimulation(this.nodes)
      .force("link", d3.forceLink(this.edges)
        .id(d => d.id)
        .distance(d => {
          const s = this.nodeMap.get(d.source.id || d.source);
          const t = this.nodeMap.get(d.target.id || d.target);
          const sd = s ? Math.sqrt(s.degree || 0) : 3;
          const td = t ? Math.sqrt(t.degree || 0) : 3;
          return (sd + td) * 8 + 60;
        })
        .strength(d => d.confidence === "EXTRACTED" ? 0.6 : 0.3))
      .force("charge", d3.forceManyBody()
        .strength(d => -(20 + (d.degree || 0) * 2)))
      .force("center", d3.forceCenter(this.width / 2, this.height / 2))
      .force("collision", d3.forceCollide()
        .radius(d => Math.max(4, Math.min(12, 3 + Math.sqrt(d.degree || 0) * 1.5)) + 8))
      .alphaDecay(0.02)
      .on("tick", () => {
        link
          .attr("x1", d => d.source.x)
          .attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x)
          .attr("y2", d => d.target.y);

        node.attr("transform", d => `translate(${d.x},${d.y})`);
        label.attr("x", d => d.x).attr("y", d => d.y);
      });

    this.nodeElements = node;
    this.linkElements = link;
    this.labelElements = label;
  }

  _onNodeHover(event, d) {
    this.tooltip
      .style("display", "block")
      .html(`
        <strong>${d.label}</strong><br>
        <span style="color:#888;">${d.type}</span>${d.kind ? ` · <span style="color:#888;">${d.kind}</span>` : ""}<br>
        ${d.file ? `<span style="color:#666;font-size:11px;">${d.file}${d.line ? `:${d.line}` : ""}</span>` : ""}<br>
        <span style="color:#666;">degree: ${d.degree || 0} · community: ${d.community || "—"}</span>
      `);

    const ring = d3.select(event.currentTarget).select(".highlight-ring");
    ring.attr("opacity", 0.4);
  }

  _onTooltipMove(event) {
    this.tooltip
      .style("left", (event.clientX + 15) + "px")
      .style("top", (event.clientY + 15) + "px");
  }

  _onNodeLeave() {
    this.tooltip.style("display", "none");
    this.containerGroup.selectAll(".highlight-ring").attr("opacity", 0);
  }

  focusOnNode(nodeId) {
    const d = this.nodeMap.get(nodeId);
    if (!d || !this.svg) return;

    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(1.5)
      .translate(-d.x, -d.y);

    this.svg.transition()
      .duration(600)
      .call(this.zoom.transform, transform);

    this.containerGroup.selectAll(".highlight-ring").attr("opacity", 0);
    this.nodeGroup.selectAll("g.node")
      .filter(n => n.id === nodeId)
      .select(".highlight-ring")
      .attr("opacity", 0.6);
  }

  highlightSearch(query) {
    if (!query || !query.trim()) {
      this.nodeGroup.selectAll("g.node").attr("opacity", 1);
      this.labelElements.attr("opacity", 1);
      this.linkElements.attr("opacity", null);
      return;
    }

    const q = query.toLowerCase();
    this.nodeGroup.selectAll("g.node").attr("opacity", d => {
      const match = d.label.toLowerCase().includes(q) ||
        (d.file && d.file.toLowerCase().includes(q));
      return match ? 1 : 0.15;
    });

    this.labelElements.attr("opacity", d => {
      const match = d.label.toLowerCase().includes(q) ||
        (d.file && d.file.toLowerCase().includes(q));
      return match ? 1 : 0.1;
    });

    this.linkElements.attr("stroke-opacity", d => {
      const s = this.nodeMap.get(d.source.id || d.source);
      const t = this.nodeMap.get(d.target.id || d.target);
      if (!s || !t) return 0.05;
      const sMatch = s.label.toLowerCase().includes(q) || (s.file && s.file.toLowerCase().includes(q));
      const tMatch = t.label.toLowerCase().includes(q) || (t.file && t.file.toLowerCase().includes(q));
      if (sMatch || tMatch) {
        return EDGE_OPACITIES[d.confidence] || 0.3;
      }
      return 0.05;
    });
  }

  clear() {
    if (this.simulation) this.simulation.stop();
    this.nodeGroup.selectAll("*").remove();
    this.linkGroup.selectAll("*").remove();
    this.labelGroup.selectAll("*").remove();
    this.nodes = [];
    this.edges = [];
    this.nodeMap.clear();
    this.tooltip.style("display", "none");
  }

  destroy() {
    this.clear();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.tooltip) this.tooltip.remove();
    if (this.svg) this.svg.remove();
  }
}
