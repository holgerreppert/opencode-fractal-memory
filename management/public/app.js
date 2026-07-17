const LEVEL_COLORS = {
  0: 0x4a9eff,
  1: 0x34d399,
  2: 0xfb923c,
  3: 0xa78bfa,
  4: 0xf472b6,
  5: 0xfbbf24,
};

const TYPE_SHAPES = {
  note: "sphere",
  event: "box",
  episode: "box",
  concept: "octahedron",
  summary: "octahedron",
  core: "dodecahedron",
  improvement: "sphere",
  howto: "sphere",
  skill: "icosahedron",
  playbook: "torus",
  fact: "octahedron",
  lesson: "dodecahedron",
  rule: "icosahedron",
  decision: "dodecahedron",
  architecture: "box",
  preference: "sphere",
  convention: "box",
  knowledge: "octahedron",
  research: "octahedron",
  bug: "box",
  fix: "box",
  plan: "torus",
  task: "sphere",
  exploration: "box",
  "debug-investigation": "box",
  review: "sphere",
  session: "sphere",
  playbook_version: "torus",
  unknown: "sphere",
};

const TYPE_COLORS = {
  skill: 0xfbbf24,
  playbook: 0xff8c00,
  fact: 0x34d399,
  lesson: 0xa78bfa,
  rule: 0xf472b6,
  decision: 0xfb923c,
  architecture: 0x4a9eff,
  concept: 0x34d399,
  core: 0xfbbf24,
  knowledge: 0x34d399,
  research: 0x34d399,
  howto: 0x4a9eff,
  summary: 0xfb923c,
  bug: 0xff6b6b,
  fix: 0x34d399,
};

const CUSTOM_TYPE_COLORS = {
  'middle-term': 0xff6b6b,
};

const CUSTOM_TYPE_SHAPES = {
  'middle-term': "torus",
};

// ==================== Filter Engine ====================

class NodeFilterEngine {
  constructor() {
    this.levels = new Set();
    this.types = new Set();
    this.customTypes = new Set();
    this.shapes = new Set();
    this.projects = new Set();
    this.searchQuery = "";
    this.searchMode = "text";
    this.serverSearchIds = null;
    this.onUpdate = null;
    this.hideAll = false;
    this._allValues = null;
    this.supertypeFilter = null;
    this.sourceFilter = null;
  }

  initFromStats(stats) {
    this._allValues = {
      levels: Object.keys(stats.nodesPerLevel || {}).map(Number).sort((a, b) => a - b),
      types: Object.keys(stats.nodesPerType || {}).sort(),
      customTypes: Object.keys(stats.nodesPerCustomType || {}).sort(),
      shapes: Object.keys(stats.nodesPerShape || {}).sort(),
    };

    this.levels.clear();
    this.types.clear();
    this.customTypes.clear();
    this.shapes.clear();
    this.projects.clear();
    this.supertypeFilter = null;
    this.sourceFilter = null;

    this._allValues.levels.forEach(l => this.levels.add(l));
    this._allValues.types.forEach(t => this.types.add(t));
    this._allValues.customTypes.forEach(ct => this.customTypes.add(ct));
    this._allValues.shapes.forEach(s => this.shapes.add(s));

    this.hideAll = false;
    this.searchQuery = "";
    this.serverSearchIds = null;
  }

  toggleLevel(v) { this._toggle(this.levels, v); this.changed(); }
  toggleType(v) { this._toggle(this.types, v); this.changed(); }
  toggleCustomType(v) { this._toggle(this.customTypes, v); this.changed(); }
  toggleShape(v) { this._toggle(this.shapes, v); this.changed(); }
  toggleProject(v) { this._toggle(this.projects, v); this.changed(); }

  selectAll() {
    if (!this._allValues) return;
    this.levels.clear();
    this.types.clear();
    this.customTypes.clear();
    this.shapes.clear();
    this.projects.clear();
    this.supertypeFilter = null;
    this.sourceFilter = null;
    this._allValues.levels.forEach(l => this.levels.add(l));
    this._allValues.types.forEach(t => this.types.add(t));
    this._allValues.customTypes.forEach(ct => this.customTypes.add(ct));
    this._allValues.shapes.forEach(s => this.shapes.add(s));
    this.hideAll = false;
    this.searchQuery = "";
    this.serverSearchIds = null;
    this.changed();
  }

  clearAll() {
    this.levels.clear();
    this.types.clear();
    this.customTypes.clear();
    this.shapes.clear();
    this.projects.clear();
    this.supertypeFilter = null;
    this.sourceFilter = null;
    this.searchQuery = "";
    this.serverSearchIds = null;
    this.hideAll = true;
    this.changed();
  }

  toggleAll(category) {
    const all = this._allValues?.[category];
    if (!all || all.length === 0) return;
    const set = this._getSet(category);
    if (!set) return;
    // If any value in this category is missing from set, add all
    const allSelected = all.every(v => set.has(typeof v === "number" ? v : v));
    if (allSelected) {
      set.clear();
    } else {
      all.forEach(v => set.add(typeof v === "number" ? v : v));
    }
    this.changed();
  }

  _getSet(category) {
    switch (category) {
      case "level": return this.levels;
      case "type": return this.types;
      case "customType": return this.customTypes;
      case "shape": return this.shapes;
      case "project": return this.projects;
    }
  }

  setSearchQuery(q) {
    this.searchQuery = (q || "").toLowerCase();
    if (this.searchQuery) this.hideAll = false;
  }
  setSearchMode(m) { this.searchMode = m; }
  setServerSearchIds(ids) { this.serverSearchIds = ids; }

  changed() {
    if (this.levels.size > 0 || this.types.size > 0 ||
        this.customTypes.size > 0 || this.shapes.size > 0 ||
        this.projects.size > 0 || this.searchQuery) {
      this.hideAll = false;
    }
    if (this.onUpdate) this.onUpdate();
  }

