// SearchState — single source of truth for search, persisted in URL query string.
// Forever architecture: URL is the state. FilterEngine + Alpine panel are projections.
// Usage: window.searchState.toParams() / fromParams() / push() / applyToEngines()
(function () {
  const VALID_MODES = new Set(["auto", "text", "bm25", "embedding", "hybrid"]);
  const VALID_SCOPES = new Set(["global", "project"]);

  function norm(v) { return v == null || v === "" ? null : String(v); }
  function normArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    return String(v).split(",").map(s => s.trim()).filter(Boolean);
  }

  class SearchState {
    constructor() {
      this.scope = "project";
      this.projectName = null;
      this.q = "";
      this.mode = "auto";
      this.levels = [];
      this.types = [];
      this.supertype = null;
      this.domain = null;
      this.source = null;
      this._suppressPush = false;
      this._onChange = [];
      this.fromUrl();
      window.addEventListener("popstate", () => {
        this.fromUrl();
        this._notify();
      });
    }

    fromUrl() {
      const p = new URLSearchParams(window.location.search);
      const scope = norm(p.get("scope"));
      if (scope && VALID_SCOPES.has(scope)) this.scope = scope;
      this.projectName = norm(p.get("project_name") || p.get("project"));
      this.q = norm(p.get("q")) || "";
      const m = norm(p.get("mode"));
      this.mode = m && VALID_MODES.has(m) ? m : "auto";
      this.levels = normArray(p.get("levels")).map(Number).filter(n => !isNaN(n));
      this.types = normArray(p.get("types"));
      this.supertype = norm(p.get("supertype"));
      this.domain = norm(p.get("domain"));
      this.source = norm(p.get("source"));
    }

    toParams() {
      const p = new URLSearchParams();
      if (this.scope && this.scope !== "project") p.set("scope", this.scope);
      if (this.projectName) p.set("project_name", this.projectName);
      if (this.q) p.set("q", this.q);
      if (this.mode && this.mode !== "auto") p.set("mode", this.mode);
      if (this.levels.length) p.set("levels", this.levels.join(","));
      if (this.types.length) p.set("types", this.types.join(","));
      if (this.supertype) p.set("supertype", this.supertype);
      if (this.domain) p.set("domain", this.domain);
      if (this.source) p.set("source", this.source);
      return p;
    }

    push() {
      if (this._suppressPush) return;
      const p = this.toParams();
      const qs = p.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      if (url !== window.location.pathname + window.location.search) {
        history.pushState(null, "", url);
      }
    }

    replace() {
      const p = this.toParams();
      const qs = p.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      history.replaceState(null, "", url);
    }

    // Apply to filterEngine + Alpine panel (called after fromUrl or push)
    applyToEngines() {
      if (window.filterEngine) {
        const fe = window.filterEngine;
        // levels/types
        fe.levels = new Set(this.levels);
        fe.types = new Set(this.types);
        fe.supertypeFilter = this.supertype;
        fe.domainFilter = this.domain;
        fe.sourceFilter = this.source;
        fe.searchQuery = this.q;
        // serverSearchIds will be repopulated by next search; clear stale
        if (!this.q) fe.serverSearchIds = null;
        fe.changed();
        if (window.sceneCtrl) window.sceneCtrl.updateVisibility(fe);
      }
      // Alpine panel — if present, sync its reactive fields without triggering extra sync loops
      try {
        const el = document.getElementById("visualize-panel");
        const d = el && el._x_dataStack && el._x_dataStack[0];
        if (d) {
          d._suppressSync = true;
          d.query = this.q;
          d.mode = this.mode;
          d.levels = [...this.levels];
          d.types = [...this.types];
          d.supertype = this.supertype || "";
          d.domain = this.domain || "";
          d.source = this.source || "";
          d._suppressSync = false;
          d._updateNodeList();
        }
      } catch { /* alpine not ready yet */ }
      // scope globals
      if (window.currentScope !== undefined) {
        window.currentScope = this.scope;
        window.currentProjectName = this.projectName;
      }
    }

    onChange(fn) { this._onChange.push(fn); }
    _notify() {
      this.applyToEngines();
      for (const fn of this._onChange) { try { fn(this); } catch (e) { console.warn("[SearchState] onChange error", e); } }
    }

    // Called by UI when a field changes — updates state, pushes URL, and notifies
    set(partial) {
      Object.assign(this, partial);
      this.push();
      this._notify();
    }
  }

  window.SearchState = SearchState;
  window.searchState = new SearchState();
})();
