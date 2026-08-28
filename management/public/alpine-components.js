// ==================== Alpine.js Components for Management UI ====================
// Lighter, reactive search, filters, settings, and dashboard

// Shared event for stats loaded
const STATS_LOADED_EVENT = 'alpine:stats-loaded';

document.addEventListener('alpine:init', () => {

  // ==================== Search + Filters Panel ====================
  Alpine.data('searchPanel', () => ({
    query: '',
    mode: 'auto',
    results: [],
    nodeListItems: [],
    loading: false,
    info: '',
    showAdvancedFilters: false,
    sortBy: 'importance',
    sortDir: 'desc',
    nodeListLimit: 100,
    nodeListStep: 100,

    levels: [],
    types: [],
    supertype: '',
    domain: '',
    source: '',

    availableLevels: [],
    availableTypes: [],
    availableSupertypes: [],
    availableDomains: [],
    availableSources: [],

    init() {
      const saved = localStorage.getItem('mgmt-node-sort');
      if (saved) {
        try {
          const p = JSON.parse(saved);
          if (p.sortBy) this.sortBy = p.sortBy;
          if (p.sortDir) this.sortDir = p.sortDir;
        } catch { /* ignore */ }
      }
      this._refreshOptions();
      this._updateNodeList();
      window.addEventListener(STATS_LOADED_EVENT, () => {
        this._refreshOptions();
        this._updateNodeList();
      });
    },

    _refreshOptions() {
      const s = window.statsData;
      if (!s) return;
      this.availableLevels = Object.keys(s.nodesPerLevel || {}).map(Number).sort((a, b) => a - b);
      this.availableTypes = Object.keys(s.nodesPerType || {}).sort();
      this.availableSupertypes = Object.keys(s.nodesPerSupertype || {}).sort();
      this.availableDomains = Object.keys(s.nodesPerDomain || {}).sort();
      this.availableSources = Object.keys(s.nodesPerSource || {}).sort();
    },

    _updateNodeList() {
      if (this.results.length > 0) {
        this.nodeListItems = this._sorted(this.results);
      } else if (window.nodeData && window.filterEngine) {
        this.nodeListItems = this._sorted(
          window.nodeData.filter(n => window.filterEngine.matches(n))
        );
      } else {
        this.nodeListItems = [];
      }
    },

    showMoreNodes() {
      this.nodeListLimit += this.nodeListStep;
    },

    resetNodeListLimit() {
      this.nodeListLimit = 100;
    },

    _sorted(items) {
      const arr = [...items];
      const dir = this.sortDir === 'asc' ? 1 : -1;
      const key = this.sortBy;
      const isDateKey = key === 'createdAt' || key === 'updatedAt' || key === 'lastAccessed';
      const num = (n) => {
        const v = n[key];
        if (v === undefined || v === null) return null;
        return isDateKey ? new Date(v).getTime() : v;
      };
      arr.sort((a, b) => {
        const va = num(a);
        const vb = num(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        let cmp;
        if (typeof va === 'string' || typeof vb === 'string') {
          cmp = String(va).localeCompare(String(vb));
        } else {
          cmp = va - vb;
        }
        return cmp * dir;
      });
      return arr;
    },

    setSortBy(v) {
      this.sortBy = v;
      localStorage.setItem('mgmt-node-sort', JSON.stringify({ sortBy: this.sortBy, sortDir: this.sortDir }));
      this._updateNodeList();
    },

    toggleSortDir() {
      this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
      localStorage.setItem('mgmt-node-sort', JSON.stringify({ sortBy: this.sortBy, sortDir: this.sortDir }));
      this._updateNodeList();
    },

    selectNode(node) {
      if (!window.sceneCtrl) return;
      const nodeId = node.id || node._id;
      window.sceneCtrl.focusOnNode(nodeId);
    },

    get activeFilterCount() {
      let c = 0;
      if (this.levels.length > 0 && this.levels.length < this.availableLevels.length) c++;
      if (this.types.length > 0 && this.types.length < this.availableTypes.length) c++;
      if (this.supertype) c++;
      if (this.domain) c++;
      if (this.source) c++;
      return c;
    },

    get activeFilterChips() {
      const chips = [];
      if (this.levels.length > 0 && this.levels.length < this.availableLevels.length) {
        chips.push({ type: 'levels', label: `Level: ${this.levels.join(', ')}` });
      }
      if (this.types.length > 0 && this.types.length < this.availableTypes.length) {
        chips.push({ type: 'types', label: `Type: ${this.types.join(', ')}` });
      }
      if (this.supertype) chips.push({ type: 'supertype', label: `Supertype: ${this.supertype}` });
      if (this.domain) chips.push({ type: 'domain', label: `Domain: ${this.domain}` });
      if (this.source) chips.push({ type: 'source', label: `Source: ${this.source}` });
      return chips;
    },

    removeFilter(chip) {
      switch (chip.type) {
        case 'levels': this.levels = []; break;
        case 'types': this.types = []; break;
        case 'supertype': this.supertype = ''; break;
        case 'domain': this.domain = ''; break;
        case 'source': this.source = ''; break;
      }
      this._syncFiltersToEngine();
    },

    _syncFiltersToEngine() {
      const fe = window.filterEngine;
      if (!fe) return;
      fe.selectAll();

      if (this.levels.length > 0) {
        const valid = new Set(this.levels);
        for (const l of fe.levels) { if (!valid.has(l)) fe.levels.delete(l); }
      }
      if (this.types.length > 0) {
        const valid = new Set(this.types);
        for (const t of fe.types) { if (!valid.has(t)) fe.types.delete(t); }
      }

      fe.supertypeFilter = this.supertype || null;
      fe.domainFilter = this.domain || null;
      fe.sourceFilter = this.source || null;
      fe.searchQuery = this.query.toLowerCase();
      fe.changed();
      if (window.sceneCtrl) window.sceneCtrl.updateVisibility(fe);
      this._updateNodeList();
    },

    toggleLevel(l) {
      const idx = this.levels.indexOf(l);
      if (idx >= 0) this.levels.splice(idx, 1);
      else this.levels.push(l);
      this._syncFiltersToEngine();
    },

    toggleType(t) {
      const idx = this.types.indexOf(t);
      if (idx >= 0) this.types.splice(idx, 1);
      else this.types.push(t);
      this._syncFiltersToEngine();
    },

    setSupertype(v) {
      this.supertype = v;
      this._syncFiltersToEngine();
    },

    setDomain(v) {
      this.domain = v;
      this._syncFiltersToEngine();
    },

    setSource(v) {
      this.source = v;
      this._syncFiltersToEngine();
    },

    doSearch() {
      const q = this.query.trim();
      if (!q) {
        this.info = '';
        this.results = [];
        window.filterEngine.searchQuery = '';
        window.filterEngine.serverSearchIds = null;
        window.filterEngine.changed();
        this._updateNodeList();
        return;
      }

      const mode = this.mode === 'auto' ? this._detectMode() : this.mode;

      window.filterEngine.setSearchMode(mode);
      if (mode === 'text') {
        this.loading = true;
        window.filterEngine.setSearchQuery(q);
        window.filterEngine.setServerSearchIds(null);
        window.filterEngine.changed();
        if (window.sceneCtrl) window.sceneCtrl.updateVisibility(window.filterEngine);

        const filtered = window.nodeData ? window.nodeData.filter(n => window.filterEngine.matches(n)) : [];
        this.results = filtered.slice(0, 50);
        this.info = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;
        this._updateNodeList();
        this.loading = false;
      } else {
        this.loading = true;
        this._serverSearch(q, mode);
      }
    },

    onQueryInput() {
      if (this.mode === 'auto' || this.mode === 'text') {
        this.doSearch();
      }
    },

    _detectMode() {
      if (this.query.length > 60) return 'embedding';
      if (/["']/.test(this.query) || /\b(?:AND|OR|NOT)\b/i.test(this.query)) return 'bm25';
      return 'text';
    },

    async _serverSearch(query, mode) {
      try {
        const scope = window.currentScope || 'global';
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${mode}&scope=${scope}`);
        if (!res.ok) {
          this.info = 'Search error';
          this.results = [];
          this._updateNodeList();
          return;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          this.results = data.slice(0, 50);
          this.info = `${data.length} result${data.length !== 1 ? 's' : ''}`;
          const ids = new Set(data.map(r => r.id));
          window.filterEngine.setSearchMode(mode);
          window.filterEngine.setServerSearchIds(ids);
          window.filterEngine.setSearchQuery(query);
          if (window.sceneCtrl) window.sceneCtrl.updateVisibility(window.filterEngine);
          this._updateNodeList();
        } else {
          this.results = [];
          this.info = 'No results';
        }
        this._updateNodeList();
      } catch {
        this.info = 'Search failed';
        this.results = [];
      } finally {
        this._updateNodeList();
        this.loading = false;
      }
    },

    selectResult(node) {
      if (window.sceneCtrl) {
        window.sceneCtrl.focusOnNode(node.id);
      }
    },

    clearAll() {
      this.query = '';
      this.results = [];
      this.info = '';
      this.levels = [];
      this.types = [];
      this.supertype = '';
      this.domain = '';
      this.source = '';
      window.filterEngine.selectAll();
      if (window.sceneCtrl) window.sceneCtrl.updateVisibility(window.filterEngine);
      this._updateNodeList();
    },

    isLevelActive(l) { return this.levels.length === 0 || this.levels.includes(l); },
    isTypeActive(t) { return this.types.length === 0 || this.types.includes(t); },

    toggleDotFilter() {
      if (this.types.length === 1 && this.types[0] === 'dot') {
        this.types = [];
      } else {
        this.types = ['dot'];
      }
      this._syncFiltersToEngine();
    },
    clearDotFilter() {
      this.types = [];
      this._syncFiltersToEngine();
    },
  }));

  // ==================== Settings Panel ====================
  Alpine.data('settingsPanel', () => ({
    config: {},
    loading: true,
    saving: false,
    message: '',
    messageType: 'success',

    async init() {
      await this.load();
    },

    async load() {
      try {
        const res = await fetch('/api/config');
        this.config = await res.json();
        this.loading = false;
      } catch (e) {
        console.error('Failed to load config:', e);
        this.loading = false;
        this.message = 'Failed to load config';
        this.messageType = 'error';
      }
    },

    async save() {
      this.saving = true;
      this.message = '';
      try {
        const res = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        const data = await res.json();
        if (data.success) {
          this.message = 'Saved! Restart plugin to apply.';
          this.messageType = 'success';
        } else {
          this.message = 'Error: ' + (data.error || 'Unknown');
          this.messageType = 'error';
        }
      } catch (e) {
        this.message = 'Error: ' + e.message;
        this.messageType = 'error';
      }
      this.saving = false;
      setTimeout(() => { this.message = ''; }, 5000);
    },
  }));

  // ==================== Dashboard Panel ====================
  Alpine.data('dashboardPanel', () => ({
    stats: null,
    loading: true,
    charts: {},
    _initialized: false,

    async init() {
      await this.loadStats();
      // Wait for first show to init charts (needs visible canvas)
      document.addEventListener('dashboard:show', () => {
        this.$nextTick(() => this._initChartsOnce());
      });
    },

    async reload() {
      this.destroyCharts();
      this._initialized = false;
      this.loading = true;
      await this.loadStats();
      this.$nextTick(() => this._initChartsOnce());
    },

    _initChartsOnce() {
      if (this._initialized) {
        Object.values(this.charts).forEach(c => { try { c.resize(); } catch { /* ignore */ } });
        return;
      }
      this._initialized = true;
      this._initCharts();
    },

    async loadStats() {
      try {
        const scope = window.currentScope || 'global';
        const res = await fetch(`/api/stats?scope=${scope}`);
        this.stats = await res.json();
        this.loading = false;
      } catch (_e) {
        console.error('Failed to load stats:', _e);
        this.loading = false;
      }
    },

    fmtTokens(n) {
      if (!n && n !== 0) return '';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    },

    ctxPct() {
      if (!this.stats?.memoryTokens) return 0;
      return Math.round((this.stats.memoryTokens / 128000) * 100);
    },

    _initCharts() {
      if (!this.stats || typeof Chart === 'undefined') return;

      const SUPERTYPE_COLORS = ['#4a9eff', '#34d399', '#fb923c', '#a78bfa'];
      const DOMAIN_COLORS = {
        architecture: '#4a9eff', operations: '#34d399', knowledge: '#f59e0b',
        rules: '#ef4444', history: '#fb923c', patterns: '#a78bfa', preferences: '#ec4899',
      };
      const STRATUM_COLORS = { hot: '#ef4444', warm: '#fbbf24', cold: '#3b82f6' };
      const chartOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 11 } } },
        },
      };

      // Supertype Doughnut
      const supData = this.stats.nodesPerSupertype || {};
      const supKeys = Object.keys(supData);
      if (supKeys.length > 0) {
        const ctx = document.getElementById('chart-supertype');
        if (ctx) {
          this.charts.supertype = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: supKeys,
              datasets: [{
                data: supKeys.map(k => supData[k]),
                backgroundColor: SUPERTYPE_COLORS.slice(0, supKeys.length),
                borderWidth: 0,
              }],
            },
            options: { ...chartOpts, cutout: '60%' },
          });
        }
      }

      // Domain Bar
      const domData = this.stats.nodesPerDomain || {};
      const domKeys = Object.keys(domData);
      if (domKeys.length > 0) {
        const ctx = document.getElementById('chart-domain');
        if (ctx) {
          this.charts.domain = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: domKeys,
              datasets: [{
                label: 'Nodes',
                data: domKeys.map(k => domData[k]),
                backgroundColor: domKeys.map(k => DOMAIN_COLORS[k] || '#888'),
                borderRadius: 4,
              }],
            },
            options: {
              ...chartOpts,
              scales: {
                x: { ticks: { color: '#888', font: { size: 10 } }, grid: { display: false } },
                y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              },
            },
          });
        }
      }

      // Confidence Histogram
      const confData = this.stats.confidenceHistogram || {};
      const confKeys = Object.keys(confData).sort();
      if (confKeys.length > 0) {
        const ctx = document.getElementById('chart-confidence');
        if (ctx) {
          this.charts.confidence = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: confKeys,
              datasets: [{
                label: 'Nodes',
                data: confKeys.map(k => confData[k]),
                backgroundColor: '#d946ef',
                borderRadius: 3,
              }],
            },
            options: {
              ...chartOpts,
              scales: {
                x: { ticks: { color: '#888', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              },
            },
          });
        }
      }

      // Stratum Doughnut
      const stratData = this.stats.stratumBreakdown || {};
      const stratKeys = Object.keys(stratData);
      if (stratKeys.length > 0) {
        const ctx = document.getElementById('chart-stratum');
        if (ctx) {
          this.charts.stratum = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: stratKeys,
              datasets: [{
                data: stratKeys.map(k => stratData[k]),
                backgroundColor: stratKeys.map(k => STRATUM_COLORS[k] || '#888'),
                borderWidth: 0,
              }],
            },
            options: { ...chartOpts, cutout: '60%' },
          });
        }
      }
    },

    destroyCharts() {
      Object.values(this.charts).forEach(c => { try { c.destroy(); } catch { /* ignore */ } });
      this.charts = {};
    },
  }));

});