  _toggle(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  matches(node) {
    if (!node) return false;
    if (this.hideAll) return false;

    if (this.levels.size > 0 && !this.levels.has(node.level)) return false;
    if (this.types.size > 0 && !this.types.has(node.type || "unknown")) return false;

    if (this.customTypes.size > 0) {
      const ct = node.metadata?.customType;
      if (ct && !this.customTypes.has(ct)) return false;
    }

    if (this.shapes.size > 0) {
      if (!this.shapes.has(getNodeShape(node))) return false;
    }

    if (this.projects.size > 0) {
      const p = node.projectName || "(default)";
      if (!this.projects.has(p)) return false;
    }

    // New filters
    if (this.supertypeFilter && node.supertype !== this.supertypeFilter) return false;
    if (this.sourceFilter && node.source !== this.sourceFilter) return false;

    if (this.searchQuery) {
      if (this.searchMode === "text") {
        const q = this.searchQuery;
        const lm = node.label && node.label.toLowerCase().includes(q);
        const cm = node.content && node.content.toLowerCase().includes(q);
        if (!lm && !cm) return false;
      } else if (this.serverSearchIds) {
        if (!this.serverSearchIds.has(node.id)) return false;
      }
    }

    return true;
  }

  apply(data) {
    return data.filter(n => this.matches(n));
  }
}

// ==================== Scene Controller ====================

class SceneController {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0f);
    this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.0006);

    const container = document.getElementById("main-content") || document.body;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    this.camera.position.set(0, 100, 300);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById("canvas-container").appendChild(this.renderer.domElement);

    this.layoutMode = "shell";
    this.nodeObjects = [];
    this.edgeObjects = [];
    this.regionObjects = [];
    this.nodePositions = new Map();
    this.nodeVelocities = new Map();
    this.brainMeshGroup = null;
    this.hoveredNode = null;
    this.selectedNode = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Orbit state
    this._isDragging = false;
    this._prevMouse = { x: 0, y: 0 };
    this._spherical = { theta: 0, phi: Math.PI / 3, radius: 350 };
    this._target = new THREE.Vector3(0, 0, 0);

    // WASD movement state
    this._keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    this._moveSpeed = 2;

    this._addLights();
    this._updateCamera();
    this._bindEvents();
  }

  async loadBrainMesh() {
    if (this.brainMeshGroup) return this.brainMeshGroup;
    try {
      const regions = await GLBLoader.load("models/brain-atlas.glb");
      const group = new THREE.Group();

      for (const r of regions) {
        r.geometry.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: r.color,
          roughness: 0.5,
          metalness: 0.0,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          side: THREE.DoubleSide,
          emissive: r.color,
          emissiveIntensity: 0.12,
        });
        const mesh = new THREE.Mesh(r.geometry, mat);
        mesh.name = r.name;
        mesh.userData.brainRegion = r.name;
        group.add(mesh);
      }

      this.brainMeshGroup = group;
      return group;
    } catch (err) {
      console.error("[brain] Failed to load brain mesh:", err);
      return null;
    }
  }

  _addLights() {
    const ambient = new THREE.AmbientLight(0x8888cc, 0.8);
    this.scene.add(ambient);
    const hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x3a3a5a, 0.6);
    this.scene.add(hemisphere);
    const l1 = new THREE.DirectionalLight(0xffffff, 1.0);
    l1.position.set(200, 300, 200);
    this.scene.add(l1);
    const l2 = new THREE.DirectionalLight(0x4a9eff, 0.5);
    l2.position.set(-200, -100, -200);
    this.scene.add(l2);
    const l3 = new THREE.DirectionalLight(0xff8844, 0.3);
    l3.position.set(-100, 50, 300);
    this.scene.add(l3);
  }

  _updateCamera() {
    const s = this._spherical;
    const t = this._target;
    this.camera.position.x = t.x + s.radius * Math.sin(s.phi) * Math.cos(s.theta);
    this.camera.position.y = t.y + s.radius * Math.cos(s.phi);
    this.camera.position.z = t.z + s.radius * Math.sin(s.phi) * Math.sin(s.theta);
    this.camera.lookAt(t);
  }

  _bindEvents() {
    const el = this.renderer.domElement;

    el.addEventListener("mousedown", (e) => {
      if (e.button === 0 && !this.hoveredNode) {
        this._isDragging = true;
        this._prevMouse = { x: e.clientX, y: e.clientY };
      }
    });

    el.addEventListener("mousemove", (e) => {
      if (this._isDragging) {
        const dx = e.clientX - this._prevMouse.x;
        const dy = e.clientY - this._prevMouse.y;
        this._spherical.theta -= dx * 0.005;
        this._spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this._spherical.phi + dy * 0.005));
        this._prevMouse = { x: e.clientX, y: e.clientY };
        this._updateCamera();
      }
    });

    el.addEventListener("mouseup", () => { this._isDragging = false; });
    el.addEventListener("mouseleave", () => { this._isDragging = false; });

    el.addEventListener("wheel", (e) => {
      this._spherical.radius *= e.deltaY > 0 ? 1.1 : 0.9;
      this._spherical.radius = Math.max(10, Math.min(1000, this._spherical.radius));
      this._updateCamera();
    });

    el.addEventListener("mousemove", (e) => this._onMouseMove(e));
    el.addEventListener("click", (e) => this._onClick(e));

    window.addEventListener("keydown", (e) => this._onKeyDown(e));
    window.addEventListener("keyup", (e) => this._onKeyUp(e));
  }

  _onKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    switch (e.code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": case "KeyQ": case "KeyE":
        e.preventDefault();
        this._keys[e.code.slice(3).toLowerCase()] = true;
        break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": case "KeyQ": case "KeyE":
        this._keys[e.code.slice(3).toLowerCase()] = false;
        break;
    }
  }

  _updateMovement() {
    if (!this._keys.w && !this._keys.a && !this._keys.s && !this._keys.d && !this._keys.q && !this._keys.e) return;

    const forward = new THREE.Vector3().subVectors(this._target, this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }

    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    const speed = this._moveSpeed;

    if (this._keys.w) move.add(forward.clone().multiplyScalar(speed));
    if (this._keys.s) move.sub(forward.clone().multiplyScalar(speed));
    if (this._keys.a) move.sub(right.clone().multiplyScalar(speed));
    if (this._keys.d) move.add(right.clone().multiplyScalar(speed));
    if (this._keys.q) move.y -= speed;
    if (this._keys.e) move.y += speed;

    this._target.add(move);
    this._updateCamera();
  }

  _onMouseMove(event) {
    this._lastMouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this._lastMouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    this.mouse.x = this._lastMouseX;
    this.mouse.y = this._lastMouseY;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.nodeObjects.filter(o => o.isMesh);
    const hits = this.raycaster.intersectObjects(meshes);
    const tooltip = document.getElementById("tooltip");

    // Also check brain mesh
    let brainHit = null;
    if (this.brainMeshGroup && this.layoutMode === "brain") {
      const brainMeshes = [];
      this.brainMeshGroup.traverse(c => { if (c.isMesh) brainMeshes.push(c); });
      const brainHits = this.raycaster.intersectObjects(brainMeshes);
      if (brainHits.length > 0) brainHit = brainHits[0].object;
    }

    if (hits.length > 0) {
      const obj = hits[0].object;
      const nd = obj.userData.nodeData;
      if (this.hoveredNode !== obj) {
        if (this.hoveredNode && this.hoveredNode !== this.selectedNode) {
          this.hoveredNode.material.emissiveIntensity = 0.2;
        }
        this.hoveredNode = obj;
        if (obj !== this.selectedNode) {
          obj.material.emissiveIntensity = 0.5;
        }
      }
      tooltip.style.display = "block";
      tooltip.style.left = event.clientX + 15 + "px";
      tooltip.style.top = event.clientY + 15 + "px";
      tooltip.innerHTML = `<strong>${nd.label || "Unnamed"}</strong><br>Level: ${nd.level} | Importance: ${nd.importance}`;
    } else if (brainHit) {
      const regionName = brainHit.userData.brainRegion || brainHit.name;
      if (this.hoveredNode && this.hoveredNode !== this.selectedNode) {
        this.hoveredNode.material.emissiveIntensity = 0.2;
      }
      this.hoveredNode = null;
      tooltip.style.display = "block";
      tooltip.style.left = event.clientX + 15 + "px";
      tooltip.style.top = event.clientY + 15 + "px";
      tooltip.innerHTML = `<strong>${regionName}</strong><br><em>Click to filter nodes</em>`;
    } else {
      if (this.hoveredNode && this.hoveredNode !== this.selectedNode) {
        this.hoveredNode.material.emissiveIntensity = 0.2;
      }
      this.hoveredNode = null;
      tooltip.style.display = "none";
    }
  }

  _onClick(event) {
    if (this.hoveredNode) {
      this.selectedNode = this.hoveredNode;
      this._updateHighlight();
      showDetailPanel(this.hoveredNode.userData.nodeData);
      return;
    }

    // Check brain region click
    if (this.brainMeshGroup && this.layoutMode === "brain") {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const brainMeshes = [];
      this.brainMeshGroup.traverse(c => { if (c.isMesh) brainMeshes.push(c); });
      const hits = this.raycaster.intersectObjects(brainMeshes);
      if (hits.length > 0) {
        const region = hits[0].object.userData.brainRegion || hits[0].object.name;
        const filterEngine = window.filterEngine;
        if (filterEngine) {
          filterEngine.customTypes = new Set([region]);
          document.querySelectorAll(".filter-btn.custom-type").forEach(b => {
            b.classList.toggle("active", b.dataset.customType === region);
          });
          this.updateVisibility(filterEngine);
        }
      }
    }
  }

  _updateHighlight() {
    this.nodeObjects.forEach(obj => {
      if (obj.isMesh && obj.userData.nodeData) {
        if (obj === this.selectedNode) {
          obj.material.emissiveIntensity = 0.8;
        } else if (obj !== this.hoveredNode) {
          obj.material.emissiveIntensity = 0.2;
        }
      }
    });
  }

  clear() {
    this.nodeObjects.forEach(obj => this.scene.remove(obj));
    this.edgeObjects.forEach(obj => this.scene.remove(obj));
    this.regionObjects.forEach(obj => this.scene.remove(obj));
    if (this.brainMeshGroup) {
      this.scene.remove(this.brainMeshGroup);
    }
    this.nodeObjects = [];
    this.edgeObjects = [];
    this.regionObjects = [];
    this.nodePositions.clear();
    this.nodeVelocities.clear();
  }

  buildFromData(data, layoutMode = "shell") {
    this.clear();
    this.layoutMode = layoutMode;

    if (data.length === 0) {
      console.log("[scene] No data to build");
      return;
    }

    if (layoutMode === "shell") {
      this._computeShellPositions(data);
    } else if (layoutMode === "type-cluster") {
      this._computeTypeClusterPositions(data);
    } else if (layoutMode === "brain") {
      this._showBrainLayout(data); // positions nodes synchronously, loads brain mesh async
    } else {
      this._computeForcePositions(data);
    }

    this._createNodeMeshes(data);

    console.log(`[scene] Built ${data.length} nodes → ${this.nodeObjects.filter(o => o.isMesh).length} meshes`);
  }

  _computeShellPositions(data) {
    const levelGroups = {};
    const levelCounters = {};
    const levelCounts = {};
    for (const node of data) {
      if (!node) continue;
      const lvl = node.level ?? 3;
      if (!levelGroups[lvl]) { levelGroups[lvl] = []; levelCounters[lvl] = 0; levelCounts[lvl] = 0; }
      levelGroups[lvl].push(node);
      levelCounts[lvl]++;
    }

    const shellRadii = computeShellRadii(levelCounts);
    this.shellRadii = shellRadii;

    for (const node of data) {
      if (!node) continue;
      const lvl = node.level ?? 3;
      const count = levelCounts[lvl];
      const idx = levelCounters[lvl]++;
      const radius = shellRadii[lvl] ?? 120;

      const pos = fibonacciSphere(idx, count, radius);
      this.nodePositions.set(node.id, pos);
      this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));
    }
  }

  _computeTypeClusterPositions(data) {
    const typeGroups = {};
    const typeCounts = {};
    for (const node of data) {
      if (!node) continue;
      const type = node.type || "unknown";
      if (!typeGroups[type]) { typeGroups[type] = []; typeCounts[type] = 0; }
      typeGroups[type].push(node);
      typeCounts[type]++;
    }

    const types = Object.keys(typeGroups);
    const typeSphereRadius = 180;

    const typeCenters = {};
    types.forEach((type, idx) => {
      typeCenters[type] = fibonacciSphere(idx, types.length, typeSphereRadius);
    });

    for (const type of types) {
      const nodes = typeGroups[type];
      const center = typeCenters[type];

      const levelGroups = {};
      const levelCounts = {};
      for (const node of nodes) {
        const lvl = node.level ?? 3;
        if (!levelGroups[lvl]) { levelGroups[lvl] = []; levelCounts[lvl] = 0; }
        levelGroups[lvl].push(node);
        levelCounts[lvl]++;
      }

      const sortedLevels = Object.keys(levelCounts).map(Number).sort((a, b) => a - b);
      const maxCount = Math.max(...sortedLevels.map(l => levelCounts[l]));
      const baseClusterRadius = Math.max(12, Math.sqrt(maxCount) * 5);

      sortedLevels.forEach((lvl, i) => {
        const levelNodes = levelGroups[lvl];
        const count = levelCounts[lvl];
        const radius = baseClusterRadius + i * 6;

        levelNodes.forEach((node, idx) => {
          const localPos = fibonacciSphere(idx, count, radius);
          const pos = new THREE.Vector3().copy(center).add(localPos);
          this.nodePositions.set(node.id, pos);
          this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));
        });
      });
    }

    this.shellRadii = {};
  }

  _computeForcePositions(data) {
    const count = data.length;
    data.forEach((node, idx) => {
      if (!node) return;
      const pos = fibonacciSphere(idx, count, 80);
      this.nodePositions.set(node.id, pos);
      this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));
    });
    this.shellRadii = {};
  }

  _showBrainLayout(data) {
    const TYPE_REGION = {
      skill: "prefrontal", playbook: "prefrontal", rule: "prefrontal",
      howto: "prefrontal", bug: "prefrontal", fix: "prefrontal",
      fact: "occipital", concept: "occipital", knowledge: "occipital", research: "occipital",
      lesson: "temporal", improvement: "temporal", review: "temporal",
      event: "temporal", session: "temporal", episode: "temporal",
      decision: "frontal", architecture: "frontal", convention: "frontal",
      preference: "frontal", plan: "frontal", task: "frontal",
      summary: "parietal", core: "parietal",
    };

    const REGION_META = {
      prefrontal: { center: new THREE.Vector3(-45, 55, -55), label: "Prefrontal Cortex", color: 0x4a9eff },
      frontal:    { center: new THREE.Vector3(0, 25, -80),    label: "Frontal Lobe",       color: 0x38cc80 },
      parietal:   { center: new THREE.Vector3(60, 15, 10),    label: "Parietal Lobe",      color: 0xfb923c },
      temporal:   { center: new THREE.Vector3(-55, -15, 55),  label: "Temporal Lobe",      color: 0xa78bfa },
      occipital:  { center: new THREE.Vector3(25, -5, 90),    label: "Occipital Lobe",     color: 0x34d399 },
    };

    function getRegion(node) {
      const s = node.supertype;
      if (s && TYPE_REGION[s]) return s;
      return TYPE_REGION[node.type || "unknown"] || "frontal";
    }

    const regionNodes = {};
    for (const node of data) {
      if (!node) continue;
      const r = getRegion(node);
      if (!regionNodes[r]) regionNodes[r] = [];
      regionNodes[r].push(node);
    }

    const scale = 2.5;
    this._brainScale = scale;
    this._brainNodeRegions = new Map();
    this._brainRegionCentroids = {};
    this._brainRegionLabels = {};

    for (const [region, nodes] of Object.entries(regionNodes)) {
      const info = REGION_META[region] || REGION_META.frontal;
      const center = info.center.clone().multiplyScalar(scale);
      this._brainRegionCentroids[region] = center;
      const count = nodes.length;
      const radius = Math.max(15, Math.sqrt(count) * 6);

      const label = createTextSprite(info.label, info.color, true);
      label.position.set(center.x, center.y + 50, center.z);
      this.scene.add(label);
      this.regionObjects.push(label);
      this._brainRegionLabels[region] = label;

      nodes.forEach((node, idx) => {
        this._brainNodeRegions.set(node.id, region);
        const localPos = fibonacciSphere(idx, count, radius);
        const pos = new THREE.Vector3().copy(center).add(localPos);
        this.nodePositions.set(node.id, pos);
        this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));
      });
    }

    // Load brain mesh as transparent overlay, then reposition nodes to actual centroids
    this.loadBrainMesh().then(group => {
      if (!group || this.layoutMode !== "brain") return;
      group.scale.set(scale, scale, scale);
      this.scene.add(group);
      this.brainMeshGroup = group;

      const actualCentroids = {};
      for (const child of group.children) {
        if (!child.isMesh) continue;
        const posAttr = child.geometry.attributes.position;
        if (!posAttr) continue;
        const vertCount = posAttr.count;
        const vc = new THREE.Vector3();
        for (let i = 0; i < vertCount; i++) {
          vc.x += posAttr.getX(i);
          vc.y += posAttr.getY(i);
          vc.z += posAttr.getZ(i);
        }
        vc.divideScalar(vertCount);
        vc.multiplyScalar(scale);
        actualCentroids[child.name] = vc;
      }

      const updatedPositions = new Map();

      for (const obj of this.nodeObjects) {
        const nodeId = obj.userData.nodeId;
        if (!nodeId) continue;
        const region = this._brainNodeRegions.get(nodeId);
        if (!region) continue;
        const actual = actualCentroids[region];
        const hardcoded = this._brainRegionCentroids[region];
        if (!actual || !hardcoded) continue;

        let newPos;
        if (obj.isMesh) {
          const offset = obj.position.clone().sub(hardcoded);
          if (offset.length() > 80) offset.setLength(80);
          newPos = actual.clone().add(offset);
          obj.position.copy(newPos);
        } else if (obj.isSprite) {
          const meshPos = updatedPositions.get(nodeId) || this.nodePositions.get(nodeId);
          if (meshPos) {
            const size = getNodeSize(obj.userData.nodeData);
            newPos = meshPos.clone();
            newPos.y += size + 5;
            obj.position.copy(newPos);
          }
          continue;
        } else {
          continue;
        }
        updatedPositions.set(nodeId, newPos);
      }

      // Sync all nodePositions
      for (const [id, pos] of updatedPositions) {
        this.nodePositions.set(id, pos);
      }

      // Overlap resolution — 5 push-apart passes within each region
      for (let pass = 0; pass < 5; pass++) {
        for (const region of Object.keys(actualCentroids)) {
          const ids = [];
          for (const [id, r] of this._brainNodeRegions) {
            if (r === region) ids.push(id);
          }
          for (let i = 0; i < ids.length; i++) {
            const pi = this.nodePositions.get(ids[i]);
            if (!pi) continue;
            for (let j = i + 1; j < ids.length; j++) {
              const pj = this.nodePositions.get(ids[j]);
              if (!pj) continue;
              const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
              const distSq = dx * dx + dy * dy + dz * dz;
              const minDist = 20;
              if (distSq < minDist * minDist && distSq > 0.01) {
                const dist = Math.sqrt(distSq);
                const push = (minDist - dist) * 0.4;
                const nx = dx / dist, ny = dy / dist, nz = dz / dist;
                pi.x += nx * push;
                pi.y += ny * push;
                pi.z += nz * push;
                pj.x -= nx * push;
                pj.y -= ny * push;
                pj.z -= nz * push;
              }
            }
          }
        }
      }

      // Sync meshes + sprites to resolved positions
      for (const obj of this.nodeObjects) {
        const nodeId = obj.userData.nodeId;
        if (!nodeId) continue;
        const pos = this.nodePositions.get(nodeId);
        if (!pos) continue;
        if (obj.isMesh) {
          obj.position.copy(pos);
        } else if (obj.isSprite) {
          const size = getNodeSize(obj.userData.nodeData);
          obj.position.set(pos.x, pos.y + size + 5, pos.z);
        }
      }

      // Reposition region labels to actual centroids
      for (const [region, label] of Object.entries(this._brainRegionLabels)) {
        const actual = actualCentroids[region];
        if (actual) label.position.set(actual.x, actual.y + 50, actual.z);
      }

      this._syncEdges();

      this._spherical.radius = 250;
      this._target.set(0, 0, 0);
      this._updateCamera();
    });

    this.shellRadii = {};
  }

  _createNodeMeshes(data) {
    for (const node of data) {
      if (!node) continue;
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;

      const size = getNodeSize(node);
      const customType = node.metadata?.customType;
      let color, shape;

      if (customType && CUSTOM_TYPE_COLORS[customType]) {
        color = CUSTOM_TYPE_COLORS[customType];
        shape = CUSTOM_TYPE_SHAPES[customType] ?? "sphere";
      } else if (node.type && TYPE_COLORS[node.type]) {
        color = TYPE_COLORS[node.type];
        shape = TYPE_SHAPES[node.type] ?? "sphere";
      } else {
        color = LEVEL_COLORS[node.level] ?? 0x888888;
        shape = TYPE_SHAPES[node.type] ?? "sphere";
      }

      const geometry = getGeometry(shape, size);
      const material = new THREE.MeshPhongMaterial({
        color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.95,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pos);
      mesh.userData = { nodeId: node.id, nodeData: node };
      this.scene.add(mesh);
      this.nodeObjects.push(mesh);

      const label = createTextSprite(node.label || node.id.slice(0, 8), color);
      label.position.copy(pos);
      label.position.y += size + 5;
      label.userData = { nodeId: node.id, nodeData: node };
      this.scene.add(label);
      this.nodeObjects.push(label);
    }
  }

  buildEdges(linkData) {
    const seen = new Set();
    linkData.forEach(link => {
      const key = `${link.source}-${link.target}`;
      if (seen.has(key)) return;
      seen.add(key);

      const sp = this.nodePositions.get(link.source);
      const tp = this.nodePositions.get(link.target);
      if (!sp || !tp) return;

      const isParent = link.type === "parent";
      const color = isParent ? 0x4a9eff : 0x666666;
      const opacity = isParent ? 0.4 : 0.2;

      const g = new THREE.BufferGeometry().setFromPoints([sp, tp]);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const line = new THREE.Line(g, m);
      line.userData = { source: link.source, target: link.target, edgeType: link.type };
      this.scene.add(line);
      this.edgeObjects.push(line);
    });
  }

  buildTemporalEdges(edgeData) {
    if (!edgeData || edgeData.length === 0) return;
    const seen = new Set();
    const TEMPORAL_EDGE_STYLES = {
      NEXT:            { color: 0x22c55e, opacity: 0.6, dashSize: 0, gapSize: 0 },
      DURING_SESSION:  { color: 0x3b82f6, opacity: 0.4, dashSize: 8, gapSize: 4 },
      CAUSAL:          { color: 0xef4444, opacity: 0.7, dashSize: 0, gapSize: 0 },
      REFERENCES:      { color: 0xeab308, opacity: 0.4, dashSize: 6, gapSize: 6 },
      RELATED_TO:      { color: 0xd946ef, opacity: 0.3, dashSize: 0, gapSize: 0 },
    };

    edgeData.forEach(edge => {
      const style = TEMPORAL_EDGE_STYLES[edge.edge_type] || { color: 0x888888, opacity: 0.2, dashSize: 0, gapSize: 0 };
      if (edge.source_node_id === edge.target_node_id) return;
      const key = `${edge.source_node_id}-${edge.target_node_id}-${edge.edge_type}`;
      if (seen.has(key)) return;
      seen.add(key);

      const sp = this.nodePositions.get(edge.source_node_id);
      const tp = this.nodePositions.get(edge.target_node_id);
      if (!sp || !tp) return;

      const g = new THREE.BufferGeometry().setFromPoints([sp, tp]);
      let line;
      if (style.dashSize > 0) {
        const m = new THREE.LineDashedMaterial({
          color: style.color, transparent: true, opacity: style.opacity,
          dashSize: style.dashSize, gapSize: style.gapSize,
        });
        line = new THREE.Line(g, m);
        line.computeLineDistances();
      } else {
        const m = new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity });
        line = new THREE.Line(g, m);
      }
      line.userData = { source: edge.source_node_id, target: edge.target_node_id, edgeType: edge.edge_type, isTemporal: true };
      this.scene.add(line);
      this.edgeObjects.push(line);
    });
    console.log(`[scene] Built ${edgeData.length} temporal edges (${this.edgeObjects.filter(o => o.userData.isTemporal).length} rendered)`);
  }

  _nudgeConnectedNodes(linkData, temporalEdgeData) {
    // Pre-simulation pass: move connected nodes closer together
    // and center each connected component
    const allEdges = [];
    if (linkData) linkData.forEach(e => allEdges.push([e.source, e.target]));
    if (temporalEdgeData) temporalEdgeData.forEach(e => allEdges.push([e.source_node_id, e.target_node_id]));
    if (allEdges.length === 0) return;

    // Find connected components via BFS
    const adj = new Map();
    for (const [a, b] of allEdges) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }

    const visited = new Set();
    const allIds = Array.from(this.nodePositions.keys());

    for (const startId of allIds) {
      if (visited.has(startId)) continue;
      if (!adj.has(startId)) { visited.add(startId); continue; }

      // BFS component
      const component = [];
      const queue = [startId];
      visited.add(startId);
      while (queue.length > 0) {
        const id = queue.shift();
        component.push(id);
        for (const nb of adj.get(id) || []) {
          if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
        }
      }
      if (component.length < 2) continue;

      // Compute component centroid
      let cx = 0, cy = 0, cz = 0;
      for (const id of component) {
        const p = this.nodePositions.get(id);
        if (p) { cx += p.x; cy += p.y; cz += p.z; }
      }
      cx /= component.length; cy /= component.length; cz /= component.length;

      // Pull nodes toward centroid
      for (const id of component) {
        const p = this.nodePositions.get(id);
        if (!p) continue;
        const dx = cx - p.x, dy = cy - p.y, dz = cz - p.z;
        p.x += dx * 0.3;
        p.y += dy * 0.3;
        p.z += dz * 0.3;
      }
    }
  }

  runSimulation(iterations, linkData, temporalEdgeData) {
    const ids = Array.from(this.nodePositions.keys());
    const radii = this.shellRadii || {};

    if (ids.length === 0) return;

    // Pre-simulation: nudge connected nodes together
    this._nudgeConnectedNodes(linkData, temporalEdgeData);

    const nodeLevels = new Map();
    const nodeSizes = new Map();
    for (const id of ids) {
      const mesh = this.nodeObjects.find(o => o.isMesh && o.userData.nodeId === id);
      nodeLevels.set(id, mesh?.userData?.nodeData?.level ?? 3);
      nodeSizes.set(id, mesh?.userData?.nodeData ? getNodeSize(mesh.userData.nodeData) : 3);
    }

    for (let iter = 0; iter < iterations; iter++) {
      const t = iter / iterations;
      const cooling = 1 - t;

      // --- Repulsive forces (distance-capped O(n²) with grid acceleration) ---
      // Compute bounding box and build grid cells
      let min = Infinity, max = -Infinity;
      for (const id of ids) {
        const p = this.nodePositions.get(id);
        if (!p) continue;
        if (p.x < min) min = p.x; if (p.x > max) max = p.x;
        if (p.y < min) min = p.y; if (p.y > max) max = p.y;
        if (p.z < min) min = p.z; if (p.z > max) max = p.z;
      }
      const cellSize = 80;
      const grid = new Map();
      const toCell = (v) => Math.floor((v - min) / cellSize);
      for (const id of ids) {
        const p = this.nodePositions.get(id);
        if (!p) continue;
        const key = `${toCell(p.x)},${toCell(p.y)},${toCell(p.z)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(id);
      }

      for (const id of ids) {
        const pos = this.nodePositions.get(id);
        const vel = this.nodeVelocities.get(id);
        if (!pos || !vel) continue;
        const lvl = nodeLevels.get(id) ?? 3;
        const k = 80 + lvl * 10;
        const cx = toCell(pos.x), cy = toCell(pos.y), cz = toCell(pos.z);

        // Check neighboring cells (3x3x3 neighborhood)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const cell = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!cell) continue;
              for (const oid of cell) {
                if (oid === id) continue;
                const op = this.nodePositions.get(oid);
                if (!op) continue;
                const ddx = pos.x - op.x, ddy = pos.y - op.y, ddz = pos.z - op.z;
                const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
                if (distSq > 40000) continue; // skip beyond ~200 units
                const dist = Math.sqrt(distSq) || 1;
                const f = (k * k) / dist * cooling;
                vel.x += (ddx / dist) * f * 0.015;
                vel.y += (ddy / dist) * f * 0.015;
                vel.z += (ddz / dist) * f * 0.015;
              }
            }
          }
        }
      }

      // --- Spring forces along edges ---
      const applySpringForces = (edges, sourceKey, targetKey) => {
        for (const edge of edges) {
          const sp = this.nodePositions.get(edge[sourceKey]);
          const tp = this.nodePositions.get(edge[targetKey]);
          if (!sp || !tp) continue;
          const dx = tp.x - sp.x, dy = tp.y - sp.y, dz = tp.z - sp.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const lvlA = nodeLevels.get(edge[sourceKey]) ?? 3;
          const lvlB = nodeLevels.get(edge[targetKey]) ?? 3;
          const szA = nodeSizes.get(edge[sourceKey]) ?? 3;
          const szB = nodeSizes.get(edge[targetKey]) ?? 3;
          const restLen = (szA + szB) * 6 + (lvlA + lvlB) * 4;
          const f = (dist - restLen) * 0.12;
          const sv = this.nodeVelocities.get(edge[sourceKey]);
          const tv = this.nodeVelocities.get(edge[targetKey]);
          if (!sv || !tv) continue;
          sv.x += (dx / dist) * f * 0.015;
          sv.y += (dy / dist) * f * 0.015;
          sv.z += (dz / dist) * f * 0.015;
          tv.x -= (dx / dist) * f * 0.015;
          tv.y -= (dy / dist) * f * 0.015;
          tv.z -= (dz / dist) * f * 0.015;
        }
      };

      if (linkData) applySpringForces(linkData, "source", "target");
      if (temporalEdgeData) applySpringForces(temporalEdgeData, "source_node_id", "target_node_id");

      // --- Shell constraint (gentle centering) ---
      const shellMultiplier = this.layoutMode === "shell" ? 1.0 :
                              this.layoutMode === "type-cluster" ? 0.15 :
                              this.layoutMode === "brain" ? 0 : 0.03;
      const forceTargetRadius = 400;
      for (const id of ids) {
        const pos = this.nodePositions.get(id);
        const vel = this.nodeVelocities.get(id);
        if (!pos || !vel) continue;
        const lvl = nodeLevels.get(id) ?? 3;
        const targetRadius = this.layoutMode === "shell" ? (radii[lvl] ?? 120) : forceTargetRadius;
        const curDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 1;

        const shellForce = (targetRadius - curDist) * 0.008 * (0.5 + cooling * 0.5) * shellMultiplier;
        vel.x += (pos.x / curDist) * shellForce;
        vel.y += (pos.y / curDist) * shellForce;
        vel.z += (pos.z / curDist) * shellForce;

        // Damping
        vel.x *= 0.82; vel.y *= 0.82; vel.z *= 0.82;

        // Clamp velocity
        const maxStep = 6 * cooling + 0.5;
        vel.x = Math.max(-maxStep, Math.min(maxStep, vel.x));
        vel.y = Math.max(-maxStep, Math.min(maxStep, vel.y));
        vel.z = Math.max(-maxStep, Math.min(maxStep, vel.z));

        pos.add(vel);

        // Hard clamp to max radius
        const maxRadius = this.layoutMode === "shell"
          ? Math.max(targetRadius + 80, targetRadius * 1.35)
          : forceTargetRadius * 1.5;
        const newDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 1;
        if (newDist > maxRadius) {
          const scale = maxRadius / newDist;
          pos.x *= scale; pos.y *= scale; pos.z *= scale;
        }
      }
    }

    // --- Post-simulation: prevent overlap ---
    for (let pass = 0; pass < 3; pass++) {
      for (const id of ids) {
        const pos = this.nodePositions.get(id);
        if (!pos) continue;
        const szA = nodeSizes.get(id) ?? 3;
        const minDist = szA * 3;

        for (const oid of ids) {
          if (oid === id) continue;
          const op = this.nodePositions.get(oid);
          if (!op) continue;
          const dx = pos.x - op.x, dy = pos.y - op.y, dz = pos.z - op.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < minDist * minDist && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const push = (minDist - dist) * 0.3;
            pos.x += (dx / dist) * push;
            pos.y += (dy / dist) * push;
            pos.z += (dz / dist) * push;
          }
        }
      }
    }

    this.nodeObjects.forEach(obj => {
      if (obj.userData.nodeId) {
        const pos = this.nodePositions.get(obj.userData.nodeId);
        if (pos) {
          obj.position.copy(pos);
          if (obj.isSprite && obj.userData.nodeData) {
            obj.position.y += getNodeSize(obj.userData.nodeData) + 5;
          }
        }
      }
    });

    this._syncEdges();
  }

  _syncEdges() {
    this.edgeObjects.forEach(line => {
      const s = this.nodePositions.get(line.userData.source);
      const t = this.nodePositions.get(line.userData.target);
      if (s && t) {
        const arr = line.geometry.attributes.position.array;
        arr[0] = s.x; arr[1] = s.y; arr[2] = s.z;
        arr[3] = t.x; arr[4] = t.y; arr[5] = t.z;
        line.geometry.attributes.position.needsUpdate = true;
      }
    });
  }

  updateVisibility(filterEngine) {
    const filtered = filterEngine.apply(nodeData);
    const filteredIds = new Set(filtered.map(n => n.id));

    let visibleCount = 0;
    this.nodeObjects.forEach(obj => {
      if (!obj.userData.nodeId) return;
      const v = filteredIds.has(obj.userData.nodeId);
      obj.visible = v;
      if (v && obj.isMesh) visibleCount++;
    });

    this.edgeObjects.forEach(line => {
      line.visible = filteredIds.has(line.userData.source) && filteredIds.has(line.userData.target);
    });

    console.log(`[scene] Visibility: ${visibleCount}/${this.nodeObjects.filter(o => o.isMesh).length} meshes visible (${filtered.length} nodes in list)`);
    buildNodeList();
  }

  focusOnNode(nodeId) {
    const mesh = this.nodeObjects.find(o => o.isMesh && o.userData.nodeId === nodeId);
    if (!mesh) return;

    this.selectedNode = mesh;
    this._updateHighlight();
    showDetailPanel(mesh.userData.nodeData);
    buildNodeList();

    const target = mesh.position.clone();
    const size = getNodeSize(mesh.userData.nodeData);
    const offset = size * 4 + 30;
    this._animateCamera(target, offset);
  }

  _animateCamera(target, offset) {
    const start = this.camera.position.clone();
    const end = new THREE.Vector3(target.x + offset * 0.5, target.y + offset * 0.3, target.z + offset);
    const duration = 600;
    const startTime = performance.now();

    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(start, end, ease);
      this.camera.lookAt(target);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // Update orbit target to node position and recalc spherical state
        this._target.copy(target);
        const dx = end.x - this._target.x;
        const dy = end.y - this._target.y;
        const dz = end.z - this._target.z;
        this._spherical.radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this._spherical.theta = Math.atan2(dz, dx);
        this._spherical.phi = Math.acos(Math.max(-1, Math.min(1, dy / (this._spherical.radius || 1))));
      }
    };

    requestAnimationFrame(step);
  }

  render() {
    this._updateMovement();
    this.nodeObjects.forEach(obj => {
      if (obj.isMesh && obj.userData.nodeData) {
        obj.rotation.y += 0.002;
        obj.rotation.x += 0.001;
      }
    });
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const container = document.getElementById("main-content") || document.body;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}

// ==================== Globals ====================

let filterEngine;
let sceneCtrl;
let nodeData = [];
let linkData = [];
let temporalEdgeData = [];
let statsData = null;
let editingNode = null;
let currentScope = "project";
let currentProject = "";
let availableScopes = [];
let currentLayoutMode = "shell";

let graphViz = null;
let graphData = null;
let _graphAnalysis = null;

// ==================== Init ====================

function init() {
  filterEngine = new NodeFilterEngine();
  sceneCtrl = new SceneController();

  // Wire filter engine to trigger view updates
  filterEngine.onUpdate = () => {
    sceneCtrl.updateVisibility(filterEngine);
  };

  graphViz = new GraphViz("graph-viz-container");
  setupGraphListeners();

  setupEventListeners();
  loadData();
}

// ==================== Event Setup ====================

function setupEventListeners() {
  window.addEventListener("resize", () => sceneCtrl.resize());

  document.getElementById("search-input").addEventListener("input", (e) => {
    filterEngine.setSearchQuery(e.target.value);
    filterEngine.setServerSearchIds(null);
    filterEngine.changed();
  });

  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (filterEngine.searchMode === "text") {
        filterEngine.changed();
      } else {
        performServerSearch(filterEngine.searchQuery);
      }
    }
  });

  document.getElementById("close-detail").addEventListener("click", () => {
    document.getElementById("detail-panel").classList.remove("open");
    sceneCtrl.selectedNode = null;
    editingNode = null;
    sceneCtrl._updateHighlight();
  });

  document.getElementById("edit-node").addEventListener("click", () => {
    if (sceneCtrl.selectedNode && sceneCtrl.selectedNode.userData.nodeData) {
      toggleEditMode(sceneCtrl.selectedNode.userData.nodeData);
    }
  });

  document.getElementById("delete-node").addEventListener("click", () => {
    if (sceneCtrl.selectedNode && sceneCtrl.selectedNode.userData.nodeData) {
      deleteNode(sceneCtrl.selectedNode.userData.nodeData);
    }
  });

  document.getElementById("inject-node").addEventListener("click", () => {
    if (sceneCtrl.selectedNode && sceneCtrl.selectedNode.userData.nodeData) {
      injectNode(sceneCtrl.selectedNode.userData.nodeData);
    }
  });

  document.getElementById("toggle-sidebar").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.toggle("sidebar-collapsed");
  });

  // Consolidated filter button handler
  document.getElementById("sidebar").addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
    if (!btn) return;

    if (btn.dataset.selectAll !== undefined) {
      const category = btn.dataset.selectAll;
      filterEngine.toggleAll(category);
      const container = btn.parentElement;
      const set = filterEngine._getSet(category);
      const allSelected = set && set.size > 0;
      container.querySelectorAll(".filter-btn:not(.select-all-btn)").forEach(b => {
        const val = b.dataset.level !== undefined ? parseInt(b.dataset.level) :
                    b.dataset.type || b.dataset.customType || b.dataset.shape || b.dataset.project;
        if (val === undefined) return;
        b.classList.toggle("active", allSelected && set.has(val));
      });
      return;
    }

    if (btn.dataset.scope !== undefined) {
      const scope = btn.dataset.scope;
      if (scope === currentScope) return;
      currentScope = scope;
      document.querySelectorAll("#scope-filters .filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterEngine.clearAll();
      filterEngine.setSearchQuery("");
      filterEngine.setServerSearchIds(null);
      document.getElementById("search-input").value = "";
      document.getElementById("search-info").textContent = "";
      document.querySelectorAll(".filter-btn[data-level], .filter-btn[data-type], .filter-btn[data-custom-type], .filter-btn[data-shape]").forEach(b => b.classList.remove("active"));
      loadData();
    } else if (btn.dataset.level !== undefined) {
      filterEngine.toggleLevel(parseInt(btn.dataset.level));
      btn.classList.toggle("active");
    } else if (btn.dataset.type !== undefined) {
      filterEngine.toggleType(btn.dataset.type);
      btn.classList.toggle("active");
    } else if (btn.dataset.customType !== undefined) {
      filterEngine.toggleCustomType(btn.dataset.customType);
      btn.classList.toggle("active");
    } else if (btn.dataset.shape !== undefined) {
      filterEngine.toggleShape(btn.dataset.shape);
      btn.classList.toggle("active");
    } else if (btn.dataset.project !== undefined) {
      filterEngine.toggleProject(btn.dataset.project);
      btn.classList.toggle("active");
    }
  });

  // Clear all filters button
  document.getElementById("clear-filters").addEventListener("click", () => {
    filterEngine.clearAll();
    filterEngine.setSearchQuery("");
    filterEngine.setServerSearchIds(null);

    document.querySelectorAll(".filter-btn[data-level], .filter-btn[data-type], .filter-btn[data-custom-type], .filter-btn[data-shape]").forEach(b => b.classList.remove("active"));
    document.getElementById("search-input").value = "";
    document.getElementById("search-info").textContent = "";
    document.getElementById("project-dropdown").value = "";
    sceneCtrl.updateVisibility(filterEngine);
  });

  // Select all filters button
  document.getElementById("select-all-filters").addEventListener("click", () => {
    filterEngine.selectAll();
    document.querySelectorAll(".filter-btn[data-level], .filter-btn[data-type], .filter-btn[data-custom-type], .filter-btn[data-shape], .select-all-btn").forEach(b => b.classList.add("active"));
    document.getElementById("search-input").value = "";
    document.getElementById("search-info").textContent = "";
    document.getElementById("project-dropdown").value = "";
  });

  // Project dropdown
  document.getElementById("project-dropdown").addEventListener("change", (e) => {
    currentProject = e.target.value;
    filterEngine.projects.clear();
    if (currentProject) filterEngine.projects.add(currentProject);
    sceneCtrl.updateVisibility(filterEngine);
  });

  // Search mode toggles
  document.querySelectorAll(".search-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".search-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterEngine.setSearchMode(btn.dataset.mode);
      filterEngine.setServerSearchIds(null);
      const info = document.getElementById("search-info");
      if (filterEngine.searchMode === "text") {
        info.textContent = "";
      } else if (filterEngine.searchMode === "embedding") {
        info.textContent = "Semantic search via embeddings \u2014 type query and press Search";
      } else if (filterEngine.searchMode === "bm25") {
        info.textContent = "Full-text search via BM25 index \u2014 type query and press Search";
      }
      sceneCtrl.updateVisibility(filterEngine);
    });
  });

  // Search button
  document.getElementById("search-btn").addEventListener("click", () => {
    if (filterEngine.searchMode === "text") {
      sceneCtrl.updateVisibility(filterEngine);
    } else {
      performServerSearch(filterEngine.searchQuery);
    }
  });

  // Layout buttons
  document.getElementById("sidebar").addEventListener("click", (e) => {
    const btn = e.target.closest(".layout-btn");
    if (!btn) return;
    const layout = btn.dataset.layout;
    if (layout === currentLayoutMode) return;
    currentLayoutMode = layout;
    document.querySelectorAll(".layout-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    reLayout();
  });

  // Legend popover toggle
  const legendToggle = document.getElementById("legend-toggle-btn");
  if (legendToggle) {
    legendToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const popover = document.getElementById("legend-popover");
      popover.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      const popover = document.getElementById("legend-popover");
      if (popover && !e.target.closest("#legend-section")) {
        popover.classList.remove("open");
      }
    });
  }

  // Node list click
  document.getElementById("node-list").addEventListener("click", (e) => {
    const item = e.target.closest(".node-list-item");
    if (!item) return;
    sceneCtrl.focusOnNode(item.dataset.nodeId);
  });

  // Tab buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      const isVisualize = tab === "visualize";
      const isGraph = tab === "graph";
      const isLiveAgent = tab === "live-agent";
      const isLiveMetrics = tab === "live-metrics";
      const isFullscreenTab = isVisualize || isGraph;
      const isLiveTab = isLiveAgent || isLiveMetrics;
      const sidebar = document.getElementById("sidebar");
      const mainContent = document.getElementById("main-content");
      const visualizePanel = document.getElementById("visualize-panel");
      const graphSidebarPanel = document.getElementById("graph-sidebar-panel");
      const settingsPanel = document.getElementById("settings-panel");
      const contextPanel = document.getElementById("context-panel");
      const backupPanel = document.getElementById("backup-panel");
      const qualityPanel = document.getElementById("quality-panel");
      const compressPanel = document.getElementById("compress-panel");
      const tokensPanel = document.getElementById("tokens-panel");
      const graphPanel = document.getElementById("graph-panel");
      const canvasContainer = document.getElementById("canvas-container");
      const graphVizContainer = document.getElementById("graph-viz-container");

      // Sidebar collapse: full sidebar for visualize and graph tabs
      if (sidebar) sidebar.classList.toggle("sidebar-collapsed", !isFullscreenTab);
      if (mainContent) mainContent.classList.toggle("tab-content", !isFullscreenTab);

      // Sidebar panels
      if (visualizePanel) visualizePanel.classList.toggle("active", isVisualize);
      if (graphSidebarPanel) graphSidebarPanel.style.display = isGraph ? "block" : "none";

      // Main-content panels (hidden for fullscreen tabs)
      const panelMap = { settings: settingsPanel, context: contextPanel, backup: backupPanel, quality: qualityPanel, compress: compressPanel, tokens: tokensPanel, graph: graphPanel, "live-agent": document.getElementById("live-agent-panel"), "live-metrics": document.getElementById("live-metrics-panel") };
      for (const [key, p] of Object.entries(panelMap)) {
        if (p) p.classList.toggle("active", key === tab && (isLiveTab || !isFullscreenTab));
      }

      // Canvas/visualization visibility
      if (canvasContainer) canvasContainer.style.display = isVisualize ? "block" : "none";
      if (graphVizContainer) graphVizContainer.classList.toggle("active", isGraph);

      if (tab === "settings") loadSettings();
      if (tab === "backup") { loadBackupSources(); loadBackupList(); }
      if (tab === "context") loadContextDashboard();
      if (tab === "quality") loadQuality();
      if (tab === "compress") loadCompressStats();
      if (tab === "tokens") loadTokenHistory();
      if (tab === "graph") loadGraphData();
      if (tab === "live-agent") { startLiveAgentPolling(); }
      if (tab === "live-metrics") { startLiveMetricsPolling(); }
      if (!isLiveTab && !isFullscreenTab) { stopLiveAgentPolling(); stopLiveMetricsPolling(); }
    });
  });
}

// ==================== Re-Layout ====================

function reLayout() {
  if (!nodeData || nodeData.length === 0) return;
  sceneCtrl.clear();
  sceneCtrl.buildFromData(nodeData, currentLayoutMode);
  sceneCtrl.buildEdges(linkData);
  sceneCtrl.buildTemporalEdges(temporalEdgeData);
  sceneCtrl.runSimulation(200, linkData, temporalEdgeData);
  sceneCtrl.updateVisibility(filterEngine);
}

// ==================== Data Loading ====================

async function loadData() {
  try {
    const [scopesRes, nodesRes, linksRes, temporalRes, statsRes, versionRes] = await Promise.all([
      fetch("/api/scopes"),
      fetch(`/api/nodes?scope=${currentScope}`),
      fetch(`/api/links?scope=${currentScope}`),
      fetch(`/api/temporal-edges?scope=${currentScope}`),
      fetch(`/api/stats?scope=${currentScope}`),
      fetch("/api/version"),
    ]);

    if (!nodesRes.ok || !linksRes.ok || !statsRes.ok) {
      throw new Error(`API error: nodes=${nodesRes.status}, links=${linksRes.status}, stats=${statsRes.status}`);
    }

    availableScopes = await scopesRes.json();
    nodeData = await nodesRes.json();
    linkData = await linksRes.json();
    temporalEdgeData = temporalRes.ok ? await temporalRes.json() : [];
    statsData = await statsRes.json();
    const versionData = await versionRes.json();
    document.getElementById("version").textContent = `v${versionData.version}`;

    document.getElementById("loading").style.display = "none";

    console.log(`[data] Scope=${currentScope} nodes=${nodeData.length} links=${linkData.length} temporalEdges=${temporalEdgeData.length} stats=${JSON.stringify({ total: statsData.totalNodes, levels: Object.keys(statsData.nodesPerLevel || {}), types: Object.keys(statsData.nodesPerType || {}), shapes: Object.keys(statsData.nodesPerShape || {}), customTypes: Object.keys(statsData.nodesPerCustomType || {}) })}`);

    if (nodeData.length > 0) {
      console.log(`[data] Sample node:`, { id: nodeData[0].id, label: nodeData[0].label, level: nodeData[0].level, type: nodeData[0].type, importance: nodeData[0].importance, customType: nodeData[0].metadata?.customType });
    }

    try {
      sceneCtrl.buildFromData(nodeData, currentLayoutMode);
      sceneCtrl.buildEdges(linkData);
      sceneCtrl.buildTemporalEdges(temporalEdgeData);
      sceneCtrl.runSimulation(300, linkData, temporalEdgeData);
    } catch (vizErr) {
      console.error("[viewer] Visualization error:", vizErr);
    }

    try {
      buildUI();
    } catch (uiErr) {
      console.error("[viewer] UI build error:", uiErr);
    }

    sceneCtrl.updateVisibility(filterEngine);
  } catch (err) {
    console.error("[viewer] Load error:", err);
    document.getElementById("loading").textContent = `Error: ${err.message}. Is the server running?`;
    document.getElementById("loading").style.display = "block";
  }
}

// ==================== Layout Helpers ====================

function fibonacciSphere(index, count, radius) {
  if (count <= 1) return new THREE.Vector3(0, 0, 0);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (count - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = goldenAngle * index;
  return new THREE.Vector3(
    r * Math.cos(theta) * radius,
    y * radius,
    r * Math.sin(theta) * radius
  );
}

function computeShellRadii(levelCounts) {
  const sortedLevels = Object.keys(levelCounts).map(Number).sort((a, b) => a - b);
  if (sortedLevels.length === 0) return {};
  const maxCount = Math.max(...sortedLevels.map(l => levelCounts[l]));
  const baseRadius = Math.max(60, Math.sqrt(maxCount) * 12);
  const radii = {};
  sortedLevels.forEach((lvl, i) => {
    radii[lvl] = baseRadius * (1 + i * 0.7);
  });
  return radii;
}

// ==================== Visualization Helpers ====================

function getNodeSize(node) {
  const base = 3 + node.importance * 2;
  const accessBoost = Math.min(node.accessCount * 0.4, 8);
  return Math.max(3, Math.min(base + accessBoost, 24));
}

function getNodeShape(node) {
  const customType = node.metadata?.customType;
  if (customType && CUSTOM_TYPE_SHAPES[customType]) {
    return CUSTOM_TYPE_SHAPES[customType];
  }
  return TYPE_SHAPES[node.type] ?? "sphere";
}

function getGeometry(shape, size) {
  switch (shape) {
    case "box": return new THREE.BoxGeometry(size * 1.5, size * 1.5, size * 1.5);
    case "octahedron": return new THREE.OctahedronGeometry(size);
    case "dodecahedron": return new THREE.DodecahedronGeometry(size);
    case "icosahedron": return new THREE.IcosahedronGeometry(size);
    case "torus": return new THREE.TorusGeometry(size, size * 0.4, 16, 100);
    default: return new THREE.SphereGeometry(size, 16, 16);
  }
}

function createTextSprite(text, color, big = false) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = big ? 512 : 256;
  canvas.height = big ? 128 : 64;

  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = big ? "bold 36px Inter, sans-serif" : "bold 24px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Glow
  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.shadowColor = hex;
  ctx.shadowBlur = big ? 12 : 4;
  ctx.fillStyle = hex;
  ctx.fillText(text.length > 25 ? text.slice(0, 25) + "..." : text, big ? 256 : 128, big ? 64 : 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9 });
  const sprite = new THREE.Sprite(material);
  if (big) {
    sprite.scale.set(80, 20, 1);
  } else {
    sprite.scale.set(30, 7.5, 1);
  }
  return sprite;
}

// ==================== UI Builders ====================

function buildUI() {
  buildScopeButtons();
  buildStats();
  buildDashboardCharts();
  buildFilters();
  buildLegend();
  buildNodeList();
}

function buildScopeButtons() {
  const container = document.getElementById("scope-filters");
  container.innerHTML = availableScopes.map(s =>
    `<button class="filter-btn ${s.scope === currentScope ? 'active' : ''}" data-scope="${s.scope}">${s.scope}</button>`
  ).join("");
}

function buildStats() {
  if (!statsData) return;
  const container = document.getElementById("stats-container");

  // Token formatting
  const fmtTokens = (n) => {
    if (!n && n !== 0) return "";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  };

  const tokens = statsData.memoryTokens;
  const savings = statsData.compressionSavings;
  const ctxLimit = 128000;
  const ctxPct = tokens ? Math.round((tokens / ctxLimit) * 100) : 0;
  const ctxClass = ctxPct >= 85 ? "crit" : ctxPct >= 70 ? "high" : ctxPct >= 50 ? "warn" : "ok";

  let html = `<div class="mini-stats">`;
  html += `<span><strong>${statsData.totalNodes}</strong> nodes</span>`;
  if (tokens) html += `<span><strong>${fmtTokens(tokens)}</strong> tokens</span>`;
  if (savings !== undefined) html += `<span><strong>${savings}%</strong> saved</span>`;
  if (tokens) html += `<span class="stat-ctx ${ctxClass}">${ctxPct}% ctx</span>`;
  if (statsData.injectionCount) html += `<span><strong>${statsData.injectionCount}</strong> inj.</span>`;
  html += `<span><strong>${statsData.totalAccessCount}</strong> accesses</span>`;
  html += `</div>`;

  container.innerHTML = html;
}

function buildDashboardCharts() {
  if (!statsData) return;
  const container = document.getElementById("dashboard-charts-container");
  if (!container) return;

  // Color definitions
  const SUPERTYPE_COLORS = {
    declarative: "#4a9eff",   // blue
    procedural: "#34d399",    // green
    experiential: "#fb923c",  // orange
    meta: "#a78bfa",          // purple
  };

  const STRATUM_COLORS = {
    hot: "#ef4444",   // red
    warm: "#fbbf24",  // yellow
    cold: "#3b82f6",  // blue
  };

  // Helper to get max value for scaling
  const getMax = (obj) => Math.max(...Object.values(obj || {}));

  // Helper to create colored bar div
  const makeBar = (label, value, max, color) => {
    const pct = max > 0 ? (value / max) * 100 : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="flex:0 0 80px;font-size:11px;color:#888;">${label}</span>
      <span style="flex:1;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
        <div style="width:${pct}%;height:16px;background:${color};transition:width 0.3s;"></div>
      </span>
      <span style="flex:0 0 40px;font-size:11px;color:#fff;text-align:right;">${value}</span>
    </div>`;
  };

  // 1. Supertype distribution card
  const supertypeData = statsData.nodesPerSupertype || {};
  const supertypeMax = getMax(supertypeData);
  let supertypeHtml = "";
  Object.entries(supertypeData).forEach(([st, count]) => {
    supertypeHtml += makeBar(st, count, supertypeMax, SUPERTYPE_COLORS[st] || "#888", Object.values(supertypeData).reduce((a,b)=>a+b,0));
  });

  // 2. Tag cloud card
  const tagsData = statsData.tagsFrequency || {};
  const tagMax = getMax(tagsData);
  const tagEntries = Object.entries(tagsData).sort((a,b) => b[1]-a[1]).slice(0, 20);
  let tagHtml = "";
  tagEntries.forEach(([tag, count]) => {
    const size = Math.max(12, Math.min(36, 12 + (count / (tagMax || 1)) * 24));
    tagHtml += `<span style="display:inline-block;margin:2px 4px;font-size:${size}px;color:#aaa;cursor:pointer;" onclick="console.log('Tag clicked:', '${tag}')">${tag} <span style="font-size:10px;color:#666;">(${count})</span></span>`;
  });
  if (tagEntries.length === 0) tagHtml = '<div style="color:#666;font-size:12px;">No tags found</div>';

  // 3. Confidence histogram card
  const confidenceData = statsData.confidenceHistogram || {};
  const confMax = getMax(confidenceData);
  let confHtml = "";
  Object.entries(confidenceData).sort().forEach(([bucket, count]) => {
    confHtml += makeBar(bucket, count, confMax, "#d946ef", Object.values(confidenceData).reduce((a,b)=>a+b,0));
  });

  // 4. Stratum breakdown card
  const stratumData = statsData.stratumBreakdown || {};
  const stratumMax = getMax(stratumData);
  let stratumHtml = "";
  Object.entries(stratumData).forEach(([stratum, count]) => {
    stratumHtml += makeBar(stratum, count, stratumMax, STRATUM_COLORS[stratum] || "#888", Object.values(stratumData).reduce((a,b)=>a+b,0));
  });

  // Build the cards HTML
  const cardStyle = "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px;";
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="${cardStyle}">
        <h4 style="font-size:12px;color:#aaa;text-transform:uppercase;margin:0 0 10px 0;">Supertype Distribution</h4>
        ${supertypeHtml}
      </div>
      <div style="${cardStyle}">
        <h4 style="font-size:12px;color:#aaa;text-transform:uppercase;margin:0 0 10px 0;">Tag Cloud</h4>
        <div style="padding:8px 0;">${tagHtml}</div>
      </div>
      <div style="${cardStyle}">
        <h4 style="font-size:12px;color:#aaa;text-transform:uppercase;margin:0 0 10px 0;">Confidence Histogram</h4>
        ${confHtml}
      </div>
      <div style="${cardStyle}">
        <h4 style="font-size:12px;color:#aaa;text-transform:uppercase;margin:0 0 10px 0;">Stratum Breakdown</h4>
        ${stratumHtml}
      </div>
    </div>
  `;
}

function buildFilters() {
  if (!statsData) return;

  filterEngine.initFromStats(statsData);

  // Build compact badge summary for the accordion header
  const badgeLevels = Object.keys(statsData.nodesPerLevel || {}).map(Number).sort((a, b) => a - b);
  const badgeTypes = Object.keys(statsData.nodesPerType || {}).sort();
  const badgeShapes = Object.keys(statsData.nodesPerShape || {}).sort();
  const badgeParts = [];
  if (badgeLevels.length) badgeParts.push(badgeLevels.map(l => `L${l}:${statsData.nodesPerLevel[l]}`).join(' '));
  if (badgeTypes.length) badgeParts.push(`${badgeTypes.length} types`);
  if (badgeShapes.length) badgeParts.push(`${badgeShapes.length} shapes`);
  const badgeEl = document.getElementById("filters-badge");
  if (badgeEl) badgeEl.textContent = badgeParts.join(' · ');

  // Level filters
  const levels = Object.keys(statsData.nodesPerLevel || {}).map(Number).sort((a, b) => a - b);
  const levelContainer = document.getElementById("level-filters");
  levelContainer.innerHTML = `<button class="filter-btn select-all-btn" data-select-all="level">All</button>` +
    levels.map(l =>
      `<button class="filter-btn active" data-level="${l}">L${l} (${statsData.nodesPerLevel[l]})</button>`
    ).join("");

  // Type filters
  const types = Object.keys(statsData.nodesPerType || {}).sort();
  const typeContainer = document.getElementById("type-filters");
  typeContainer.innerHTML = `<button class="filter-btn select-all-btn" data-select-all="type">All</button>` +
    types.map(t =>
      `<button class="filter-btn active" data-type="${t}">${t} (${statsData.nodesPerType[t]})</button>`
    ).join("");

  // Custom type filters
  const customTypes = Object.keys(statsData.nodesPerCustomType || {}).sort();
  const customTypeContainer = document.getElementById("custom-type-filters");
  if (customTypeContainer) {
    customTypeContainer.innerHTML = `<button class="filter-btn select-all-btn" data-select-all="customType">All</button>` +
      customTypes.map(ct =>
        `<button class="filter-btn active" data-custom-type="${ct}">${ct} (${statsData.nodesPerCustomType[ct]})</button>`
      ).join("");
  }

  // Supertype filters (dropdown)
  const supertypes = Object.keys(statsData.nodesPerSupertype || {}).sort();
  const supertypeContainer = document.getElementById("supertype-filters");
  if (supertypeContainer) {
    supertypeContainer.innerHTML = `<select id="supertype-dropdown" class="config-field" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:#fff;font-size:12px;" onchange="filterEngine.supertypeFilter = this.value || null; filterEngine.changed();">
      <option value="">All Supertypes</option>
      ${supertypes.map(st => `<option value="${st}">${st} (${statsData.nodesPerSupertype[st]})</option>`).join("")}
    </select>`;
  }

  // Source filters (dropdown)
  const sources = Object.keys(statsData.nodesPerSource || {}).sort();
  const sourceContainer = document.getElementById("source-filters");
  if (sourceContainer) {
    sourceContainer.innerHTML = `<select id="source-dropdown" class="config-field" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:#fff;font-size:12px;" onchange="filterEngine.sourceFilter = this.value || null; filterEngine.changed();">
      <option value="">All Sources</option>
      ${sources.map(s => `<option value="${s}">${s} (${statsData.nodesPerSource[s]})</option>`).join("")}
    </select>`;
  }

  // Shape filters
  const shapes = Object.keys(statsData.nodesPerShape || {}).sort();
  const shapeContainer = document.getElementById("shape-filters");
  if (shapeContainer) {
    const shapeLabels = {
      sphere: "Sphere", box: "Box", octahedron: "Octahedron",
      dodecahedron: "Dodecahedron", icosahedron: "Icosahedron", torus: "Torus",
    };
    shapeContainer.innerHTML = `<button class="filter-btn select-all-btn" data-select-all="shape">All</button>` +
      shapes.map(s =>
        `<button class="filter-btn active" data-shape="${s}">${shapeLabels[s] || s} (${statsData.nodesPerShape[s]})</button>`
      ).join("");
  }

  // Project dropdown
  const projects = Object.keys(statsData.nodesPerProject || {}).sort();
  const dropdown = document.getElementById("project-dropdown");
  const projectSection = dropdown && dropdown.closest(".section");
  if (projects.length > 1 && projectSection) {
    projectSection.style.display = "block";
    dropdown.innerHTML = `<option value="">All Projects</option>` +
      projects.map(p =>
        `<option value="${p}">${p} (${statsData.nodesPerProject[p]})</option>`
      ).join("");
    dropdown.value = currentProject || "";
  }
}

function buildLegend() {
  if (!statsData) return;
  const popover = document.getElementById("legend-popover");
  if (!popover) return;
  let html = "";
  for (const [level, color] of Object.entries(LEVEL_COLORS)) {
    if (statsData.nodesPerLevel[level]) {
      const hex = "#" + color.toString(16).padStart(6, "0");
      html += `<div class="legend-item"><div class="legend-dot" style="background: ${hex}"></div><span class="legend-label">Level ${level}</span></div>`;
    }
  }
  html += `<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:8px 0;">`;
  html += `<div style="margin-bottom:6px; font-weight: 600; color: #aaa; font-size:11px;">Shapes by type:</div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #4a9eff; border-radius: 50%;"></div><span class="legend-label">Sphere = Note / Task / Session / Preference</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #4a9eff; border-radius: 2px;"></div><span class="legend-label">Box = Event / Episode / Architecture / Convention / Bug / Fix</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #34d399; clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);"></div><span class="legend-label">Octahedron = Fact / Concept / Knowledge / Research</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #a78bfa; clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);"></div><span class="legend-label">Dodecahedron = Lesson / Decision</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #f472b6; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);"></div><span class="legend-label">Icosahedron = Skill / Rule</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #ff8c00; border-radius: 50%;"></div><span class="legend-label">Torus (orange) = Playbook</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #ff6b6b; border-radius: 50%;"></div><span class="legend-label">Torus (red) = Middle-Term</span></div>`;
  html += `<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:8px 0;">`;
  html += `<div style="margin-bottom:6px; font-weight: 600; color: #aaa; font-size:11px;">Temporal Edges:</div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #22c55e; border-radius: 1px; flex-shrink: 0;"></div><span class="legend-label">NEXT (sequence)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #3b82f6; border-radius: 1px; border-top: 1px dashed #3b82f6;"></div><span class="legend-label">DURING_SESSION</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #ef4444; border-radius: 1px;"></div><span class="legend-label">CAUSAL (cause-effect)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #eab308; border-radius: 1px; border-top: 1px dotted #eab308;"></div><span class="legend-label">REFERENCES (label refs)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #d946ef; border-radius: 1px;"></div><span class="legend-label">RELATED_TO (related)</span></div>`;
  popover.innerHTML = html;
}

let sortField = "level";
let sortAsc = true;

const SORT_COMPARATORS = {
  level: (a, b) => a.level - b.level,
  importance: (a, b) => a.importance - b.importance,
  createdAt: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  updatedAt: (a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0),
  label: (a, b) => (a.label || "").localeCompare(b.label || ""),
  type: (a, b) => (a.type || "").localeCompare(b.type || ""),
  usefulnessScore: (a, b) => (a.usefulnessScore || 0) - (b.usefulnessScore || 0),
  accessCount: (a, b) => (a.accessCount || 0) - (b.accessCount || 0),
  confidence: (a, b) => (a.confidence || 0) - (b.confidence || 0),
};

function buildNodeList() {
  const container = document.getElementById("node-list");
  const countEl = document.getElementById("node-list-count");
  const filtered = filterEngine.apply(nodeData);

  countEl.textContent = `(${filtered.length})`;

  const cmp = SORT_COMPARATORS[sortField] || SORT_COMPARATORS.level;
  const sorted = [...filtered].sort((a, b) => sortAsc ? cmp(a, b) : cmp(b, a));

  container.innerHTML = sorted.map(node => {
    const isSelected = sceneCtrl.selectedNode && sceneCtrl.selectedNode.userData.nodeId === node.id;

    let customIndicator = "";
    if (node.metadata?.customType) {
      const ct = node.metadata.customType;
      if (ct === 'middle-term') {
        customIndicator = ' <span style="color: #ff6b6b; font-size: 10px;">[MT]</span>';
      } else {
        customIndicator = ` <span style="color: #ff6b6b; font-size: 10px;">[${ct}]</span>`;
      }
    }
    if (node.type === 'skill') {
      customIndicator += ' <span style="color: #fbbf24; font-size: 10px;">[SKILL]</span>';
    }
    if (node.type === 'playbook') {
      customIndicator += ' <span style="color: #ff8c00; font-size: 10px;">[PLAYBOOK]</span>';
    }

    return `
      <div class="node-list-item ${isSelected ? 'selected' : ''}" data-node-id="${node.id}">
        <div class="node-label">${escapeHtml(node.label || "Unnamed")}${customIndicator}</div>
        <div class="node-meta">L${node.level} · ${node.type || "unknown"} · imp: ${node.importance}</div>
      </div>
    `;
  }).join("");
}

// ==================== Detail Panel ====================

function showDetailPanel(node) {
  const panel = document.getElementById("detail-panel");
  const title = document.getElementById("detail-title");
  const content = document.getElementById("detail-content");

  title.textContent = node.label || "Unnamed Node";

  const created = new Date(node.createdAt).toLocaleString();
  const updated = new Date(node.updatedAt).toLocaleString();

  let metadataHtml = "";
  if (node.metadata && node.metadata.customType) {
    const meta = node.metadata;
    metadataHtml = `
      <div class="detail-section">
        <h4>Metadata (${escapeHtml(meta.customType)})</h4>
        <div class="stat-row"><span class="stat-label">Custom Type</span><span class="stat-value">${escapeHtml(meta.customType)}</span></div>
        ${meta.sessionId ? `<div class="stat-row"><span class="stat-label">Session ID</span><span class="stat-value" style="font-family: monospace; font-size: 11px;">${escapeHtml(meta.sessionId)}</span></div>` : ""}
        ${meta.contextTokens ? `<div class="stat-row"><span class="stat-label">Context Tokens</span><span class="stat-value">${meta.contextTokens}</span></div>` : ""}
        ${meta.compactionPrompt ? `<div class="detail-section"><h4>Compaction Prompt</h4><div class="content-full" style="max-height: 200px;">${escapeHtml(meta.compactionPrompt)}</div></div>` : ""}
      </div>
    `;
  }

  let skillHtml = "";
  if (node.type === 'skill') {
    const triggers = node.metadata?.triggers;
    const triggerHtml = triggers
      ? `<div class="stat-row"><span class="stat-label">Triggers</span><span class="stat-value">${Array.isArray(triggers) ? triggers.map(escapeHtml).join(', ') : escapeHtml(String(triggers))}</span></div>`
      : '';
    skillHtml = `
      <div class="detail-section">
        <h4>Skill Info</h4>
        <div class="stat-row"><span class="stat-label">Type</span><span class="stat-value" style="color: #fbbf24;">Skill</span></div>
        ${node.summary ? `<div class="stat-row"><span class="stat-label">Description</span><span class="stat-value">${escapeHtml(node.summary)}</span></div>` : ''}
        ${triggerHtml}
      </div>
    `;
  }

  let playbookHtml = "";
  if (node.type === 'playbook') {
    const steps = node.metadata?.steps;
    let stepsHtml = "";
    if (steps && Array.isArray(steps)) {
      stepsHtml = steps.map((s, i) => `
        <div style="padding: 6px 8px; margin-bottom: 4px; background: rgba(255,140,0,0.1); border-radius: 4px; border-left: 3px solid #ff8c00;">
          <div style="font-size: 12px; color: #ff8c00; font-weight: 600;">Step ${i + 1}: ${escapeHtml(s.description || s.toolName || "Unnamed")}</div>
          <div style="font-size: 11px; color: #aaa; margin-top: 2px;">Tool: ${escapeHtml(s.toolName || "none")}${s.critical ? ' <span style="color: #f44;">[CRITICAL]</span>' : ''}</div>
        </div>
      `).join("");
    } else {
      stepsHtml = '<div style="font-size: 12px; color: #888;">No steps defined in metadata</div>';
    }
    playbookHtml = `
      <div class="detail-section">
        <h4>Playbook Steps</h4>
        ${stepsHtml}
      </div>
    `;
  }

  content.innerHTML = `
    <div class="detail-section">
      <h4>ID</h4>
      <div class="detail-value" style="font-family: monospace; font-size: 11px;">${node.id}</div>
    </div>
    <div class="detail-section">
      <h4>Metrics</h4>
      <div class="stat-row"><span class="stat-label">Level</span><span class="stat-value">${node.level}</span></div>
      <div class="stat-row"><span class="stat-label">Type</span><span class="stat-value">${node.type || "none"}${node.metadata?.customType ? ' <span style="color: #ff6b6b;">[' + escapeHtml(node.metadata.customType) + ']</span>' : ""}</span></div>
      <div class="stat-row"><span class="stat-label">Supertype</span><span class="stat-value" style="text-transform: capitalize;">${node.supertype || "none"}</span></div>
      <div class="stat-row"><span class="stat-label">Importance</span><span class="stat-value">${node.importance}</span></div>
      <div class="stat-row"><span class="stat-label">Usefulness Score</span><span class="stat-value">${node.usefulnessScore}</span></div>
      <div class="stat-row"><span class="stat-label">Access Count</span><span class="stat-value">${node.accessCount}</span></div>
      <div class="stat-row"><span class="stat-label">Times Used</span><span class="stat-value">${node.timesUsed}</span></div>
      <div class="stat-row"><span class="stat-label">Times Helpful</span><span class="stat-value">${node.timesHelpful}</span></div>
      <div class="stat-row"><span class="stat-label">Confidence</span><span class="stat-value" id="confidence-value-${node.id}">${node.confidence}</span></div>
      <div class="stat-row"><span class="stat-label">Verifications</span><span class="stat-value">${node.verificationCount || 0}</span></div>
      <div class="stat-row"><span class="stat-label">Sticky</span><span class="stat-value">${node.sticky ? "Yes" : "No"}</span></div>
      <div class="stat-row"><span class="stat-label">Source</span>
        <span class="stat-value">
          <select id="source-select-${node.id}" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:#fff;font-size:12px;padding:2px 4px;" onchange="updateNodeSource('${node.id}', this.value)">
            ${["manual","tool_result","auto_extract","web_search","reflection","llm_compress"].map(s =>
              `<option value="${s}" ${(node.source || "auto") === s ? "selected" : ""}>${s}</option>`
            ).join("")}
          </select>
        </span>
      </div>
      <div class="stat-row"><span class="stat-label">Content Length</span><span class="stat-value">${node.contentLength} chars</span></div>
      <div class="stat-row"><span class="stat-label">Tags</span>
        <span class="stat-value" id="tags-display-${node.id}">
          ${(node.tags || []).map(t => `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;margin:1px 2px;background:#333;border-radius:3px;font-size:11px;">${escapeHtml(t)}<span style="cursor:pointer;color:#f44;font-size:10px;" onclick="removeTag('${node.id}','${escapeHtml(t)}')">x</span></span>`).join('')}
          <input id="tag-input-${node.id}" type="text" style="width:80px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.2);border-radius:3px;color:#fff;font-size:11px;padding:2px 4px;" placeholder="add tag" onkeydown="if(event.key==='Enter')addTag('${node.id}')">
          <span style="cursor:pointer;color:#4f4;font-size:14px;margin-left:2px;" onclick="addTag('${node.id}')">+</span>
        </span>
      </div>
      <div style="margin-top: 8px;"><button class="btn btn-sm" onclick="verifyNode('${node.id}')">✓ Verify</button></div>
    </div>
    ${metadataHtml}
    ${skillHtml}
    ${playbookHtml}
    ${(() => {
      const connected = temporalEdgeData.filter(e => e.source_node_id === node.id || e.target_node_id === node.id);
      if (connected.length === 0) return "";
      const edgeColors = { NEXT: "#22c55e", DURING_SESSION: "#3b82f6", CAUSAL: "#ef4444", REFERENCES: "#eab308", RELATED_TO: "#d946ef" };
      const edgeLabels = { NEXT: "Next", DURING_SESSION: "In Session", CAUSAL: "Causes", REFERENCES: "References", RELATED_TO: "Related" };
      return `<div class="detail-section">
        <h4>Temporal Connections (${connected.length})</h4>
        ${connected.map(e => {
          const isOutgoing = e.source_node_id === node.id;
          const otherLabel = isOutgoing ? e.target_label : e.source_label;
          const color = edgeColors[e.edge_type] || "#888";
          const label = edgeLabels[e.edge_type] || e.edge_type;
          const dir = isOutgoing ? "→" : "←";
          return `<div style="padding: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 8px; height: 2px; background: ${color}; flex-shrink: 0;"></span>
            <span style="color: ${color}; font-weight: 600;">${label}</span>
            <span>${dir}</span>
            <span>${escapeHtml(otherLabel || "(unnamed)")}</span>
            <span style="color: #666; font-size: 10px;">(c: ${e.confidence?.toFixed(2) || "1.00"})</span>
          </div>`;
        }).join("")}
      </div>`;
    })()}
    <div class="detail-section">
      <h4>Timestamps</h4>
      <div class="detail-value">Created: ${created}</div>
      <div class="detail-value">Updated: ${updated}</div>
    </div>
     <div class="detail-section">
       <h4>Content (${node.contentLength} chars)</h4>
       <div class="content-full">${escapeHtml(node.content)}</div>
     </div>
   `;

  panel.classList.add("open");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Edit / Delete / Inject ====================

function toggleEditMode(node) {
  if (editingNode && editingNode.id === node.id) {
    cancelEdit();
    return;
  }
  editingNode = node;
  showEditForm(node);
}

function showEditForm(node) {
  
  const title = document.getElementById("detail-title");
  const content = document.getElementById("detail-content");

  title.textContent = "Edit: " + (node.label || "Unnamed Node");

  const types = ["note", "event", "episode", "concept", "summary", "core", "improvement", "howto", "skill"];

  content.innerHTML = `
    <div class="edit-field">
      <label>Label</label>
      <input type="text" id="edit-label" value="${escapeHtml(node.label || "")}">
    </div>
    <div class="edit-field">
      <label>Type</label>
      <select id="edit-type">
        ${types.map(t => `<option value="${t}" ${node.type === t ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div class="edit-field">
      <label>Level</label>
      <input type="number" id="edit-level" value="${node.level}" min="0" max="10">
    </div>
    <div class="edit-field">
      <label>Importance</label>
      <input type="number" id="edit-importance" value="${node.importance}" min="0" max="10" step="0.1">
    </div>
    ${node.summary !== undefined ? `
    <div class="edit-field">
      <label>Summary</label>
      <input type="text" id="edit-summary" value="${escapeHtml(node.summary || "")}">
    </div>
    ` : ""}
    <div class="edit-field">
      <label>Content</label>
      <textarea id="edit-content" rows="12">${escapeHtml(node.content || "")}</textarea>
    </div>
    <div class="edit-field">
      <div class="checkbox-row">
        <input type="checkbox" id="edit-sticky" ${node.sticky ? "checked" : ""}>
        <label for="edit-sticky" style="margin: 0;">Sticky (prevent compression)</label>
      </div>
    </div>
    <div class="edit-actions">
      <button class="btn-save" id="save-node-btn">Save</button>
      <button class="btn-cancel" id="cancel-edit-btn">Cancel</button>
    </div>
    <div id="edit-status" style="margin-top: 8px; font-size: 12px; text-align: center;"></div>
  `;

  document.getElementById("save-node-btn").addEventListener("click", saveNode);
  document.getElementById("cancel-edit-btn").addEventListener("click", cancelEdit);
}

async function saveNode() {
  const statusEl = document.getElementById("edit-status");
  if (!editingNode) return;

  statusEl.textContent = "Saving...";
  statusEl.style.color = "#888";

  const body = {
    label: document.getElementById("edit-label").value,
    type: document.getElementById("edit-type").value,
    level: parseInt(document.getElementById("edit-level").value),
    importance: parseFloat(document.getElementById("edit-importance").value),
    content: document.getElementById("edit-content").value,
    sticky: document.getElementById("edit-sticky").checked,
  };

  const summaryEl = document.getElementById("edit-summary");
  if (summaryEl) body.summary = summaryEl.value;

  try {
    const res = await fetch(`/api/nodes/${editingNode.id}?scope=${currentScope}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();

    if (result.success) {
      statusEl.textContent = "Saved! Reloading...";
      statusEl.style.color = "#4f4";
      await loadData();
      editingNode = null;
      const updated = nodeData.find(n => n.id === editingNode?.id || n.id === body.label);
      if (updated) {
        const mesh = sceneCtrl.nodeObjects.find(o => o.isMesh && o.userData.nodeId === updated.id);
        if (mesh) {
          sceneCtrl.selectedNode = mesh;
          showDetailPanel(updated);
        }
      }
    } else {
      statusEl.textContent = "Error: " + (result.error || "Unknown");
      statusEl.style.color = "#f44";
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.style.color = "#f44";
  }
}

function cancelEdit() {
  editingNode = null;
  if (sceneCtrl.selectedNode && sceneCtrl.selectedNode.userData.nodeData) {
    showDetailPanel(sceneCtrl.selectedNode.userData.nodeData);
  }
}

async function deleteNode(node) {
  if (!confirm(`Delete node "${node.label || node.id}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/nodes/${node.id}?scope=${currentScope}`, {
      method: "DELETE",
    });
    const result = await res.json();

    if (result.success) {
      document.getElementById("detail-panel").classList.remove("open");
      sceneCtrl.selectedNode = null;
      editingNode = null;
      await loadData();
    } else {
      alert("Delete failed: " + (result.error || "Unknown"));
    }
  } catch (e) {
    alert("Delete error: " + e.message);
  }
}

// eslint-disable-next-line no-unused-vars
async function verifyNode(nodeId) {
  try {
    const res = await fetch(`/api/nodes/${nodeId}/verify?scope=${currentScope}`, { method: "POST" });
    const result = await res.json();
    if (result.success) {
      const el = document.getElementById(`confidence-value-${nodeId}`);
      if (el) el.textContent = result.node.confidence;
      const parent = el?.closest?.(".detail-section") || document.getElementById("detail-content");
      const flash = document.createElement("span");
      flash.textContent = "✓ Verified!";
      flash.style.cssText = "color:#22c55e;margin-left:8px;font-weight:600;animation:fadeOut 2s forwards;";
      const btn = parent?.querySelector("button[onclick*='verifyNode']");
      if (btn) btn.parentElement.appendChild(flash);
      setTimeout(() => flash.remove(), 2000);
    } else {
      alert("Verify failed: " + (result.error || "Unknown"));
    }
  } catch (e) {
    alert("Verify error: " + e.message);
  }
}

async function removeTag(nodeId, tag) {
  const node = nodeData.find(n => n.id === nodeId);
  if (!node) return;
  node.tags = (node.tags || []).filter(t => t !== tag);
  await saveTagsAndRefresh(nodeId, node.tags);
}

async function addTag(nodeId) {
  const input = document.getElementById(`tag-input-${nodeId}`);
  if (!input || !input.value.trim()) return;
  const node = nodeData.find(n => n.id === nodeId);
  if (!node) return;
  const newTags = input.value.split(",").map(t => t.trim()).filter(t => t);
  node.tags = [...new Set([...(node.tags || []), ...newTags])];
  input.value = "";
  await saveTagsAndRefresh(nodeId, node.tags);
}

async function saveTagsAndRefresh(nodeId, tags) {
  try {
    await fetch(`/api/nodes/${nodeId}?scope=${currentScope}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    showDetailPanel(nodeData.find(n => n.id === nodeId));
  } catch (e) {
    alert("Save tags error: " + e.message);
  }
}

async function updateNodeSource(nodeId, source) {
  try {
    await fetch(`/api/nodes/${nodeId}?scope=${currentScope}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const node = nodeData.find(n => n.id === nodeId);
    if (node) node.source = source;
  } catch (e) {
    alert("Update source error: " + e.message);
  }
}

// Expose for inline HTML onclick/onchange handlers
window.removeTag = removeTag;
window.addTag = addTag;
window.updateNodeSource = updateNodeSource;

async function injectNode(node) {
  const statusEl = document.getElementById("inject-status");
  try {
    statusEl.textContent = "Injecting...";
    statusEl.style.display = "block";
    statusEl.style.color = "#888";

    const res = await fetch("/api/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, scope: currentScope }),
    });
    const result = await res.json();

    if (result.success) {
      statusEl.textContent = "Injected!";
      statusEl.style.color = "#4f4";
      setTimeout(() => { statusEl.style.display = "none"; }, 2000);
    } else {
      statusEl.textContent = "Error: " + (result.error || "Unknown");
      statusEl.style.color = "#f44";
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.style.color = "#f44";
  }
}

// ==================== Server Search ====================

async function performServerSearch(query) {
  const info = document.getElementById("search-info");
  if (!query || query.length < 2) {
    filterEngine.setServerSearchIds(null);
    info.textContent = "";
    info.classList.remove("loading");
    sceneCtrl.updateVisibility(filterEngine);
    return;
  }

  filterEngine.setServerSearchIds(null);
  sceneCtrl.updateVisibility(filterEngine);

  info.classList.add("loading");
  info.textContent = filterEngine.searchMode === "embedding" ? "Searching embeddings..." : "Searching BM25 index...";
  info.style.color = "#888";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${filterEngine.searchMode}&scope=${currentScope}`);
    if (!res.ok) {
      filterEngine.setServerSearchIds(null);
      info.textContent = "Search error: server returned " + res.status;
      info.style.color = "#f44";
      sceneCtrl.updateVisibility(filterEngine);
      return;
    }
    const results = await res.json();

    if (!Array.isArray(results)) {
      filterEngine.setServerSearchIds(null);
      info.textContent = "Search error: unexpected response format";
      info.style.color = "#f44";
    } else if (results.length === 0) {
      filterEngine.setServerSearchIds(new Set());
      info.textContent = "No results found";
      info.style.color = "#f44";
    } else {
      filterEngine.setServerSearchIds(new Set(results.map(r => r.id)));
      info.textContent = `${results.length} result(s) found`;
      info.style.color = "#4f4";
    }
    sceneCtrl.updateVisibility(filterEngine);
  } catch (e) {
    filterEngine.setServerSearchIds(null);
    info.textContent = "Search failed: " + e.message;
    info.style.color = "#f44";
  } finally {
    info.classList.remove("loading");
  }
}

// ==================== Animation Loop ====================

function animate() {
  requestAnimationFrame(animate);
  sceneCtrl.render();
}

// ==================== Settings ====================

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-config').addEventListener('click', saveSettings);

  // Collapsible settings categories
  document.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });

  // Resizable sidebar
  const root = document.documentElement;
  const sidebar = document.getElementById("sidebar");
  const handle = document.getElementById("resize-handle");
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 600;
  let isResizing = false;

  const savedWidth = localStorage.getItem("sidebar-width");
  if (savedWidth) {
    root.style.setProperty("--sidebar-width", savedWidth + "px");
    sidebar.style.display = "block";
  }

  handle.addEventListener("mousedown", (e) => {
    isResizing = true;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX));
    root.style.setProperty("--sidebar-width", w + "px");
    localStorage.setItem("sidebar-width", String(w));
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });

  // Sort controls
  document.getElementById("sort-field").addEventListener("change", (e) => {
    sortField = e.target.value;
    buildNodeList();
  });
  document.getElementById("sort-dir-btn").addEventListener("click", () => {
    sortAsc = !sortAsc;
    document.getElementById("sort-dir-btn").innerHTML = sortAsc ? "&#x25B2;" : "&#x25BC;";
    buildNodeList();
  });

  // Backup / Restore event listeners
  document.getElementById("create-backup").addEventListener("click", handleCreateBackup);
  document.getElementById("confirm-yes").addEventListener("click", handleConfirmYes);
  document.getElementById("confirm-no").addEventListener("click", closeConfirmModal);
});

// ==================== Backup / Restore ====================

let confirmCallback = null;

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.remove("open");
  confirmCallback = null;
}

function showConfirm(title, bodyHtml, callback) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-body").innerHTML = bodyHtml;
  document.getElementById("confirm-modal").classList.add("open");
  confirmCallback = callback;
}

function handleConfirmYes() {
  if (confirmCallback) confirmCallback();
  closeConfirmModal();
}

async function loadBackupSources() {
  const container = document.getElementById("backup-sources");
  const statusEl = document.getElementById("backup-status");
  try {
    const res = await fetch("/api/backup-sources");
    const sources = await res.json();
    container.innerHTML = sources.map(s => `
      <div class="backup-source-item">
        <input type="checkbox" id="src-${s.key}" ${s.exists ? 'checked' : 'disabled'}>
        <label for="src-${s.key}">${s.label}</label>
        <span class="source-status ${s.exists ? 'available' : 'unavailable'}">${s.exists ? 'Available' : 'Unavailable'}</span>
      </div>
    `).join("");
  } catch (e) {
    container.innerHTML = `<div class="stat-row"><span class="stat-label">Error loading sources</span></div>`;
    statusEl.textContent = "Error: " + e.message;
    statusEl.className = "backup-status error";
  }
}

async function handleCreateBackup() {
  const statusEl = document.getElementById("backup-status");
  const checked = document.querySelectorAll("#backup-sources input[type='checkbox']:checked");
  const sources = Array.from(checked).map(cb => cb.id.replace("src-", ""));

  if (sources.length === 0) {
    statusEl.textContent = "Select at least one source";
    statusEl.className = "backup-status error";
    return;
  }

  statusEl.className = "backup-status loading";
  statusEl.textContent = "Creating backup...";

  try {
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources }),
    });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = `Backup created: ${data.backup.name}`;
      statusEl.className = "backup-status success";
      loadBackupList();
    } else {
      statusEl.textContent = "Error: " + (data.error || "Unknown");
      statusEl.className = "backup-status error";
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.className = "backup-status error";
  }
}

async function loadBackupList() {
  const container = document.getElementById("backup-list");
  try {
    const res = await fetch("/api/backups");
    const data = await res.json();
    const backups = data.backups || [];

    if (backups.length === 0) {
      container.innerHTML = `<div class="stat-row"><span class="stat-label">No backups yet</span></div>`;
      return;
    }

    container.innerHTML = backups.map(b => {
      const date = new Date(b.date).toLocaleString();
      const size = formatFileSize(b.totalSize);
      const sources = Object.entries(b.sources).map(([, s]) =>
        `${s.label} (${formatFileSize(s.totalSize)})`
      ).join(", ");
      return `
        <div class="backup-list-item">
          <div class="backup-header">
            <span class="backup-name">${b.name}</span>
            <span class="backup-meta">${size}</span>
          </div>
          <div class="backup-meta">${date}</div>
          <div class="backup-sources">${sources}</div>
          <div class="backup-actions">
            <button class="backup-btn restore" data-name="${b.name}">Restore</button>
            <button class="backup-btn delete" data-name="${b.name}">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    // Wire restore/delete buttons
    container.querySelectorAll(".backup-btn.restore").forEach(btn => {
      btn.addEventListener("click", () => handleRestore(btn.dataset.name));
    });
    container.querySelectorAll(".backup-btn.delete").forEach(btn => {
      btn.addEventListener("click", () => handleDelete(btn.dataset.name));
    });
  } catch  {
    container.innerHTML = `<div class="stat-row"><span class="stat-label">Error loading backups</span></div>`;
  }
}

async function handleRestore(name) {
  // Fetch backup details to get available sources
  const res = await fetch("/api/backups");
  const data = await res.json();
  const backup = (data.backups || []).find(b => b.name === name);
  if (!backup) return;

  const sources = Object.entries(backup.sources);
  const checkboxes = sources.map(([key, s]) => {
    const checked = sources.length <= 1 ? "checked" : "";
    return `
      <label class="restore-source">
        <input type="checkbox" class="restore-src-cb" value="${key}" ${checked}>
        ${s.label} (${formatFileSize(s.totalSize)})
      </label>
    `;
  }).join("");

  const bodyHtml = `
    <p>Restore backup "${name}"? A pre-restore snapshot will be created first.</p>
    <div class="restore-sources">Select sources to restore:${checkboxes}</div>
  `;

  showConfirm("Restore Backup", bodyHtml, async () => {
    const statusEl = document.getElementById("backup-status");
    const checked = document.querySelectorAll(".restore-src-cb:checked");
    const selected = Array.from(checked).map(cb => cb.value);

    if (selected.length === 0) {
      statusEl.textContent = "Select at least one source to restore";
      statusEl.className = "backup-status error";
      return;
    }

    statusEl.className = "backup-status loading";
    statusEl.textContent = "Restoring...";
    try {
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: name, sources: selected }),
      });
      const result = await res.json();
      if (result.success) {
        statusEl.textContent = `Restored. Pre-restore backup: ${result.preRestoreBackup || "N/A"}`;
        statusEl.className = "backup-status success";
        loadBackupList();
      } else {
        statusEl.textContent = "Error: " + (result.error || "Unknown");
        statusEl.className = "backup-status error";
      }
    } catch (e) {
      statusEl.textContent = "Error: " + e.message;
      statusEl.className = "backup-status error";
    }
  });
}

