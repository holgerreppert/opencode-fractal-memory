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
  }

  initFromStats(stats) {
    this.levels.clear();
    this.types.clear();
    this.customTypes.clear();
    this.shapes.clear();
    this.projects.clear();

    Object.keys(stats.nodesPerLevel || {}).map(Number).sort((a, b) => a - b).forEach(l => this.levels.add(l));
    Object.keys(stats.nodesPerType || {}).sort().forEach(t => this.types.add(t));
    Object.keys(stats.nodesPerCustomType || {}).sort().forEach(ct => this.customTypes.add(ct));
    Object.keys(stats.nodesPerShape || {}).sort().forEach(s => this.shapes.add(s));
    // projects are managed by dropdown, not auto-populated
  }

  toggleLevel(v) { this._toggle(this.levels, v); this.changed(); }
  toggleType(v) { this._toggle(this.types, v); this.changed(); }
  toggleCustomType(v) { this._toggle(this.customTypes, v); this.changed(); }
  toggleShape(v) { this._toggle(this.shapes, v); this.changed(); }
  toggleProject(v) { this._toggle(this.projects, v); this.changed(); }

  clearAll() {
    this.levels.clear();
    this.types.clear();
    this.customTypes.clear();
    this.shapes.clear();
    this.projects.clear();
    this.searchQuery = "";
    this.serverSearchIds = null;
    this.changed();
  }

  setSearchQuery(q) { this.searchQuery = (q || "").toLowerCase(); }
  setSearchMode(m) { this.searchMode = m; }
  setServerSearchIds(ids) { this.serverSearchIds = ids; }

  changed() {
    if (this.onUpdate) this.onUpdate();
  }

  _toggle(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  matches(node) {
    if (!node) return false;
    if (!this.levels.has(node.level)) return false;
    if (!this.types.has(node.type || "unknown")) return false;

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
    this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.002);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 100, 300);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById("canvas-container").appendChild(this.renderer.domElement);

    this.nodeObjects = [];
    this.edgeObjects = [];
    this.nodePositions = new Map();
    this.nodeVelocities = new Map();
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

  _addLights() {
    const a = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(a);
    const l1 = new THREE.PointLight(0xffffff, 0.8, 1000);
    l1.position.set(200, 200, 200);
    this.scene.add(l1);
    const l2 = new THREE.PointLight(0x4a9eff, 0.4, 800);
    l2.position.set(-200, -100, -200);
    this.scene.add(l2);
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
    el.addEventListener("click", () => this._onClick());

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
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = this.nodeObjects.filter(o => o.isMesh);
    const hits = this.raycaster.intersectObjects(meshes);
    const tooltip = document.getElementById("tooltip");

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
    } else {
      if (this.hoveredNode && this.hoveredNode !== this.selectedNode) {
        this.hoveredNode.material.emissiveIntensity = 0.2;
      }
      this.hoveredNode = null;
      tooltip.style.display = "none";
    }
  }

  _onClick() {
    if (this.hoveredNode) {
      this.selectedNode = this.hoveredNode;
      this._updateHighlight();
      showDetailPanel(this.hoveredNode.userData.nodeData);
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
    this.nodeObjects = [];
    this.edgeObjects = [];
    this.nodePositions.clear();
    this.nodeVelocities.clear();
  }

  buildFromData(data) {
    this.clear();

    if (data.length === 0) {
      console.log("[scene] No data to build");
      return;
    }

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
      const nodeSize = getNodeSize(node);
      const jitterScale = Math.max(1, nodeSize * 0.3);
      if (count > 1) {
        pos.x += (Math.random() - 0.5) * jitterScale * 3;
        pos.y += (Math.random() - 0.5) * jitterScale * 3;
        pos.z += (Math.random() - 0.5) * jitterScale * 3;
      }
      this.nodePositions.set(node.id, pos);
      this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));

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
        color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.9,
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

    console.log(`[scene] Built ${data.length} nodes → ${this.nodeObjects.filter(o => o.isMesh).length} meshes`);
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

  runSimulation(iterations, linkData, temporalEdgeData) {
    const ids = Array.from(this.nodePositions.keys());
    const radii = this.shellRadii || {};

    const nodeLevels = new Map();
    for (const id of ids) {
      const mesh = this.nodeObjects.find(o => o.isMesh && o.userData.nodeId === id);
      nodeLevels.set(id, mesh?.userData?.nodeData?.level ?? 3);
    }

    for (let iter = 0; iter < iterations; iter++) {
      const temp = 1 - iter / iterations;

      for (const id of ids) {
        const pos = this.nodePositions.get(id);
        const vel = this.nodeVelocities.get(id);
        const lvlA = nodeLevels.get(id) ?? 3;
        const wA = Math.max(0.4, 1.0 - lvlA * 0.12);
        const kA = 80 + lvlA * 10;

        for (const oid of ids) {
          if (oid === id) continue;
          const op = this.nodePositions.get(oid);
          const dx = pos.x - op.x, dy = pos.y - op.y, dz = pos.z - op.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const lvlB = nodeLevels.get(oid) ?? 3;
          const wB = Math.max(0.4, 1.0 - lvlB * 0.12);
          const kB = 80 + lvlB * 10;
          const k = (kA + kB) / 2;
          const f = (k * k) / dist * ((wA + wB) / 2);
          vel.x += (dx / dist) * f * 0.015;
          vel.y += (dy / dist) * f * 0.015;
          vel.z += (dz / dist) * f * 0.015;
        }
      }

      const applySpringForces = (edges, sourceKey, targetKey) => {
        edges.forEach(edge => {
          const sp = this.nodePositions.get(edge[sourceKey]);
          const tp = this.nodePositions.get(edge[targetKey]);
          if (!sp || !tp) return;
          const dx = tp.x - sp.x, dy = tp.y - sp.y, dz = tp.z - sp.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const lvlA = nodeLevels.get(edge[sourceKey]) ?? 3;
          const lvlB = nodeLevels.get(edge[targetKey]) ?? 3;
          const restLen = 40 + (lvlA + lvlB) * 8;
          const f = (dist - restLen) * 0.06;
          const sv = this.nodeVelocities.get(edge[sourceKey]);
          const tv = this.nodeVelocities.get(edge[targetKey]);
          sv.x += dx * f * 0.01; sv.y += dy * f * 0.01; sv.z += dz * f * 0.01;
          tv.x -= dx * f * 0.01; tv.y -= dy * f * 0.01; tv.z -= dz * f * 0.01;
        });
      };

      if (linkData) applySpringForces(linkData, "source", "target");
      if (temporalEdgeData) applySpringForces(temporalEdgeData, "source_node_id", "target_node_id");

      for (const id of ids) {
        const pos = this.nodePositions.get(id);
        const vel = this.nodeVelocities.get(id);
        const lvl = nodeLevels.get(id) ?? 3;
        const targetRadius = radii[lvl] ?? 120;
        const curDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 1;

        const shellForce = (targetRadius - curDist) * 0.02;
        vel.x += (pos.x / curDist) * shellForce;
        vel.y += (pos.y / curDist) * shellForce;
        vel.z += (pos.z / curDist) * shellForce;

        vel.x *= 0.85; vel.y *= 0.85; vel.z *= 0.85;
        const maxStep = 8 * temp + 1;
        vel.x = Math.max(-maxStep, Math.min(maxStep, vel.x));
        vel.y = Math.max(-maxStep, Math.min(maxStep, vel.y));
        vel.z = Math.max(-maxStep, Math.min(maxStep, vel.z));

        pos.add(vel);

        const maxRadius = Math.max(targetRadius + 80, targetRadius * 1.3);
        const newDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 1;
        if (newDist > maxRadius) {
          const scale = maxRadius / newDist;
          pos.x *= scale; pos.y *= scale; pos.z *= scale;
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

    // Log final positions for debugging
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    ids.forEach(id => {
      const p = this.nodePositions.get(id);
      if (!p) return;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    let maxDist = 0;
    ids.forEach(id => {
      const p = this.nodePositions.get(id);
      if (!p) return;
      const d = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
      if (d > maxDist) maxDist = d;
    });
    console.log(`[scene] Sim bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}] maxRadius=${maxDist.toFixed(1)}`);
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
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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

// ==================== Init ====================

function init() {
  filterEngine = new NodeFilterEngine();
  sceneCtrl = new SceneController();

  // Wire filter engine to trigger view updates
  filterEngine.onUpdate = () => {
    sceneCtrl.updateVisibility(filterEngine);
  };

  setupEventListeners();
  loadData();
}

// ==================== Event Setup ====================

function setupEventListeners() {
  window.addEventListener("resize", () => sceneCtrl.resize());

  document.getElementById("search-input").addEventListener("input", (e) => {
    filterEngine.setSearchQuery(e.target.value);
    filterEngine.setServerSearchIds(null);
    sceneCtrl.updateVisibility(filterEngine);
  });

  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (filterEngine.searchMode === "text") {
        sceneCtrl.updateVisibility(filterEngine);
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
    sidebar.style.display = sidebar.style.display === "none" ? "block" : "none";
  });

  // Consolidated filter button handler
  document.getElementById("sidebar").addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
    if (!btn) return;

    if (btn.dataset.selectAll !== undefined) {
      const category = btn.dataset.selectAll;
      const container = btn.parentElement;
      container.querySelectorAll(".filter-btn:not(.select-all-btn)").forEach(b => {
        const val = b.dataset.level || b.dataset.type || b.dataset.customType || b.dataset.shape || b.dataset.project;
        if (!val) return;
        if (category === "level") filterEngine.levels.add(parseInt(val));
        else if (category === "type") filterEngine.types.add(val);
        else if (category === "customType") filterEngine.customTypes.add(val);
        else if (category === "shape") filterEngine.shapes.add(val);
        else if (category === "project") filterEngine.projects.add(val);
        b.classList.add("active");
      });
      sceneCtrl.updateVisibility(filterEngine);
      return;
    }

    if (btn.dataset.scope !== undefined) {
      const scope = btn.dataset.scope;
      if (scope === currentScope) return;
      currentScope = scope;
      document.querySelectorAll("#scope-filters .filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterEngine.setSearchQuery("");
      filterEngine.setServerSearchIds(null);
      document.getElementById("search-input").value = "";
      document.getElementById("search-info").textContent = "";
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
    filterEngine.initFromStats(statsData);
    filterEngine.setSearchQuery("");
    filterEngine.setServerSearchIds(null);
    document.getElementById("search-input").value = "";
    document.getElementById("search-info").textContent = "";
    currentProject = "";
    document.getElementById("project-dropdown").value = "";
    buildFilters();
    sceneCtrl.updateVisibility(filterEngine);
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
      const visualizePanel = document.getElementById("visualize-panel");
      const settingsPanel = document.getElementById("settings-panel");
      const backupPanel = document.getElementById("backup-panel");
      const qualityPanel = document.getElementById("quality-panel");
      const compressPanel = document.getElementById("compress-panel");
      if (visualizePanel) visualizePanel.classList.toggle("active", tab === "visualize");
      if (settingsPanel) settingsPanel.classList.toggle("active", tab === "settings");
      if (backupPanel) backupPanel.classList.toggle("active", tab === "backup");
      if (qualityPanel) qualityPanel.classList.toggle("active", tab === "quality");
      if (compressPanel) compressPanel.classList.toggle("active", tab === "compress");
      if (tab === "settings") loadSettings();
      if (tab === "backup") { loadBackupSources(); loadBackupList(); }
      if (tab === "quality") loadQuality();
      if (tab === "compress") loadCompressStats();
    });
  });
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
      sceneCtrl.buildFromData(nodeData);
      sceneCtrl.buildEdges(linkData);
      sceneCtrl.buildTemporalEdges(temporalEdgeData);
      sceneCtrl.runSimulation(150, linkData, temporalEdgeData);
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
  const base = 2 + node.importance * 1.5;
  const accessBoost = Math.min(node.accessCount * 0.3, 6);
  return Math.max(2, Math.min(base + accessBoost, 20));
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

function createTextSprite(text, color) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;

  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = "bold 24px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.fillStyle = hex;
  ctx.fillText(text.length > 25 ? text.slice(0, 25) + "..." : text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.8 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(30, 7.5, 1);
  return sprite;
}

// ==================== UI Builders ====================

function buildUI() {
  buildScopeButtons();
  buildStats();
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
  container.innerHTML = `
    <div class="stat-row"><span class="stat-label">Total Nodes</span><span class="stat-value">${statsData.totalNodes}</span></div>
    <div class="stat-row"><span class="stat-label">Avg Importance</span><span class="stat-value">${statsData.avgImportance}</span></div>
    <div class="stat-row"><span class="stat-label">Avg Usefulness</span><span class="stat-value">${statsData.avgUsefulness}</span></div>
    <div class="stat-row"><span class="stat-label">Total Accesses</span><span class="stat-value">${statsData.totalAccessCount}</span></div>
    <div class="stat-row"><span class="stat-label">Sticky Nodes</span><span class="stat-value">${statsData.stickyCount}</span></div>
  `;
}

function buildFilters() {
  if (!statsData) return;

  filterEngine.initFromStats(statsData);

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
  const legend = document.getElementById("legend");
  let html = "";
  for (const [level, color] of Object.entries(LEVEL_COLORS)) {
    if (statsData.nodesPerLevel[level]) {
      const hex = "#" + color.toString(16).padStart(6, "0");
      html += `<div class="legend-item"><div class="legend-dot" style="background: ${hex}"></div><span class="legend-label">Level ${level}</span></div>`;
    }
  }
  html += `<div style="margin-top: 10px; font-weight: bold; color: #aaa;">Shapes by type:</div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #4a9eff; border-radius: 50%;"></div><span class="legend-label">Sphere = Note / Task / Session / Preference</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #4a9eff; border-radius: 2px;"></div><span class="legend-label">Box = Event / Episode / Architecture / Convention / Bug / Fix</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #34d399; clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);"></div><span class="legend-label">Octahedron = Fact / Concept / Knowledge / Research</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #a78bfa; clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);"></div><span class="legend-label">Dodecahedron = Lesson / Decision</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #f472b6; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);"></div><span class="legend-label">Icosahedron = Skill / Rule</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #ff8c00; border-radius: 50%;"></div><span class="legend-label">Torus (orange) = Playbook</span></div>`;
  html += `<div class="legend-item"><div class="legend-dot" style="background: #ff6b6b; border-radius: 50%;"></div><span class="legend-label">Torus (red) = Middle-Term</span></div>`;
  html += `<div style="margin-top: 10px; font-weight: bold; color: #aaa;">Temporal Edges:</div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #22c55e; border-radius: 1px; flex-shrink: 0;"></div><span class="legend-label">NEXT (sequence)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #3b82f6; border-radius: 1px; border-top: 1px dashed #3b82f6;"></div><span class="legend-label">DURING_SESSION</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #ef4444; border-radius: 1px;"></div><span class="legend-label">CAUSAL (cause-effect)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #eab308; border-radius: 1px; border-top: 1px dotted #eab308;"></div><span class="legend-label">REFERENCES (label refs)</span></div>`;
  html += `<div class="legend-item"><div style="width: 14px; height: 3px; background: #d946ef; border-radius: 1px;"></div><span class="legend-label">RELATED_TO (related)</span></div>`;
  html += `</div>`;
  legend.innerHTML = html;
}

function buildNodeList() {
  const container = document.getElementById("node-list");
  const countEl = document.getElementById("node-list-count");
  const filtered = filterEngine.apply(nodeData);

  countEl.textContent = `(${filtered.length})`;

  const sorted = [...filtered].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return b.importance - a.importance;
  });

  container.innerHTML = sorted.map(node => {
    const color = LEVEL_COLORS[node.level] ?? 0x888888;
    const hex = "#" + color.toString(16).padStart(6, "0");
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
      <div class="stat-row"><span class="stat-label">Importance</span><span class="stat-value">${node.importance}</span></div>
      <div class="stat-row"><span class="stat-label">Usefulness Score</span><span class="stat-value">${node.usefulnessScore}</span></div>
      <div class="stat-row"><span class="stat-label">Access Count</span><span class="stat-value">${node.accessCount}</span></div>
      <div class="stat-row"><span class="stat-label">Times Used</span><span class="stat-value">${node.timesUsed}</span></div>
      <div class="stat-row"><span class="stat-label">Times Helpful</span><span class="stat-value">${node.timesHelpful}</span></div>
      <div class="stat-row"><span class="stat-label">Confidence</span><span class="stat-value">${node.confidence}</span></div>
      <div class="stat-row"><span class="stat-label">Sticky</span><span class="stat-value">${node.sticky ? "Yes" : "No"}</span></div>
      <div class="stat-row"><span class="stat-label">Content Length</span><span class="stat-value">${node.contentLength} chars</span></div>
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
  const panel = document.getElementById("detail-panel");
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
      const sources = Object.entries(b.sources).map(([key, s]) =>
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
  } catch (e) {
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
    document.getElementById('autoFileSummarization-enabled').value = String(config.autoFileSummarization?.enabled ?? false);
    document.getElementById('ollama-enabled').value = String(config.ollama?.enabled ?? false);
    document.getElementById('ollama-model').value = config.ollama?.model ?? 'qwen2.5-coder:1.5b';
    document.getElementById('ollama-baseUrl').value = config.ollama?.baseUrl ?? 'http://localhost:11434';
    document.getElementById('ollama-mode').value = config.ollama?.mode ?? 'binary';
    document.getElementById('ollama-strategy').value = config.ollama?.strategy ?? 'llm';
    document.getElementById('llmCompression-enabled').value = String(config.llmCompression?.enabled ?? false);
    document.getElementById('llmCompression-maxSummaryTokens').value = config.llmCompression?.maxSummaryTokens ?? 500;
    document.getElementById('llmCompression-model').value = config.llmCompression?.model ?? '';
    document.getElementById('fileSkeletonization-enabled').value = String(config.fileSkeletonization?.enabled ?? true);
    document.getElementById('fileSkeletonization-minLines').value = config.fileSkeletonization?.minLines ?? 200;
    document.getElementById('fileSkeletonization-strategy').value = config.fileSkeletonization?.strategy ?? 'ast+regex';
    document.getElementById('commandCompression-enabled').value = String(config.commandCompression?.enabled ?? true);
    document.getElementById('commandCompression-maxLines').value = config.commandCompression?.maxLines ?? 50;
    document.getElementById('commandCompression-excludeCommands').value = (config.commandCompression?.excludeCommands ?? []).join(', ');
    document.getElementById('commandCompression-alwaysFullOnFailure').value = String(config.commandCompression?.alwaysFullOnFailure ?? true);
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
    },
    autoFileSummarization: {
      enabled: document.getElementById('autoFileSummarization-enabled').value === 'true',
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
    fileSkeletonization: {
      enabled: document.getElementById('fileSkeletonization-enabled').value === 'true',
      minLines: parseInt(document.getElementById('fileSkeletonization-minLines').value) || 200,
      strategy: document.getElementById('fileSkeletonization-strategy').value || 'ast+regex',
    },
    commandCompression: {
      enabled: document.getElementById('commandCompression-enabled').value === 'true',
      maxLines: parseInt(document.getElementById('commandCompression-maxLines').value) || 50,
      excludeCommands: document.getElementById('commandCompression-excludeCommands').value.split(',').map(s => s.trim()).filter(Boolean),
      alwaysFullOnFailure: document.getElementById('commandCompression-alwaysFullOnFailure').value === 'true',
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

  // Detailed table
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
  chartsEl.innerHTML = tableHtml;
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

  summaryEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Total Compressed Calls</span><span class="stat-value">${total.calls}</span></div>
    <div class="stat-row"><span class="stat-label">Original Chars</span><span class="stat-value">${(total.originalChars / 1000).toFixed(0)}K</span></div>
    <div class="stat-row"><span class="stat-label">Compressed Chars</span><span class="stat-value">${(total.compressedChars / 1000).toFixed(0)}K</span></div>
    <div class="stat-row"><span class="stat-label">Token Savings</span><span class="stat-value">${savingsDisplay}</span></div>
  `;

  const strategies = data.byStrategy || [];
  const byCommand = data.byCommand || [];
  const recent = data.recent || [];

  let html = "";

  if (strategies.length > 0) {
    html += `<div class="section"><h3>By Strategy</h3>`;
    for (const s of strategies) {
      const pct = s.raw > 0 ? Math.round((1 - s.comp / s.raw) * 100) : 0;
      html += `<div class="stat-row"><span class="stat-label">${s.strategy}</span><span class="stat-value">${s.calls} calls, ${pct}% saved</span></div>`;
    }
    html += `</div>`;
  }

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

  if (recent.length > 0) {
    html += `<div class="section"><h3>Recent Compressions</h3>`;
    html += `<div style="overflow-x:auto"><table class="quality-table" style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Time</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Command</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #333;color:#888">Strategy</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #333;color:#888">Saved</th>
      </tr></thead><tbody>`;
    for (const r of recent) {
      const time = new Date(r.timestamp).toLocaleTimeString();
      const pct = Math.round(r.savingsRatio * 100);
      html += `<tr>
        <td style="padding:2px 8px;border-bottom:1px solid #222;color:#888;font-size:10px">${time}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;font-family:monospace;font-size:10px;color:#aaa;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.command.slice(0, 60)}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;color:#6af;font-size:10px">${r.strategy}</td>
        <td style="padding:2px 8px;border-bottom:1px solid #222;text-align:right;color:${pct > 0 ? '#4a4' : '#888'}">${pct}%</td>
      </tr>`;
    }
    html += `</tbody></table></div></div>`;
  }

  chartsEl.innerHTML = html;
}

// ==================== Start ====================

init();
animate();