async function handleDelete(name) {
  showConfirm(
    "Delete Backup",
    `<p>Delete backup "${name}"? This cannot be undone.</p>`,
    async () => {
      try {
        const res = await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          loadBackupList();
        }
      } catch (e) {
        console.error("Failed to delete backup:", e);
      }
    }
  );
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return val.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    document.getElementById('defaultTtlDays').value = config.defaultTtlDays ?? 0;
    document.getElementById('maxInjectionTokens').value = config.maxInjectionTokens ?? 8000;
    document.getElementById('coreInjectionTokens').value = config.coreInjectionTokens ?? 2000;
    document.getElementById('cacheSize').value = config.cacheSize ?? 8;
    document.getElementById('cacheTTLHours').value = config.cacheTTLHours ?? 2;
    document.getElementById('autoCompressThreshold').value = config.autoCompressThreshold ?? 0.7;
    document.getElementById('highContextThreshold').value = config.highContextThreshold ?? 0.6;
    document.getElementById('criticalContextThreshold').value = config.criticalContextThreshold ?? 0.8;
    document.getElementById('enableMiddleTermCapture').value = String(config.enableMiddleTermCapture ?? true);
    document.getElementById('autoRetrieve-enabled').value = String(config.autoRetrieve?.enabled ?? false);
    document.getElementById('autoRetrieve-candidateCount').value = config.autoRetrieve?.candidateCount ?? 30;
    document.getElementById('autoRetrieve-maxInjectNodes').value = config.autoRetrieve?.maxInjectNodes ?? 5;
    document.getElementById('autoRetrieve-maxInjectPlaybooks').value = config.autoRetrieve?.maxInjectPlaybooks ?? 3;
    document.getElementById('autoRetrieve-minQueryLength').value = config.autoRetrieve?.minQueryLength ?? 10;
    document.getElementById('autoRetrieve-injectionCooldownMs').value = config.autoRetrieve?.injectionCooldownMs ?? 30000;
    document.getElementById('autoRetrieve-llmJudgeEnabled').value = String(config.autoRetrieve?.llmJudgeEnabled ?? true);
    document.getElementById('ollama-enabled').value = String(config.ollama?.enabled ?? false);
    document.getElementById('ollama-model').value = config.ollama?.model ?? 'qwen2.5-coder:1.5b';
    document.getElementById('ollama-baseUrl').value = config.ollama?.baseUrl ?? 'http://localhost:11434';
    document.getElementById('ollama-mode').value = config.ollama?.mode ?? 'binary';
    document.getElementById('ollama-strategy').value = config.ollama?.strategy ?? 'llm';
    document.getElementById('llmCompression-enabled').value = String(config.llmCompression?.enabled ?? false);
    document.getElementById('llmCompression-maxSummaryTokens').value = config.llmCompression?.maxSummaryTokens ?? 500;
    document.getElementById('llmCompression-model').value = config.llmCompression?.model ?? '';
    document.getElementById('commandCompression-enabled').value = String(config.commandCompression?.enabled ?? true);
    document.getElementById('commandCompression-maxLines').value = config.commandCompression?.maxLines ?? 50;
    document.getElementById('commandCompression-excludeCommands').value = (config.commandCompression?.excludeCommands ?? []).join(', ');
    document.getElementById('commandCompression-alwaysFullOnFailure').value = String(config.commandCompression?.alwaysFullOnFailure ?? true);
    document.getElementById('commandCompression-fuzzyDedupEnabled').value = String(config.commandCompression?.fuzzyDedupEnabled ?? true);
    document.getElementById('commandCompression-fuzzyDedupThreshold').value = config.commandCompression?.fuzzyDedupThreshold ?? 0.85;
    document.getElementById('commandCompression-fuzzyDedupMax').value = config.commandCompression?.fuzzyDedupMax ?? 50;
    document.getElementById('commandCompression-structuralShapeDetection').value = String(config.commandCompression?.structuralShapeDetection ?? true);
    document.getElementById('commandCompression-relevanceTrimmingEnabled').value = String(config.commandCompression?.relevanceTrimmingEnabled ?? false);
    document.getElementById('commandCompression-relevanceTrimmingThreshold').value = config.commandCompression?.relevanceTrimmingThreshold ?? 0.15;
    document.getElementById('commandCompression-relevanceTrimmingMinKeep').value = config.commandCompression?.relevanceTrimmingMinKeep ?? 5;
    document.getElementById('commandCompression-relevanceTrimmingAlwaysKeepTop').value = config.commandCompression?.relevanceTrimmingAlwaysKeepTop ?? 3;
    document.getElementById('commandCompression-deltaCompressionEnabled').value = String(config.commandCompression?.deltaCompressionEnabled ?? true);
    document.getElementById('commandCompression-deltaMaxCacheSize').value = config.commandCompression?.deltaMaxCacheSize ?? 50;
    document.getElementById('commandCompression-deltaMinSimilarity').value = config.commandCompression?.deltaMinSimilarity ?? 0.5;
    document.getElementById('commandCompression-ollamaExtraction-enabled').value = String(config.commandCompression?.ollamaExtraction?.enabled ?? false);
    document.getElementById('commandCompression-ollamaExtraction-baseUrl').value = config.commandCompression?.ollamaExtraction?.baseUrl ?? 'http://localhost:11434';
    document.getElementById('commandCompression-ollamaExtraction-model').value = config.commandCompression?.ollamaExtraction?.model ?? 'qwen3.5:3b';
    document.getElementById('commandCompression-ollamaExtraction-minOutputChars').value = config.commandCompression?.ollamaExtraction?.minOutputChars ?? 2000;
    document.getElementById('commandCompression-ollamaExtraction-timeoutMs').value = config.commandCompression?.ollamaExtraction?.timeoutMs ?? 10000;
    document.getElementById('adaptivePressure-enabled').value = String(config.adaptivePressure?.enabled ?? false);
    document.getElementById('adaptivePressure-warnThreshold').value = config.adaptivePressure?.warnThreshold ?? 0.7;
    document.getElementById('adaptivePressure-aggressiveThreshold').value = config.adaptivePressure?.aggressiveThreshold ?? 0.85;
    document.getElementById('adaptivePressure-criticalThreshold').value = config.adaptivePressure?.criticalThreshold ?? 0.95;
    document.getElementById('autoDistill-enabled').value = String(config.autoDistill?.enabled ?? false);
    document.getElementById('autoDistill-minLessons').value = config.autoDistill?.minLessons ?? 3;
    document.getElementById('autoDistill-useLlm').value = String(config.autoDistill?.useLlm ?? false);
    document.getElementById('predictiveRating-enabled').value = String(config.predictiveRating?.enabled ?? false);
    document.getElementById('predictiveRating-decayDays').value = config.predictiveRating?.decayDays ?? 30;
    document.getElementById('predictiveRating-confidenceThreshold').value = config.predictiveRating?.confidenceThreshold ?? 0.3;
    document.getElementById('predictiveRating-positiveBoost').value = config.predictiveRating?.positiveBoost ?? 0.1;
    document.getElementById('predictiveRating-negativePenalty').value = config.predictiveRating?.negativePenalty ?? 0.05;
    document.getElementById('autoDiscover-enabled').value = String(config.autoDiscover?.enabled ?? false);
    document.getElementById('autoDiscover-minSequenceLength').value = config.autoDiscover?.minSequenceLength ?? 3;
    document.getElementById('autoDiscover-minRepeatCount').value = config.autoDiscover?.minRepeatCount ?? 2;
    document.getElementById('autoDiscover-maxInjectPlaybooks').value = config.autoDiscover?.maxInjectPlaybooks ?? 3;
    document.getElementById('autoConsolidate-enabled').value = String(config.autoConsolidate?.enabled ?? false);
    document.getElementById('autoConsolidate-similarityThreshold').value = config.autoConsolidate?.similarityThreshold ?? 0.3;
    document.getElementById('autoConsolidate-maxFactsPerCluster').value = config.autoConsolidate?.maxFactsPerCluster ?? 5;
    document.getElementById('autoConsolidate-minClusterSize').value = config.autoConsolidate?.minClusterSize ?? 2;
    document.getElementById('journal-enabled').value = String(config.journal?.enabled ?? false);
    document.getElementById('management-enabled').value = String(config.management?.enabled ?? false);
    document.getElementById('management-port').value = config.management?.port ?? 8787;
    document.getElementById('sessionLog-enabled').value = String(config.sessionLog?.enabled ?? false);
    document.getElementById('reReadElimination-enabled').value = String(config.reReadElimination?.enabled ?? true);
    document.getElementById('reReadElimination-maxCacheSize').value = config.reReadElimination?.maxCacheSize ?? 100;
    document.getElementById('outputOffloading-enabled').value = String(config.outputOffloading?.enabled ?? true);
    document.getElementById('outputOffloading-thresholdChars').value = config.outputOffloading?.thresholdChars ?? 8000;
    document.getElementById('toolDedup').value = String(config.toolDedup ?? true);
    document.getElementById('errorPruning').value = String(config.errorPruning ?? false);
    const g = config.graph || {};
    document.getElementById('graph-enabled').value = String(g.enabled ?? true);
    document.getElementById('graph-maxFiles').value = g.maxFiles ?? 5000;
    document.getElementById('graph-refreshEnabled').value = String(g.refreshEnabled ?? true);
    const otc = config.outputTokenControl || {};
    document.getElementById('outputTokenControl-enabled').value = String(otc.enabled ?? false);
    document.getElementById('outputTokenControl-mode').value = otc.mode ?? 'adaptive';
    document.getElementById('outputTokenControl-strategy').value = otc.strategy ?? 'concise';
    document.getElementById('outputTokenControl-maxSentences').value = otc.maxSentences ?? 5;
    document.getElementById('outputTokenControl-maxChars').value = otc.maxChars ?? 0;
    document.getElementById('outputTokenControl-customPrompt').value = otc.customPrompt ?? '';
    document.getElementById('outputTokenControl-warnThreshold').value = otc.warnThreshold ?? 0.7;
    document.getElementById('outputTokenControl-aggressiveThreshold').value = otc.aggressiveThreshold ?? 0.85;
    document.getElementById('outputTokenControl-criticalThreshold').value = otc.criticalThreshold ?? 0.95;
    document.getElementById('outputTokenControl-normalSentences').value = otc.normalSentences ?? 5;
    document.getElementById('outputTokenControl-warnSentences').value = otc.warnSentences ?? 3;
    document.getElementById('outputTokenControl-aggressiveSentences').value = otc.aggressiveSentences ?? 1;
    document.getElementById('outputTokenControl-criticalSentences').value = otc.criticalSentences ?? 1;
    document.getElementById('outputTokenControl-normalStrategy').value = otc.normalStrategy ?? 'concise';
    document.getElementById('outputTokenControl-warnStrategy').value = otc.warnStrategy ?? 'sentence_limit';
    document.getElementById('outputTokenControl-aggressiveStrategy').value = otc.aggressiveStrategy ?? 'sentence_limit';
    document.getElementById('outputTokenControl-criticalStrategy').value = otc.criticalStrategy ?? 'char_limit';
    document.getElementById('outputTokenControl-normalPrompt').value = otc.normalPrompt ?? '';
    document.getElementById('outputTokenControl-warnPrompt').value = otc.warnPrompt ?? '';
    document.getElementById('outputTokenControl-aggressivePrompt').value = otc.aggressivePrompt ?? '';
    document.getElementById('outputTokenControl-criticalPrompt').value = otc.criticalPrompt ?? '';
    document.getElementById('outputTokenControl-excludePatterns').value = (otc.excludePatterns || []).join('\n');
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

async function saveSettings() {
  const config = {
    defaultTtlDays: parseInt(document.getElementById('defaultTtlDays').value) || 0,
    maxInjectionTokens: parseInt(document.getElementById('maxInjectionTokens').value) || 8000,
    coreInjectionTokens: parseInt(document.getElementById('coreInjectionTokens').value) || 2000,
    cacheSize: parseInt(document.getElementById('cacheSize').value) || 8,
    cacheTTLHours: parseInt(document.getElementById('cacheTTLHours').value) || 2,
    autoCompressThreshold: parseFloat(document.getElementById('autoCompressThreshold').value) || 0.7,
    highContextThreshold: parseFloat(document.getElementById('highContextThreshold').value) || 0.6,
    criticalContextThreshold: parseFloat(document.getElementById('criticalContextThreshold').value) || 0.8,
    enableMiddleTermCapture: document.getElementById('enableMiddleTermCapture').value === 'true',
    autoRetrieve: {
      enabled: document.getElementById('autoRetrieve-enabled').value === 'true',
      candidateCount: parseInt(document.getElementById('autoRetrieve-candidateCount').value) || 30,
      maxInjectNodes: parseInt(document.getElementById('autoRetrieve-maxInjectNodes').value) || 5,
      maxInjectPlaybooks: parseInt(document.getElementById('autoRetrieve-maxInjectPlaybooks').value) || 3,
      minQueryLength: parseInt(document.getElementById('autoRetrieve-minQueryLength').value) || 10,
      injectionCooldownMs: parseInt(document.getElementById('autoRetrieve-injectionCooldownMs').value) || 30000,
      llmJudgeEnabled: document.getElementById('autoRetrieve-llmJudgeEnabled').value === 'true',
    },
    ollama: {
      enabled: document.getElementById('ollama-enabled').value === 'true',
      model: document.getElementById('ollama-model').value || 'qwen2.5-coder:1.5b',
      baseUrl: document.getElementById('ollama-baseUrl').value || 'http://localhost:11434',
      mode: document.getElementById('ollama-mode').value || 'binary',
      strategy: document.getElementById('ollama-strategy').value || 'llm',
    },
    llmCompression: {
      enabled: document.getElementById('llmCompression-enabled').value === 'true',
      maxSummaryTokens: parseInt(document.getElementById('llmCompression-maxSummaryTokens').value) || 500,
      model: document.getElementById('llmCompression-model').value || undefined,
    },
    commandCompression: {
      enabled: document.getElementById('commandCompression-enabled').value === 'true',
      maxLines: parseInt(document.getElementById('commandCompression-maxLines').value) || 50,
      excludeCommands: document.getElementById('commandCompression-excludeCommands').value.split(',').map(s => s.trim()).filter(Boolean),
      alwaysFullOnFailure: document.getElementById('commandCompression-alwaysFullOnFailure').value === 'true',
      fuzzyDedupEnabled: document.getElementById('commandCompression-fuzzyDedupEnabled').value === 'true',
      fuzzyDedupThreshold: parseFloat(document.getElementById('commandCompression-fuzzyDedupThreshold').value) || 0.85,
      fuzzyDedupMax: parseInt(document.getElementById('commandCompression-fuzzyDedupMax').value) || 50,
      structuralShapeDetection: document.getElementById('commandCompression-structuralShapeDetection').value === 'true',
      relevanceTrimmingEnabled: document.getElementById('commandCompression-relevanceTrimmingEnabled').value === 'true',
      relevanceTrimmingThreshold: parseFloat(document.getElementById('commandCompression-relevanceTrimmingThreshold').value) || 0.15,
      relevanceTrimmingMinKeep: parseInt(document.getElementById('commandCompression-relevanceTrimmingMinKeep').value) || 5,
      relevanceTrimmingAlwaysKeepTop: parseInt(document.getElementById('commandCompression-relevanceTrimmingAlwaysKeepTop').value) || 3,
      deltaCompressionEnabled: document.getElementById('commandCompression-deltaCompressionEnabled').value === 'true',
      deltaMaxCacheSize: parseInt(document.getElementById('commandCompression-deltaMaxCacheSize').value) || 50,
      deltaMinSimilarity: parseFloat(document.getElementById('commandCompression-deltaMinSimilarity').value) || 0.5,
      ollamaExtraction: {
        enabled: document.getElementById('commandCompression-ollamaExtraction-enabled').value === 'true',
        baseUrl: document.getElementById('commandCompression-ollamaExtraction-baseUrl').value || 'http://localhost:11434',
        model: document.getElementById('commandCompression-ollamaExtraction-model').value || 'qwen3.5:3b',
        minOutputChars: parseInt(document.getElementById('commandCompression-ollamaExtraction-minOutputChars').value) || 2000,
        timeoutMs: parseInt(document.getElementById('commandCompression-ollamaExtraction-timeoutMs').value) || 10000,
      },
    },
    adaptivePressure: {
      enabled: document.getElementById('adaptivePressure-enabled').value === 'true',
      warnThreshold: parseFloat(document.getElementById('adaptivePressure-warnThreshold').value) || 0.7,
      aggressiveThreshold: parseFloat(document.getElementById('adaptivePressure-aggressiveThreshold').value) || 0.85,
      criticalThreshold: parseFloat(document.getElementById('adaptivePressure-criticalThreshold').value) || 0.95,
    },
    autoDistill: {
      enabled: document.getElementById('autoDistill-enabled').value === 'true',
      minLessons: parseInt(document.getElementById('autoDistill-minLessons').value) || 3,
      useLlm: document.getElementById('autoDistill-useLlm').value === 'true',
    },
    predictiveRating: {
      enabled: document.getElementById('predictiveRating-enabled').value === 'true',
      decayDays: parseFloat(document.getElementById('predictiveRating-decayDays').value) || 30,
      confidenceThreshold: parseFloat(document.getElementById('predictiveRating-confidenceThreshold').value) || 0.3,
      positiveBoost: parseFloat(document.getElementById('predictiveRating-positiveBoost').value) || 0.1,
      negativePenalty: parseFloat(document.getElementById('predictiveRating-negativePenalty').value) || 0.05,
    },
    autoDiscover: {
      enabled: document.getElementById('autoDiscover-enabled').value === 'true',
      minSequenceLength: parseInt(document.getElementById('autoDiscover-minSequenceLength').value) || 3,
      minRepeatCount: parseInt(document.getElementById('autoDiscover-minRepeatCount').value) || 2,
      maxInjectPlaybooks: parseInt(document.getElementById('autoDiscover-maxInjectPlaybooks').value) || 3,
    },
    autoConsolidate: {
      enabled: document.getElementById('autoConsolidate-enabled').value === 'true',
      similarityThreshold: parseFloat(document.getElementById('autoConsolidate-similarityThreshold').value) || 0.3,
      maxFactsPerCluster: parseInt(document.getElementById('autoConsolidate-maxFactsPerCluster').value) || 5,
      minClusterSize: parseInt(document.getElementById('autoConsolidate-minClusterSize').value) || 2,
    },
    journal: {
      enabled: document.getElementById('journal-enabled').value === 'true',
    },
    management: {
      enabled: document.getElementById('management-enabled').value === 'true',
      port: parseInt(document.getElementById('management-port').value) || 8787,
    },
    sessionLog: {
      enabled: document.getElementById('sessionLog-enabled').value === 'true',
    },
    reReadElimination: {
      enabled: document.getElementById('reReadElimination-enabled').value === 'true',
      maxCacheSize: parseInt(document.getElementById('reReadElimination-maxCacheSize').value) || 100,
    },
    outputOffloading: {
      enabled: document.getElementById('outputOffloading-enabled').value === 'true',
      thresholdChars: parseInt(document.getElementById('outputOffloading-thresholdChars').value) || 8000,
    },
    toolDedup: document.getElementById('toolDedup').value === 'true',
    errorPruning: document.getElementById('errorPruning').value === 'true',
    graph: {
      enabled: document.getElementById('graph-enabled').value === 'true',
      maxFiles: parseInt(document.getElementById('graph-maxFiles').value) || 5000,
      refreshEnabled: document.getElementById('graph-refreshEnabled').value === 'true',
    },
    outputTokenControl: {
      enabled: document.getElementById('outputTokenControl-enabled').value === 'true',
      mode: document.getElementById('outputTokenControl-mode').value,
      strategy: document.getElementById('outputTokenControl-strategy').value,
      maxSentences: parseInt(document.getElementById('outputTokenControl-maxSentences').value) || 5,
      maxChars: parseInt(document.getElementById('outputTokenControl-maxChars').value) || 0,
      customPrompt: document.getElementById('outputTokenControl-customPrompt').value,
      warnThreshold: parseFloat(document.getElementById('outputTokenControl-warnThreshold').value) || 0.7,
      aggressiveThreshold: parseFloat(document.getElementById('outputTokenControl-aggressiveThreshold').value) || 0.85,
      criticalThreshold: parseFloat(document.getElementById('outputTokenControl-criticalThreshold').value) || 0.95,
      normalSentences: parseInt(document.getElementById('outputTokenControl-normalSentences').value) || 5,
      warnSentences: parseInt(document.getElementById('outputTokenControl-warnSentences').value) || 3,
      aggressiveSentences: parseInt(document.getElementById('outputTokenControl-aggressiveSentences').value) || 1,
      criticalSentences: parseInt(document.getElementById('outputTokenControl-criticalSentences').value) || 1,
      normalStrategy: document.getElementById('outputTokenControl-normalStrategy').value,
      warnStrategy: document.getElementById('outputTokenControl-warnStrategy').value,
      aggressiveStrategy: document.getElementById('outputTokenControl-aggressiveStrategy').value,
      criticalStrategy: document.getElementById('outputTokenControl-criticalStrategy').value,
      normalPrompt: document.getElementById('outputTokenControl-normalPrompt').value,
      warnPrompt: document.getElementById('outputTokenControl-warnPrompt').value,
      aggressivePrompt: document.getElementById('outputTokenControl-aggressivePrompt').value,
      criticalPrompt: document.getElementById('outputTokenControl-criticalPrompt').value,
      excludePatterns: document.getElementById('outputTokenControl-excludePatterns').value.split('\n').filter(Boolean),
    },
  };
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        document.getElementById('save-message').textContent = 'Saved! Restart plugin to apply.';
      } else {
        document.getElementById('save-message').textContent = 'Error: ' + (data.error || 'Unknown');
        document.getElementById('save-message').style.color = '#f44';
      }
      setTimeout(() => { document.getElementById('save-message').textContent = ''; document.getElementById('save-message').style.color = '#4f4'; }, 5000);
    } else {
      document.getElementById('save-message').textContent = 'HTTP Error: ' + res.status;
      document.getElementById('save-message').style.color = '#f44';
    }
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// ==================== Context Dashboard ====================

async function loadContextDashboard() {
  const summaryEl = document.getElementById("context-summary");
  const breakdownEl = document.getElementById("context-breakdown");
  const tablesEl = document.getElementById("context-tables");
  if (!summaryEl || !breakdownEl || !tablesEl) return;

  summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">Loading context data...</span></div>`;
  breakdownEl.innerHTML = "";
  tablesEl.innerHTML = "";

  try {
    const [res, embRes] = await Promise.all([
      fetch("/api/context-dashboard"),
      fetch("/api/embeddings-status"),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const embStatus = embRes.ok ? await embRes.json() : null;

    const mem = data.memory;
    const comp = data.compression;
    const inj = data.injections;
    const agg = data.injectionAggregate;
    const overhead = data.overhead;

    const estimatedConversationTokens = comp.totalCalls > 0
      ? Math.round(comp.originalChars / 4)
      : 0;

    const totalView = mem.totalTokens + overhead.systemPromptTokens + overhead.toolDefTokens + estimatedConversationTokens;

    const stratHtml = agg && agg.topStrategies && agg.topStrategies.length > 0
      ? agg.topStrategies.map(s => `${s.strategy}:${s.count}`).join(", ")
      : "—";

    summaryEl.innerHTML = `
      <div class="stat-row"><span class="stat-label">Memory Nodes</span><span class="stat-value">${mem.totalNodes}</span></div>
      <div class="stat-row"><span class="stat-label">Memory Tokens</span><span class="stat-value">${mem.totalTokens.toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label">Active Rules</span><span class="stat-value">${mem.rules}</span></div>
      <div class="stat-row"><span class="stat-label">Compression Calls</span><span class="stat-value">${comp.totalCalls}</span></div>
      <div class="stat-row"><span class="stat-label">Compression Saved</span><span class="stat-value">${comp.savingsPercent}%</span></div>
      <div class="stat-row"><span class="stat-label">Total Injections</span><span class="stat-value">${agg ? agg.total : inj.length}</span></div>
      <div class="stat-row"><span class="stat-label">Avg Nodes/Inj</span><span class="stat-value">${agg ? agg.avgNodes : "—"}</span></div>
      <div class="stat-row"><span class="stat-label">Avg Tokens/Inj</span><span class="stat-value">${agg ? agg.avgTokens.toLocaleString() : "—"}</span></div>
      <div class="stat-row"><span class="stat-label">Top Strategies</span><span class="stat-value" style="font-size:10px">${stratHtml}</span></div>
      <div class="stat-row"><span class="stat-label">Est. Conversation Tokens</span><span class="stat-value">${estimatedConversationTokens.toLocaleString()}</span></div>
      ${embStatus ? `
      <div style="border-top:1px solid #333;padding-top:8px;margin-top:8px;">
        <div style="color:#888;font-size:11px;margin-bottom:4px;">Embedding Engine</div>
        <div class="stat-row"><span class="stat-label">Runtime</span><span class="stat-value" style="color:#34d399">${embStatus.runtime}</span></div>
        <div class="stat-row"><span class="stat-label">Backend</span><span class="stat-value">${embStatus.backend}</span></div>
        <div class="stat-row"><span class="stat-label">Optimization</span><span class="stat-value">${embStatus.graphOptimizationLevel}</span></div>
        <div class="stat-row"><span class="stat-label">Threads</span><span class="stat-value">auto (${embStatus.intraOpNumThreads})</span></div>
        <div class="stat-row"><span class="stat-label">Model</span><span class="stat-value">${embStatus.model}</span></div>
        <div class="stat-row"><span class="stat-label">Dimensions</span><span class="stat-value">${embStatus.dimensions}</span></div>
        <div class="stat-row"><span class="stat-label">Cross-Encoder</span><span class="stat-value" style="font-size:10px">${embStatus.crossEncoderModel}</span></div>
      </div>` : ''}
      <div class="stat-row" style="border-top:1px solid #333;padding-top:8px;margin-top:8px;">
        <span class="stat-label"><strong>Est. Total in Context</strong></span>
        <span class="stat-value"><strong>${totalView.toLocaleString()} tokens</strong></span>
      </div>
      <div class="stat-row"><span class="stat-label" style="font-size:11px;color:#666;">System prompts</span><span class="stat-value" style="font-size:11px;">~${overhead.systemPromptTokens.toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label" style="font-size:11px;color:#666;">Tool definitions</span><span class="stat-value" style="font-size:11px;">~${overhead.toolDefTokens.toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-label" style="font-size:11px;color:#666;">Run <code>context(mode="total_tokens")</code> for live conversation data</span></div>
    `;

    // Breakdown by level
    if (mem.byLevel && mem.byLevel.length > 0) {
      let levelHtml = `<div class="section"><h3>Memory by Level</h3>
        <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Level</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Nodes</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Tokens</th>
        </tr></thead><tbody>`;
      for (const l of mem.byLevel) {
        const pct = totalView > 0 ? ((l.tokens / totalView) * 100).toFixed(1) : "0";
        levelHtml += `<tr><td style="padding:4px 8px;border-bottom:1px solid #222">L${l.level}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${l.count}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${l.tokens.toLocaleString()} (${pct}%)</td></tr>`;
      }
      levelHtml += `</tbody></table></div></div>`;
      breakdownEl.innerHTML = levelHtml;
    }

    // Injection history
    if (inj.length > 0) {
      let injHtml = `<div class="section"><h3>Recent Injections</h3>
        <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Session</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Nodes</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Tokens</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Mode</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Strategy</th>
        </tr></thead><tbody>`;
      for (const i of inj) {
        injHtml += `<tr><td style="padding:4px 8px;border-bottom:1px solid #222">${i.sessionId.slice(0, 8)}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${i.nodeCount}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${i.tokens.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #222">${i.mode}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #222">${i.strategy || "—"}</td></tr>`;
      }
      injHtml += `</tbody></table></div></div>`;
      tablesEl.innerHTML = injHtml;
    }

    // Memory by type
    if (mem.byType && mem.byType.length > 0) {
      let typeHtml = `<div class="section"><h3>Memory by Type</h3>
        <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Type</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Nodes</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Tokens</th>
        </tr></thead><tbody>`;
      for (const t of mem.byType) {
        typeHtml += `<tr><td style="padding:4px 8px;border-bottom:1px solid #222">${t.type}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${t.count}</td>
          <td style="text-align:right;padding:4px 8px;border-bottom:1px solid #222">${t.tokens.toLocaleString()}</td></tr>`;
      }
      typeHtml += `</tbody></table></div></div>`;
      tablesEl.innerHTML += typeHtml;
    }
  } catch (e) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label" style="color:#f44">Error loading context data</span></div>`;
    console.error("Context dashboard load failed:", e);
  }
}

// ==================== Injection Quality ====================

async function loadQuality() {
  const summaryEl = document.getElementById("quality-summary");
  const chartsEl = document.getElementById("quality-charts");
  if (!summaryEl || !chartsEl) return;

  summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">Loading quality metrics...</span></div>`;
  chartsEl.innerHTML = "";

  try {
    const res = await fetch("/api/injection-quality?limit=100");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const metrics = data.metrics || [];
    renderQuality(summaryEl, chartsEl, metrics);
  } catch (e) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label" style="color:#f44">Error loading quality data</span></div>`;
    console.error("Quality load failed:", e);
  }
}

// ── Canvas chart helpers ──

function renderBarChart(canvas, labels, values, colors, title) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 28, bottom: 28, left: 10, right: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...values, 1);
  const barW = Math.min(40, chartW / labels.length * 0.7);
  const gap = chartW / labels.length;

  ctx.clearRect(0, 0, w, h);

  // Title
  ctx.fillStyle = "#aaa";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(title, w / 2, 14);

  // Bars
  for (let i = 0; i < labels.length; i++) {
    const x = pad.left + i * gap + (gap - barW) / 2;
    const barH = (values[i] / maxVal) * chartH;
    const y = pad.top + chartH - barH;

    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, barH);

    // Label
    ctx.fillStyle = "#888";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], pad.left + i * gap + gap / 2, h - 6);

    // Value
    ctx.fillStyle = "#ccc";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(values[i]), pad.left + i * gap + gap / 2, y - 4);
  }
}

function renderTimelineChart(canvas, dates, counts, title) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 28, bottom: 28, left: 10, right: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...counts, 1);

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#aaa";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(title, w / 2, 14);

  if (counts.length < 2) {
    if (counts.length === 1) {
      ctx.fillStyle = "#4a9eff";
      const cx = w / 2;
      const barW = 40;
      const barH = (counts[0] / maxVal) * chartH;
      ctx.fillRect(cx - barW / 2, pad.top + chartH - barH, barW, barH);
      ctx.fillStyle = "#ccc";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(counts[0]), cx, pad.top + chartH - barH - 4);
    }
    return;
  }

  const step = chartW / (counts.length - 1);
  const color = "#34d399";

  // Fill area
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + chartH);
  for (let i = 0; i < counts.length; i++) {
    const x = pad.left + i * step;
    const y = pad.top + chartH - (counts[i] / maxVal) * chartH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(pad.left + (counts.length - 1) * step, pad.top + chartH);
  ctx.closePath();
  ctx.fillStyle = "rgba(52, 211, 153, 0.15)";
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < counts.length; i++) {
    const x = pad.left + i * step;
    const y = pad.top + chartH - (counts[i] / maxVal) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dots
  for (let i = 0; i < counts.length; i++) {
    const x = pad.left + i * step;
    const y = pad.top + chartH - (counts[i] / maxVal) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Labels (alternating to avoid overlap)
  for (let i = 0; i < counts.length; i++) {
    const x = pad.left + i * step;
    ctx.fillStyle = "#666";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const label = i % Math.max(1, Math.floor(counts.length / 8)) === 0 || i === counts.length - 1 ? dates[i] : "";
    ctx.fillText(label, x, h - 6);
  }
}

function renderQuality(summaryEl, chartsEl, metrics) {
  if (metrics.length === 0) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">No injection data yet. Auto-retrieve must fire at least once.</span></div>`;
    return;
  }

  // Summary stats
  const totalInjections = metrics.length;
  const withRerank = metrics.filter(m => m.rerankStrategy);
  const strategies = [...new Set(withRerank.map(m => m.rerankStrategy).filter(Boolean))];
  const withScores = metrics.filter(m => m.rerankScores && m.rerankScores.length > 0);
  const allScores = withScores.flatMap(m => m.rerankScores);
  const avgScore = allScores.length > 0 ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(3) : "—";
  const totalReranked = withRerank.reduce((sum, m) => sum + (m.preRerankIds?.length || m.injectedNodeCount), 0);
  const totalSelected = metrics.reduce((sum, m) => sum + m.injectedNodeCount, 0);
  const passRate = totalReranked > 0 ? ((totalSelected / totalReranked) * 100).toFixed(1) : "—";

  // Strategy breakdown
  const stratCounts = {};
  for (const m of metrics) {
    const s = m.rerankStrategy || "none";
    stratCounts[s] = (stratCounts[s] || 0) + 1;
  }
  const stratHtml = Object.entries(stratCounts).map(([s, c]) =>
    `<span class="stat-label">${s}: ${c} injections</span>`
  ).join("<br>");

  // Type distribution
  const typeDist = {};
  for (const m of metrics) {
    if (m.injectedNodeTypes) {
      for (const [type, count] of Object.entries(m.injectedNodeTypes)) {
        typeDist[type] = (typeDist[type] || 0) + count;
      }
    }
  }
  const typeHtml = Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
    `<span class="stat-value">${t}: ${c}</span>`
  ).join(" ");

  summaryEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Total Injections</span><span class="stat-value">${totalInjections}</span></div>
    <div class="stat-row"><span class="stat-label">With Reranking</span><span class="stat-value">${withRerank.length} (${strategies.join(", ") || "none"})</span></div>
    <div class="stat-row"><span class="stat-label">Pass Rate</span><span class="stat-value">${passRate}%</span></div>
    <div class="stat-row"><span class="stat-label">Avg Score</span><span class="stat-value">${avgScore}</span></div>
    <div class="stat-row"><span class="stat-label">Strategies</span><br>${stratHtml}</div>
    <div class="stat-row"><span class="stat-label">Node Types</span><br>${typeHtml || "—"}</div>
  `;

  // ── Charts section ──
  const CHART_COLORS = ["#4a9eff", "#34d399", "#fb923c", "#a78bfa", "#f472b6", "#fbbf24", "#ef4444"];
  const CARD = "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px;";

  let chartsHtml = `<div class="section" style="margin-bottom:16px;"><h3>Injection Charts</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">`;

  // 1. Score distribution histogram
  chartsHtml += `<div style="${CARD}"><canvas id="chart-score-dist" width="300" height="180"></canvas></div>`;

  // 2. Strategy comparison
  chartsHtml += `<div style="${CARD}"><canvas id="chart-strategy-compare" width="300" height="180"></canvas></div>`;

  // 3. Timeline
  chartsHtml += `<div style="${CARD}"><canvas id="chart-timeline" width="300" height="180"></canvas></div>`;

  // 4. Node type distribution
  chartsHtml += `<div style="${CARD}"><canvas id="chart-type-dist" width="300" height="180"></canvas></div>`;

  chartsHtml += `</div></div>`;

  // ── Detailed table ──
  let tableHtml = `<div class="section"><h3>Recent Injections</h3>
    <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Time</th>
      <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Strategy</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Count</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Scores</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Duration</th>
      <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Types</th>
      <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Query</th>
    </tr></thead><tbody>`;

  for (const m of metrics.slice(0, 50)) {
    const time = new Date(m.timestamp).toLocaleTimeString();
    const scores = m.rerankScores ? m.rerankScores.map(s => s.toFixed(2)).join(", ") : "—";
    const duration = m.rerankDurationMs ? `${m.rerankDurationMs}ms` : "—";
    const types = m.injectedNodeTypes ? Object.entries(m.injectedNodeTypes).map(([t, c]) => `${t}:${c}`).join(" ") : "—";
    const query = m.queryText ? m.queryText.slice(0, 40) + (m.queryText.length > 40 ? "…" : "") : "—";
    const strategy = m.rerankStrategy || "none";
    const count = `${m.preRerankIds?.length || "?"} → ${m.injectedNodeCount}`;

    tableHtml += `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #222;color:#aaa">${time}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;color:#6af">${strategy}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${count}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right;font-family:monospace;font-size:10px">${scores}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${duration}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;font-size:10px">${types}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #222;color:#888;font-size:10px">${query}</td>
    </tr>`;
  }

  tableHtml += `</tbody></table></div></div>`;
  chartsEl.innerHTML = chartsHtml + tableHtml;

  // ── Render canvas charts (must be after DOM insert) ──

  // 1. Score distribution histogram
  const scoreBuckets = {};
  const BUCKET_SIZE = 0.1;
  for (const m of metrics) {
    if (m.rerankScores) {
      for (const s of m.rerankScores) {
        const b = Math.floor(s / BUCKET_SIZE) * BUCKET_SIZE;
        const key = b.toFixed(1) + "-" + (b + BUCKET_SIZE).toFixed(1);
        scoreBuckets[key] = (scoreBuckets[key] || 0) + 1;
      }
    }
  }
  const scoreCanvas = document.getElementById("chart-score-dist");
  if (scoreCanvas && Object.keys(scoreBuckets).length > 0) {
    renderBarChart(scoreCanvas,
      Object.keys(scoreBuckets).sort(),
      Object.values(scoreBuckets),
      CHART_COLORS,
      "Rerank Score Distribution"
    );
  }

  // 2. Strategy comparison (avg scores)
  const stratScores = {};
  for (const m of metrics) {
    if (m.rerankScores && m.rerankScores.length > 0) {
      const s = m.rerankStrategy || "none";
      if (!stratScores[s]) stratScores[s] = [];
      stratScores[s].push(...m.rerankScores);
    }
  }
  const stratCanvas = document.getElementById("chart-strategy-compare");
  if (stratCanvas && Object.keys(stratScores).length > 0) {
    const stratLabels = Object.keys(stratScores);
    const stratAvgs = stratLabels.map(k => {
      const vals = stratScores[k];
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    renderBarChart(stratCanvas,
      stratLabels,
      stratAvgs.map(v => Math.round(v * 100)),
      CHART_COLORS,
      "Avg Score by Strategy (%)"
    );
  }

  // 3. Timeline (injections per day)
  const dayCounts = {};
  for (const m of metrics) {
    const d = new Date(m.timestamp);
    const key = d.toLocaleDateString();
    dayCounts[key] = (dayCounts[key] || 0) + 1;
  }
  const timelineCanvas = document.getElementById("chart-timeline");
  if (timelineCanvas && Object.keys(dayCounts).length > 0) {
    const sortedDays = Object.keys(dayCounts).sort((a, b) => new Date(a) - new Date(b));
    renderTimelineChart(timelineCanvas,
      sortedDays,
      sortedDays.map(d => dayCounts[d]),
      "Injection Timeline"
    );
  }

  // 4. Node type distribution
  const typeCanvas = document.getElementById("chart-type-dist");
  if (typeCanvas && Object.keys(typeDist).length > 0) {
    const sorted = Object.entries(typeDist).sort((a, b) => b[1] - a[1]);
    renderBarChart(typeCanvas,
      sorted.map(([t]) => t),
      sorted.map(([, c]) => c),
      CHART_COLORS,
      "Node Types Injected"
    );
  }
}

async function loadCompressStats() {
  const summaryEl = document.getElementById("compress-summary");
  const chartsEl = document.getElementById("compress-charts");
  if (!summaryEl || !chartsEl) return;

  summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">Loading compression stats...</span></div>`;
  chartsEl.innerHTML = "";

  try {
    const res = await fetch("/api/compress-stats?days=30&limit=20");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderCompressStats(summaryEl, chartsEl, data);
  } catch (e) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label" style="color:#f44">Error loading compression data</span></div>`;
    console.error("Compress stats load failed:", e);
  }
}

function renderCompressStats(summaryEl, chartsEl, data) {
  const total = data.total;

  if (total.calls === 0) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">No compression data yet. Bash commands will be tracked automatically.</span></div>`;
    return;
  }

  const savingsDisplay = total.savingsPercent > 0
    ? `<span style="color:#4a4">-${total.savingsPercent}%</span>`
    : `<span style="color:#888">0%</span>`;

  const avgCharsSaved = total.calls > 0
    ? Math.round((total.originalChars - total.compressedChars) / total.calls)
    : 0;

  summaryEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Total Compressed Calls</span><span class="stat-value">${total.calls}</span></div>
    <div class="stat-row"><span class="stat-label">Original Chars</span><span class="stat-value">${(total.originalChars / 1000).toFixed(0)}K</span></div>
    <div class="stat-row"><span class="stat-label">Compressed Chars</span><span class="stat-value">${(total.compressedChars / 1000).toFixed(0)}K</span></div>
    <div class="stat-row"><span class="stat-label">Chars Saved</span><span class="stat-value">${savingsDisplay} (avg ${avgCharsSaved.toLocaleString()}/call)</span></div>
  `;

  const strategies = data.byStrategy || [];
  const byCommand = data.byCommand || [];
  const recent = data.recent || [];

  let html = "";

  // --- By Strategy ---
  if (strategies.length > 0) {
    html += `<div class="section"><h3>By Strategy</h3>`;
    html += `<div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Strategy</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Calls</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Raw (K)</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Comp (K)</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Saved</th>
      </tr></thead><tbody>`;
    for (const s of strategies) {
      const pct = s.raw > 0 ? Math.round((1 - s.comp / s.raw) * 100) : 0;
      html += `<tr>
        <td style="padding:2px 8px;border-bottom:1px solid #222;color:#6af;font-size:10px">${s.strategy}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${s.calls}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${(s.raw / 1000).toFixed(0)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${(s.comp / 1000).toFixed(0)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;color:${pct > 0 ? '#4a4' : '#888'}">${pct}%</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  // --- Top Commands ---
  if (byCommand.length > 0) {
    html += `<div class="section"><h3>Top Commands</h3>`;
    html += `<div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Command</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Calls</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Raw</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Compressed</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Saved</th>
      </tr></thead><tbody>`;
    for (const c of byCommand) {
      const pct = c.raw > 0 ? Math.round((1 - c.comp / c.raw) * 100) : 0;
      html += `<tr>
        <td style="padding:2px 8px;border-bottom:1px solid #222;color:#aaa;font-family:monospace;font-size:10px">${c.command.slice(0, 50)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${c.calls}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${(c.raw / 1000).toFixed(0)}K</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right">${(c.comp / 1000).toFixed(0)}K</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;color:${pct > 0 ? '#4a4' : '#888'}">${pct}%</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  // --- Recent Compressions (Before & After Detail) ---
  if (recent.length > 0) {
    html += `<div class="section"><h3>Recent Compressions</h3>`;
    html += `<p style="color:#888;font-size:10px;margin-bottom:8px;">Click any row for before/after detail. Hover for tooltip.</p>`;
    html += `<div style="overflow-x:auto"><table class="quality-table compress-detail-table" style="width:100%;border-collapse:collapse;font-size:11px;cursor:pointer;">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Time</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Strat</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Before</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">After</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Δ Lines</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Saved</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Duration</th>
      </tr></thead><tbody>`;
    for (let i = 0; i < recent.length; i++) {
      const r = recent[i];
      const time = new Date(r.timestamp).toLocaleTimeString();
      const pct = Math.round(r.savingsRatio * 100);
      const beforeK = (r.originalChars / 1000).toFixed(1);
      const afterK = (r.compressedChars / 1000).toFixed(1);
      const linesDelta = (r.originalLines ?? 0) - (r.compressedLines ?? 0);
      const duration = r.durationMs ? `${r.durationMs}ms` : "—";
      const savingsColor = pct > 50 ? '#4a4' : pct > 20 ? '#aa4' : '#888';
      html += `<tr class="compress-row" data-idx="${i}" style="border-bottom:1px solid #222;">
        <td style="padding:2px 8px;color:#888;font-size:10px">${time}</td>
        <td style="padding:2px 8px;color:#6af;font-size:10px;white-space:nowrap">${r.strategy}</td>
        <td style="padding:2px 8px;text-align:right;font-family:monospace;font-size:10px;color:#f88">${beforeK}K</td>
        <td style="padding:2px 8px;text-align:right;font-family:monospace;font-size:10px;color:#4a4">${afterK}K</td>
        <td style="padding:2px 8px;text-align:right;font-size:10px;color:${linesDelta > 0 ? '#4a4' : '#888'}">${linesDelta > 0 ? '-' + linesDelta : '0'}</td>
        <td style="padding:2px 8px;text-align:right;font-size:10px;color:${savingsColor}">${pct}%</td>
        <td style="padding:2px 8px;text-align:right;font-size:10px;color:#888">${duration}</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  chartsEl.innerHTML = html;

  // Wire click-to-detail on compress rows
  document.querySelectorAll(".compress-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = parseInt(row.dataset.idx, 10);
      if (!isNaN(idx) && recent[idx]) {
        showCompressDetail(recent[idx]);
      }
    });
  });
}

function showCompressDetail(event) {
  const overlay = document.getElementById("compress-detail-overlay");
  const modal = document.getElementById("compress-detail-modal");
  if (!overlay || !modal) return;

  const pct = Math.round(event.savingsRatio * 100);
  
  const savingsColor = pct > 50 ? '#4a4' : pct > 20 ? '#aa4' : '#888';

  const originalPreview = event.originalPreview || "(no preview stored — upgrade to schema v27)";
  const compressedPreview = event.compressedPreview || "(no preview stored — upgrade to schema v27)";

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="margin:0;font-size:14px;color:#fff">Compression Detail</h3>
      <button id="close-detail-btn" style="background:none;border:1px solid #444;color:#aaa;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">✕</button>
    </div>

    <div style="margin-bottom:12px;">
      <div style="color:#888;font-size:10px;margin-bottom:2px;">Command</div>
      <div style="font-family:monospace;font-size:11px;color:#ddd;background:#0a0a0a;padding:6px 8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${event.command}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:#0d0d0d;border:1px solid #222;border-radius:6px;padding:10px;text-align:center;">
        <div style="color:#f88;font-size:18px;font-weight:bold;font-family:monospace;">${(event.originalChars / 1000).toFixed(1)}K</div>
        <div style="color:#888;font-size:10px;margin-top:2px;">chars before</div>
        <div style="color:#888;font-size:10px;">${event.originalLines ?? '?'} lines</div>
      </div>
      <div style="background:#0d0d0d;border:1px solid #222;border-radius:6px;padding:10px;text-align:center;">
        <div style="color:#4a4;font-size:18px;font-weight:bold;font-family:monospace;">${(event.compressedChars / 1000).toFixed(1)}K</div>
        <div style="color:#888;font-size:10px;margin-top:2px;">chars after</div>
        <div style="color:#888;font-size:10px;">${event.compressedLines ?? '?'} lines</div>
      </div>
      <div style="background:#0d0d0d;border:1px solid #222;border-radius:6px;padding:10px;text-align:center;">
        <div style="color:${savingsColor};font-size:18px;font-weight:bold;font-family:monospace;">${pct}%</div>
        <div style="color:#888;font-size:10px;margin-top:2px;">savings</div>
        <div style="color:#888;font-size:10px;">${event.durationMs ? event.durationMs + 'ms' : '—'}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <div style="color:#888;font-size:10px;">Strategy</div>
        <div style="color:#6af;font-size:10px;">${event.strategy}</div>
        <div style="color:#888;font-size:10px;margin-left:16px;">Lines: ${event.originalLines ?? '?'} → ${event.compressedLines ?? '?'}</div>
        <div style="color:#4a4;font-size:10px;margin-left:16px;">Saved ${(event.originalChars - event.compressedChars).toLocaleString()} chars</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid #333;padding-top:12px;">
      <div>
        <div style="color:#f88;font-size:11px;font-weight:bold;margin-bottom:4px;">⬅ Before (raw output)</div>
        <pre style="background:#0a0a0a;border:1px solid #222;border-radius:4px;padding:8px;font-size:10px;color:#ccc;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${escHtml(originalPreview)}</pre>
      </div>
      <div>
        <div style="color:#4a4;font-size:11px;font-weight:bold;margin-bottom:4px;">➡ After (compressed)</div>
        <pre style="background:#0a0a0a;border:1px solid #222;border-radius:4px;padding:8px;font-size:10px;color:#ccc;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${escHtml(compressedPreview)}</pre>
      </div>
    </div>
  `;

  overlay.style.display = "flex";

  document.getElementById("close-detail-btn").addEventListener("click", () => {
    overlay.style.display = "none";
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });
}

function escHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ==================== Token History ====================

async function loadTokenHistory() {
  const summaryEl = document.getElementById("tokens-summary");
  const breakdownEl = document.getElementById("tokens-breakdown");
  const recentEl = document.getElementById("tokens-recent");
  if (!summaryEl || !breakdownEl || !recentEl) return;

  summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">Loading token history...</span></div>`;
  breakdownEl.innerHTML = "";
  recentEl.innerHTML = "";

  try {
    const res = await fetch("/api/token-history?days=30&limit=100");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTokenHistory(summaryEl, breakdownEl, recentEl, data);
  } catch (e) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label" style="color:#f44">Error loading token history</span></div>`;
    console.error("Token history load failed:", e);
  }
}

function renderTokenHistory(summaryEl, breakdownEl, recentEl, data) {
  const fmt = (n) => {
    if (!n && n !== 0) return "0";
    if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  };

  const fmtCost = (c) => {
    if (!c || c === 0) return "$0";
    return "$" + c.toFixed(c < 0.01 ? 6 : c < 1 ? 4 : 2);
  };

  if (data.totalTurns === 0) {
    summaryEl.innerHTML = `<div class="stat-row"><span class="stat-label">No token data yet. Run a session and trigger compaction to populate.</span></div>`;
    return;
  }

  const cacheTotal = data.recentTurns.reduce((s, t) => s + t.cacheReadTokens + t.cacheWriteTokens, 0);
  const totalIn = data.totalInputTokens + data.totalOutputTokens + data.totalReasoningTokens + cacheTotal;

  summaryEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Sessions Tracked</span><span class="stat-value">${data.totalSessions}</span></div>
    <div class="stat-row"><span class="stat-label">Total Turns</span><span class="stat-value">${data.totalTurns}</span></div>
    <div class="stat-row"><span class="stat-label">Input Tokens</span><span class="stat-value">${fmt(data.totalInputTokens)}</span></div>
    <div class="stat-row"><span class="stat-label">Output Tokens</span><span class="stat-value">${fmt(data.totalOutputTokens)}</span></div>
    <div class="stat-row"><span class="stat-label">Reasoning Tokens</span><span class="stat-value">${fmt(data.totalReasoningTokens)}</span></div>
    <div class="stat-row"><span class="stat-label">Cache Tokens</span><span class="stat-value">${fmt(cacheTotal)}</span></div>
    <div class="stat-row"><span class="stat-label">Total All Tokens</span><span class="stat-value"><strong>${fmt(totalIn)}</strong></span></div>
    <div class="stat-row"><span class="stat-label">Total Cost</span><span class="stat-value" style="color:#fbbf24;">${fmtCost(data.totalCost)}</span></div>
  `;

  // Session breakdown
  if (data.bySession && data.bySession.length > 0) {
    let html = `<div class="section"><h3>By Session</h3>
      <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Session</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Turns</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Input</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Output</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Reasoning</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Cost</th>
      </tr></thead><tbody>`;
    for (const s of data.bySession) {
      html += `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #222;font-family:monospace;font-size:10px;color:#aaa">${s.sessionId.slice(0, 8)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${s.turns}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${fmt(s.inputTokens)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${fmt(s.outputTokens)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right">${fmt(s.reasoningTokens)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #222;text-align:right;color:#fbbf24">${fmtCost(s.cost)}</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
    breakdownEl.innerHTML = html;
  }

  // Recent turns
  if (data.recentTurns && data.recentTurns.length > 0) {
    let html = `<div class="section"><h3>Recent Turns</h3>
      <div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Time</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">In</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Out</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Rsn</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">CR</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">CW</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #333;color:#888">Cost</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #333;color:#888">Model</th>
      </tr></thead><tbody>`;
    for (const t of data.recentTurns.slice(0, 30)) {
      const time = new Date(t.timestamp).toLocaleTimeString();
      const model = t.model ? t.model.split("/").pop() || t.model : "—";
      html += `<tr>
        <td style="padding:2px 8px;border-bottom:1px solid #222;font-size:10px;color:#888">${time}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px">${fmt(t.inputTokens)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px">${fmt(t.outputTokens)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px;color:${t.reasoningTokens > 0 ? '#a78bfa' : '#888'}">${fmt(t.reasoningTokens)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px">${fmt(t.cacheReadTokens)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px">${fmt(t.cacheWriteTokens)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;font-size:10px;color:#fbbf24">${fmtCost(t.cost)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;font-size:10px;color:#aaa">${model}</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
    recentEl.innerHTML = html;
  }
}

// ==================== Graph ====================

async function loadGraphData() {
  const statusEl = document.getElementById("graph-status");
  const statsEl = document.getElementById("graph-stats");
  try {
    const res = await fetch("/api/graph");
    const data = await res.json();
    if (!data.built) {
      statusEl.textContent = data.message || "No graph built yet. Click \"Build Code Graph\" to start.";
      statsEl.innerHTML = "";
      graphData = null;
      _graphAnalysis = null;
      graphViz.clear();
      return;
    }
    _graphAnalysis = data;
    renderGraphStats(data);
    const exportRes = await fetch("/api/graph/export");
    if (exportRes.ok) {
      graphData = await exportRes.json();
      graphViz.loadFromJSON(graphData);
    }
    statusEl.textContent = `Graph built: ${data.stats.symbols} symbols, ${data.stats.edges} edges, ${data.stats.communities} communities`;
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
  }
}

async function buildGraph() {
  const btn = document.getElementById("graph-build-btn");
  const statusEl = document.getElementById("graph-status");
  btn.disabled = true;
  btn.textContent = "Building...";
  statusEl.textContent = "Building code graph...";
  try {
    const res = await fetch("/api/graph/build", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = `Graph built: ${data.stats.symbols} symbols, ${data.stats.edges} edges`;
      await loadGraphData();
    } else {
      statusEl.textContent = "Error: " + (data.error || "Build failed");
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Build Code Graph";
  }
}

function renderGraphStats(data) {
  const statsEl = document.getElementById("graph-stats");
  const s = data.stats;
  const u = data.usage;
  let usageHtml = "";
  if (u) {
    usageHtml = `
      <h3 style="font-size:12px;color:#888;margin:10px 0 6px;text-transform:uppercase;">Graph Tool Usage</h3>
      <div class="graph-stat-row"><span class="label">Search calls</span><span class="value">${u.search.count}</span></div>
      <div class="graph-stat-row"><span class="label">Path queries</span><span class="value">${u.path.count}</span></div>
      <div class="graph-stat-row"><span class="label">Explain calls</span><span class="value">${u.explain.count}</span></div>
      <div class="graph-stat-row"><span class="label">Background builds</span><span class="value">${u.backgroundBuilds.count}</span></div>
      ${u.build.lastBuild ? `<div class="graph-stat-row"><span class="label">Last build</span><span class="value">${new Date(u.build.lastBuild).toLocaleTimeString()}</span></div>` : ""}
      <h3 style="font-size:12px;color:#888;margin:10px 0 6px;text-transform:uppercase;">Plugin-side</h3>
      <div class="graph-stat-row"><span class="label">File refreshes</span><span class="value">${u.fileRefreshes.count}</span></div>
    `;
  }
  statsEl.innerHTML = `
    <div class="graph-stat-row"><span class="label">Files</span><span class="value">${s.files}</span></div>
    <div class="graph-stat-row"><span class="label">Symbols</span><span class="value">${s.symbols}</span></div>
    <div class="graph-stat-row"><span class="label">Edges</span><span class="value">${s.edges}</span></div>
    <div class="graph-stat-row"><span class="label">Communities</span><span class="value">${s.communities}</span></div>
    ${usageHtml}
  `;

  renderGraphCommunities(data);
  renderGraphGodNodes(data);
  renderGraphSurprising(data);
}

function renderGraphCommunities(data) {
  const body = document.getElementById("graph-communities-body");
  const countEl = document.getElementById("graph-community-count");
  if (!body) return;
  const communities = data.godNodes.reduce((acc, g) => {
    const c = g.community !== undefined ? String(g.community) : "0";
    if (!acc[c]) acc[c] = { count: 0, nodes: [] };
    acc[c].count++;
    acc[c].nodes.push(g);
    return acc;
  }, {});
  const keys = Object.keys(communities);
  countEl.textContent = `(${keys.length})`;

  const palette = GRAPH_COLORS;
  body.innerHTML = keys.map((c, i) => {
    const color = palette[i % palette.length];
    return `<div class="graph-community-item" data-community="${c}">
      <span class="graph-community-dot" style="background:${color}"></span>
      Community ${c} <span style="color:#666;font-size:10px;">(${communities[c].count} god nodes)</span>
    </div>`;
  }).join("");

  body.querySelectorAll(".graph-community-item").forEach(el => {
    el.addEventListener("click", () => {
      graphViz.highlightSearch("");
      const c = el.dataset.community;
      graphViz.nodeGroup.selectAll("g.node").attr("opacity", d => {
        return String(d.community) === c ? 1 : 0.15;
      });
      graphViz.labelElements.attr("opacity", d => {
        return String(d.community) === c ? 1 : 0.1;
      });
      graphViz.linkElements.attr("stroke-opacity", d => {
        const s = graphViz.nodeMap.get(d.source.id || d.source);
        const t = graphViz.nodeMap.get(d.target.id || d.target);
        if (!s || !t) return 0.05;
        return String(s.community) === c || String(t.community) === c
          ? (EDGE_OPACITIES[d.confidence] || 0.3) : 0.05;
      });
    });
  });
}

function renderGraphGodNodes(data) {
  const body = document.getElementById("graph-god-body");
  const countEl = document.getElementById("graph-god-count");
  if (!body) return;
  countEl.textContent = `(${data.godNodes.length})`;
  body.innerHTML = data.godNodes.map(g => {
    const label = g.label.length > 35 ? g.label.slice(0, 35) + "…" : g.label;
    const fileParts = g.file ? g.file.split("/") : [];
    const fileName = fileParts.length > 0 ? fileParts[fileParts.length - 1] : "";
    return `<div class="graph-god-item" data-label="${g.label}">
      <strong>${label}</strong> <span class="graph-god-degree">deg ${g.degree}</span><br>
      <span style="color:#666;font-size:10px;">${fileName}${g.line ? ":" + g.line : ""}</span>
    </div>`;
  }).join("");

  body.querySelectorAll(".graph-god-item").forEach(el => {
    el.addEventListener("click", () => {
      const label = el.dataset.label;
      const node = graphViz.nodes.find(n => n.label === label);
      if (node) {
        graphViz.focusOnNode(node.id);
        showGraphNodeDetail(node);
      }
    });
  });
}

function renderGraphSurprising(data) {
  const body = document.getElementById("graph-surprising-body");
  const countEl = document.getElementById("graph-surprising-count");
  if (!body) return;
  const connections = data.surprisingConnections || [];
  countEl.textContent = `(${connections.length})`;
  if (connections.length === 0) {
    body.innerHTML = '<div style="font-size:11px;color:#666;">No surprising cross-community connections found</div>';
    return;
  }
  body.innerHTML = connections.map(sc => `
    <div class="graph-surprising-item">
      <span style="color:#4a9eff;">${sc.source}</span>
      <span style="color:#666;font-size:10px;"> ${sc.relation} </span>
      <span style="color:#34d399;">${sc.target}</span>
    </div>
  `).join("");
}

async function showGraphNodeDetail(node) {
  const panel = document.getElementById("graph-detail-panel");
  const title = document.getElementById("graph-detail-title");
  const content = document.getElementById("graph-detail-content");

  title.textContent = node.label;

  let html = `
    <div class="graph-detail-section">
      <h4>Type</h4>
      <div class="detail-value">${node.type}${node.kind ? ` &middot; ${node.kind}` : ""}</div>
    </div>
  `;

  if (node.file) {
    html += `
      <div class="graph-detail-section">
        <h4>File</h4>
        <div class="detail-value">${node.file}${node.line ? ":" + node.line : ""}</div>
      </div>
    `;
  }

  html += `
    <div class="graph-detail-section">
      <h4>Metrics</h4>
      <div class="graph-stat-row"><span class="label">Degree</span><span class="value">${node.degree || 0}</span></div>
      <div class="graph-stat-row"><span class="label">Community</span><span class="value">${node.community || "—"}</span></div>
    </div>
  `;

  html += '<div class="graph-detail-section"><h4>Neighbors</h4>';

  try {
    const res = await fetch("/api/graph/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: node.id }),
    });
    if (res.ok) {
      const explainData = await res.json();
      html += `<div style="font-size:11px;color:#888;margin-bottom:4px;">${explainData.neighbors.length} connections</div>`;

      const sorted = (explainData.neighbors || []).sort((a, b) => a.relation.localeCompare(b.relation));
      if (sorted.length === 0) {
        html += '<div class="graph-nb-none">No direct connections</div>';
      } else {
        html += sorted.slice(0, 30).map(nb => {
          const relLabel = nb.relation.startsWith("inverse_") ? nb.relation.replace("inverse_", "← ") : nb.relation;
          const relClass = nb.relation.startsWith("inverse_") ? "inverse" : "direct";
          return `<div class="graph-neighbor-item" data-id="${nb.id}">
            <span class="graph-neighbor-relation ${relClass}">${relLabel}</span>
            <span>${nb.label}</span>
            <span style="color:#666;font-size:10px;">${nb.file ? nb.file.split("/").pop() : ""}</span>
          </div>`;
        }).join("");
      }

      html += '</div>';

      content.innerHTML = html;

      content.querySelectorAll(".graph-neighbor-item").forEach(el => {
        el.addEventListener("click", async () => {
          const nid = el.dataset.id;
          const neighborNode = graphViz.nodeMap.get(nid);
          if (neighborNode) {
            graphViz.focusOnNode(nid);
            showGraphNodeDetail(neighborNode);
          }
        });
      });
    } else {
      html += '<div class="graph-nb-none">Could not load neighbors</div></div>';
      content.innerHTML = html;
    }
  } catch {
    html += '<div class="graph-nb-none">Error loading neighbors</div></div>';
    content.innerHTML = html;
  }

  panel.classList.add("open");
}

function graphSearch(query) {
  const info = document.getElementById("graph-search-info");
  const results = document.getElementById("graph-search-results");
  if (!graphViz || !graphViz.nodes) {
    info.textContent = graphViz ? "Build graph first" : "Graph not initialized";
    results.innerHTML = "";
    return;
  }
  if (!query || !query.trim()) {
    graphViz.highlightSearch("");
    info.textContent = "";
    results.innerHTML = "";
    return;
  }
  graphViz.highlightSearch(query);
  const q = query.toLowerCase();
  const matches = graphViz.nodes.filter(n =>
    n.label.toLowerCase().includes(q) ||
    (n.file && n.file.toLowerCase().includes(q))
  );
  if (matches.length === 0) {
    info.textContent = "No matching nodes";
    results.innerHTML = "";
  } else {
    info.textContent = `${matches.length} matching node(s)`;
    results.innerHTML = matches.slice(0, 30).map(n => {
      const icon = (n.type === "function" ? "ƒ" : n.type === "class" ? "C" : n.type === "interface" ? "I" : "·");
      const label = n.label.length > 40 ? n.label.slice(0, 37) + "..." : n.label;
      return `<div class="graph-search-result" data-node-id="${n.id || n.label}" style="padding:3px 6px;cursor:pointer;border-radius:3px;display:flex;align-items:center;gap:6px;"><span style="width:16px;text-align:center;font-family:monospace;color:#888;">${icon}</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span><span style="font-size:10px;color:#555;">${n.file ? n.file.split("/").pop() : ""}</span></div>`;
    }).join("");
  }
}

function setupGraphSearchResults() {
  document.getElementById("graph-search-results").addEventListener("click", (e) => {
    const row = e.target.closest(".graph-search-result");
    if (!row) return;
    const nodeId = row.dataset.nodeId;
    const node = graphViz.nodes.find(n => n.id === nodeId || n.label === nodeId);
    if (node && graphViz.onNodeClick) {
      graphViz.onNodeClick(node);
    }
  });
}

function setupGraphListeners() {
  document.getElementById("graph-build-btn").addEventListener("click", buildGraph);

  const searchInput = document.getElementById("graph-search-input");
  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => graphSearch(searchInput.value), 200);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      graphSearch(searchInput.value);
    }
  });
  setupGraphSearchResults();

  document.getElementById("graph-detail-close").addEventListener("click", () => {
    document.getElementById("graph-detail-panel").classList.remove("open");
  });

  if (graphViz) {
    graphViz.onNodeClick = (node) => {
      if (node) {
        showGraphNodeDetail(node);
      } else {
        document.getElementById("graph-detail-panel").classList.remove("open");
      }
    };
  }
}

// ==================== Live Agent Polling ====================

let liveAgentInterval = null;
let liveMetricsInterval = null;

function stopLiveAgentPolling() {
  if (liveAgentInterval) {
    clearInterval(liveAgentInterval);
    liveAgentInterval = null;
  }
}

function stopLiveMetricsPolling() {
  if (liveMetricsInterval) {
    clearInterval(liveMetricsInterval);
    liveMetricsInterval = null;
  }
}

async function pollLiveFeed() {
  try {
    const resp = await fetch("/api/live");
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.error) return;
    liveLastTimestamp = data.timestamp || Date.now();
    renderLiveFeed(data);
    renderLiveContext(data);
  } catch {
    // silently retry
  }
}

function renderLiveFeed(data) {
  const feed = document.getElementById("live-feed");
  const status = document.getElementById("live-feed-status");
  const filterVal = (document.getElementById("live-filter-input")?.value || "").toLowerCase();
  if (!feed) return;

  const turns = data.turns || [];
  status.textContent = `${turns.length} turns`;

  let html = "";
  for (const t of turns.slice().reverse()) {
    const ts = new Date(t.timestamp).toLocaleTimeString();
    const role = t.role || "unknown";
    const content = (t.content || "").slice(0, 500);
    const line = `[${ts}] ${role.toUpperCase()}: ${content}`;

    if (filterVal && !line.toLowerCase().includes(filterVal)) continue;

    const cls = `live-${role}`;
    html += `<div class="${cls}"><span class="live-ts">[${ts}]</span> <strong>${role.toUpperCase()}</strong> ${escHtml(content)}</div>`;
  }
  feed.innerHTML = html;
  feed.scrollTop = feed.scrollHeight;
}

function renderLiveContext(data) {
  const ctx = document.getElementById("live-context");
  if (!ctx) return;

  const session = data.session || {};
  const tokenHistory = data.tokenHistory || {};
  const totals = {
    input: tokenHistory.totalInputTokens || 0,
    output: tokenHistory.totalOutputTokens || 0,
    reasoning: tokenHistory.totalReasoningTokens || 0,
  };

  const turns = data.turns || [];
  const lastTurn = turns.length > 0 ? turns[0] : null;

  ctx.innerHTML = `
    <div class="ctx-row"><span class="ctx-label">Session</span><span class="ctx-value">${escHtml(session.session_id || "—")}</span></div>
    <div class="ctx-row"><span class="ctx-label">Status</span><span class="ctx-value">${escHtml(session.status || "—")}</span></div>
    <div class="ctx-row"><span class="ctx-label">Uptime</span><span class="ctx-value">${session.started_at ? fmtDuration(Date.now() - session.started_at) : "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">Tool Calls</span><span class="ctx-value">${session.total_tool_calls ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">File Reads</span><span class="ctx-value">${session.file_reads ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">File Edits</span><span class="ctx-value">${session.file_edits ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">Bash Commands</span><span class="ctx-value">${session.bash_commands ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">Memory Tools</span><span class="ctx-value">${session.memory_tools ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">Injections</span><span class="ctx-value">${session.injection_count ?? "—"}</span></div>
    <div class="ctx-row"><span class="ctx-label">Injected Tokens</span><span class="ctx-value">${(session.injected_tokens ?? 0).toLocaleString()}</span></div>
    <div style="border-top:1px solid #333;padding-top:6px;margin-top:6px;">
      <div class="ctx-row"><span class="ctx-label">Total Input Tokens</span><span class="ctx-value">${totals.input.toLocaleString()}</span></div>
      <div class="ctx-row"><span class="ctx-label">Total Output Tokens</span><span class="ctx-value">${totals.output.toLocaleString()}</span></div>
      <div class="ctx-row"><span class="ctx-label">Total Reasoning</span><span class="ctx-value">${totals.reasoning.toLocaleString()}</span></div>
    </div>
    <div style="border-top:1px solid #333;padding-top:6px;margin-top:6px;">
      <div class="ctx-row"><span class="ctx-label">Last Turn</span><span class="ctx-value">${lastTurn ? new Date(lastTurn.timestamp).toLocaleTimeString() : "—"}</span></div>
      <div class="ctx-row"><span class="ctx-label">Last Role</span><span class="ctx-value">${lastTurn ? lastTurn.role : "—"}</span></div>
      <div class="ctx-row"><span class="ctx-label">Conversation Turns</span><span class="ctx-value">${turns.length}</span></div>
    </div>
  `;
}

function startLiveAgentPolling() {
  stopLiveAgentPolling();
  liveAgentInterval = setInterval(pollLiveFeed, 2000);
  pollLiveFeed();
}

// ==================== Live Metrics Polling ====================

async function pollLiveMetrics() {
  try {
    const resp = await fetch("/api/live");
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.error) return;
    renderLiveInjections(data);
    renderLiveCompressions(data);
    renderLiveToolCalls(data);
    renderLiveTokenChart(data);
  } catch {
    // silently retry
  }
}

function renderLiveInjections(data) {
  const el = document.getElementById("live-injections");
  if (!el) return;
  const items = (data.injections || []).slice(0, 30);
  if (items.length === 0) { el.textContent = "No injection data yet."; return; }
  el.innerHTML = items.map(i => {
    const ts = new Date(i.timestamp).toLocaleTimeString();
    const mode = i.injection_mode || "—";
    const strategy = i.rerank_strategy || "—";
    return `<div class="metric-row"><span class="mt">${ts}</span> ${escHtml(mode)} / ${escHtml(strategy)} / ${i.injected_node_count}n / ${(i.injected_tokens || 0).toLocaleString()}t</div>`;
  }).join("");
}

function renderLiveCompressions(data) {
  const el = document.getElementById("live-compressions");
  if (!el) return;
  const items = (data.compressions || []).slice(0, 30);
  if (items.length === 0) { el.textContent = "No compression data yet."; return; }
  el.innerHTML = items.map(c => {
    const ts = new Date(c.timestamp).toLocaleTimeString();
    const savings = c.savings_ratio ? Math.round((1 - c.savings_ratio) * 100) : 0;
    const cmd = c.cmd_preview || c.command || "—";
    return `<div class="metric-row"><span class="mt">${ts}</span> ${escHtml(cmd)} / ${c.strategy || "—"} / ${(c.original_chars || 0).toLocaleString()}→${(c.compressed_chars || 0).toLocaleString()} (-${savings}%)</div>`;
  }).join("");
}

function renderLiveToolCalls(data) {
  const el = document.getElementById("live-toolcalls");
  if (!el) return;
  const items = (data.toolCalls || []).slice(0, 30);
  if (items.length === 0) { el.textContent = "No tool call data yet."; return; }
  el.innerHTML = items.map(t => {
    const ts = new Date(t.timestamp).toLocaleTimeString();
    const name = t.tool_name || "—";
    const status = t.success ? "✓" : t.success === 0 ? "✗" : "…";
    const dur = t.duration_ms ? `${t.duration_ms}ms` : "—";
    return `<div class="metric-row"><span class="mt">${ts}</span> ${status} ${escHtml(name)} / ${dur}</div>`;
  }).join("");
}

function renderLiveTokenChart(data) {
  const canvas = document.getElementById("live-token-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 20, bottom: 20, left: 10, right: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const recent = (data.tokenHistory?.recentTurns || []).slice(-30);
  if (recent.length < 2) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#555";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Need at least 2 data points", w / 2, h / 2);
    return;
  }

  const inputVals = recent.map(t => t.inputTokens || 0);
  const outputVals = recent.map(t => t.outputTokens || 0);
  const reasonVals = recent.map(t => t.reasoningTokens || 0);
  const maxVal = Math.max(1, ...inputVals, ...outputVals, ...reasonVals);

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#aaa";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Tokens per Turn (last 30)", w / 2, 14);

  const step = chartW / (recent.length - 1);

  function drawLine(vals, color) {
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const x = pad.left + i * step;
      const y = pad.top + chartH - (vals[i] / maxVal) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawLine(inputVals, "#4a9eff");
  drawLine(outputVals, "#34d399");
  drawLine(reasonVals, "#a78bfa");

  ctx.fillStyle = "#555";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillRect(10, h - 14, 8, 8);
  ctx.fillStyle = "#4a9eff";
  ctx.fillText("input", 22, h - 6);
  ctx.fillStyle = "#34d399";
  ctx.fillRect(60, h - 14, 8, 8);
  ctx.fillText("output", 72, h - 6);
  ctx.fillStyle = "#a78bfa";
  ctx.fillRect(115, h - 14, 8, 8);
  ctx.fillText("reasoning", 127, h - 6);
}

function startLiveMetricsPolling() {
  stopLiveMetricsPolling();
  liveMetricsInterval = setInterval(pollLiveMetrics, 3000);
  pollLiveMetrics();
}

function escHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ==================== Start ====================

init();
animate();
