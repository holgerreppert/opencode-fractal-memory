import * as THREE from 'three';
import { Logger } from '$lib/api/logger';
import { loadBrainRegions } from './glb-loader';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const LEVEL_COLORS: Record<number, number> = { 0: 0x4a9eff, 1: 0x34d399, 2: 0xfb923c, 3: 0xa78bfa, 4: 0xf472b6, 5: 0xfbbf24 };
const TYPE_SHAPES: Record<string, string> = {
	fact: 'octahedron', concept: 'octahedron', knowledge: 'octahedron', research: 'octahedron',
	core: 'dodecahedron', summary: 'octahedron', decision: 'dodecahedron', lesson: 'dodecahedron', review: 'tetrahedron',
	architecture: 'box', convention: 'box', rule: 'icosahedron', skill: 'icosahedron', plan: 'cylinder', workflow: 'cone',
	note: 'sphere', task: 'sphere', session: 'sphere', preference: 'sphere', improvement: 'cylinder', howto: 'cylinder',
	exploration: 'cylinder', 'debug-investigation': 'cylinder', event: 'tetrahedron', episode: 'tetrahedron', bug: 'tetrahedron', fix: 'tetrahedron',
	playbook: 'torus', playbook_version: 'torus', dot: 'torusKnot', unknown: 'sphere',
};
const TYPE_COLORS: Record<string, number> = {
	fact: 0x34d399, concept: 0x34d399, knowledge: 0x34d399, research: 0x34d399, summary: 0x34d399,
	core: 0xfbbf24, decision: 0xfb923c, lesson: 0xa78bfa, review: 0xc4b5fd,
	architecture: 0x4a9eff, convention: 0x4a9eff, rule: 0xf472b6, skill: 0xf472b6, plan: 0x60a5fa, workflow: 0x22d3ee,
	note: 0x9ca3af, task: 0x9ca3af, session: 0x9ca3af, preference: 0xf472b6, improvement: 0x34d399, howto: 0x34d399,
	exploration: 0x06b6d4, 'debug-investigation': 0x06b6d4, event: 0xff6b6b, episode: 0xff6b6b, bug: 0xff6b6b, fix: 0x34d399,
	playbook: 0xff8c00, playbook_version: 0xff8c00, dot: 0x06b6d4,
};
const CUSTOM_TYPE_COLORS: Record<string, number> = { 'middle-term': 0xff6b6b };
const CUSTOM_TYPE_SHAPES: Record<string, string> = { 'middle-term': 'torus' };

// EXACT copy from management/public/app.js:688
const TYPE_REGION: Record<string, string> = {
	skill: 'prefrontal', playbook: 'prefrontal', rule: 'prefrontal', howto: 'prefrontal', bug: 'prefrontal', fix: 'prefrontal',
	fact: 'occipital', concept: 'occipital', knowledge: 'occipital', research: 'occipital',
	lesson: 'temporal', improvement: 'temporal', review: 'temporal', event: 'temporal', session: 'temporal', episode: 'temporal',
	decision: 'frontal', architecture: 'frontal', convention: 'frontal', preference: 'frontal', plan: 'frontal', task: 'frontal',
	summary: 'parietal', core: 'parietal',
};
const REGION_META: Record<string, { center: THREE.Vector3; label: string; color: number }> = {
	prefrontal: { center: new THREE.Vector3(-45, 55, -55), label: 'Prefrontal Cortex', color: 0x4a9eff },
	frontal: { center: new THREE.Vector3(0, 25, -80), label: 'Frontal Lobe', color: 0x38cc80 },
	parietal: { center: new THREE.Vector3(60, 15, 10), label: 'Parietal Lobe', color: 0xfb923c },
	temporal: { center: new THREE.Vector3(-55, -15, 55), label: 'Temporal Lobe', color: 0xa78bfa },
	occipital: { center: new THREE.Vector3(25, -5, 90), label: 'Occipital Lobe', color: 0x34d399 },
};

function fibonacciSphere(i: number, n: number, r: number, T = THREE) {
	if (n <= 1) return new T.Vector3(0, 0, 0);
	const ga = Math.PI * (3 - Math.sqrt(5));
	const y = 1 - (i / (n - 1)) * 2;
	const rad = Math.sqrt(1 - y * y);
	const th = ga * i;
	return new T.Vector3(rad * Math.cos(th) * r, y * r, rad * Math.sin(th) * r);
}
function computeShellRadii(counts: Record<number, number>) {
	const lv = Object.keys(counts).map(Number).sort((a, b) => a - b);
	if (!lv.length) return {} as Record<number, number>;
	const max = Math.max(...lv.map((l) => counts[l]));
	const base = Math.max(60, Math.sqrt(max) * 12);
	const out: Record<number, number> = {};
	lv.forEach((l, i) => (out[l] = base * (1 + i * 0.7)));
	return out;
}
function getNodeSize(n: any) {
	return Math.max(3, Math.min(3 + (n.importance ?? 0.5) * 2 + Math.min((n.accessCount ?? 0) * 0.4, 8), 24));
}
function getNodeShape(n: any) {
	const c = n.metadata?.customType;
	if (c === 'middle-term') return 'torus';
	return (TYPE_SHAPES as any)[n.type] ?? 'sphere';
}
function getGeometry(THREE: any, shape: string, size: number) {
	try {
		switch (shape) {
			case 'box': return new THREE.BoxGeometry(size * 1.5, size * 1.5, size * 1.5);
			case 'octahedron': return new THREE.OctahedronGeometry(size);
			case 'dodecahedron': return new THREE.DodecahedronGeometry(size);
			case 'icosahedron': return new THREE.IcosahedronGeometry(size);
			case 'tetrahedron': return new THREE.TetrahedronGeometry(size * 1.2);
			case 'cylinder': return new THREE.CylinderGeometry(size * 0.7, size * 0.7, size * 1.8, 12);
			case 'cone': return new THREE.ConeGeometry(size * 0.9, size * 1.8, 12);
			case 'torus': return new THREE.TorusGeometry(size * 0.7, size * 0.25, 10, 20);
			case 'torusKnot': return new THREE.TorusKnotGeometry(size * 0.6, size * 0.18, 64, 10);
			default: return new THREE.SphereGeometry(size, 16, 12);
		}
	} catch { return new THREE.SphereGeometry(size, 16, 12); }
}
function subdivideGeometry(geom: THREE.BufferGeometry): THREE.BufferGeometry {
	// 1× midpoint subdivision: each tri → 4 tris (midpoint per edge). 4× tris.
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const idx = geom.getIndex();
	if (!idx) return geom;
	const oldPos = pos.array as Float32Array;
	const oldIdx = idx.array as Uint16Array | Uint32Array;
	const newPos: number[] = Array.from(oldPos as any);
	const midCache = new Map<string, number>();
	function mid(a: number, b: number): number {
		const key = a < b ? `${a}_${b}` : `${b}_${a}`;
		if (midCache.has(key)) return midCache.get(key)!;
		const ia = a * 3, ib = b * 3;
		const mx = (oldPos[ia] + oldPos[ib]) * 0.5;
		const my = (oldPos[ia + 1] + oldPos[ib + 1]) * 0.5;
		const mz = (oldPos[ia + 2] + oldPos[ib + 2]) * 0.5;
		const v2 = newPos.length / 3;
		newPos.push(mx, my, mz);
		midCache.set(key, v2);
		return v2;
	}
	const newIdx: number[] = [];
	for (let i = 0; i < oldIdx.length; i += 3) {
		const a = oldIdx[i], b = oldIdx[i + 1], c = oldIdx[i + 2];
		const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
		newIdx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
	const maxIdx = Math.max(...newIdx);
	out.setIndex(maxIdx > 65535 ? new THREE.BufferAttribute(new Uint32Array(newIdx), 1) : new THREE.BufferAttribute(new Uint16Array(newIdx), 1));
	return out;
}

function laplacianSmooth(geom: THREE.BufferGeometry, iterations = 2, lambda = 0.4): THREE.BufferGeometry {
	// Taubin-like Laplacian: each vert → lerp(old, avgNeighbor). Actually rounds the mesh.
	const pos = geom.getAttribute('position') as THREE.BufferAttribute;
	const idx = geom.getIndex();
	if (!idx) return geom;
	const count = pos.count;
	const idxArr = idx.array as Uint16Array | Uint32Array;
	for (let iter = 0; iter < iterations; iter++) {
		const neighbors: Map<number, number[]> = new Map();
		for (let i = 0; i < idxArr.length; i += 3) {
			const a = idxArr[i], b = idxArr[i + 1], c = idxArr[i + 2];
			if (!neighbors.has(a)) neighbors.set(a, []);
			if (!neighbors.has(b)) neighbors.set(b, []);
			if (!neighbors.has(c)) neighbors.set(c, []);
			neighbors.get(a)!.push(b, c);
			neighbors.get(b)!.push(a, c);
			neighbors.get(c)!.push(a, b);
		}
		const arr = pos.array as Float32Array;
		const next = new Float32Array(arr.length);
		for (let v = 0; v < count; v++) {
			const neigh = neighbors.get(v);
			if (!neigh || neigh.length === 0) { next[v * 3] = arr[v * 3]; next[v * 3 + 1] = arr[v * 3 + 1]; next[v * 3 + 2] = arr[v * 3 + 2]; continue; }
			let ax = 0, ay = 0, az = 0;
			for (const n of neigh) { ax += arr[n * 3]; ay += arr[n * 3 + 1]; az += arr[n * 3 + 2]; }
			ax /= neigh.length; ay /= neigh.length; az /= neigh.length;
			next[v * 3] = arr[v * 3] * (1 - lambda) + ax * lambda;
			next[v * 3 + 1] = arr[v * 3 + 1] * (1 - lambda) + ay * lambda;
			next[v * 3 + 2] = arr[v * 3 + 2] * (1 - lambda) + az * lambda;
		}
		for (let i = 0; i < arr.length; i++) arr[i] = next[i];
	}
	pos.needsUpdate = true;
	return geom;
}

function createTextSprite(THREE: any, text: string, color: number, big = false) {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	canvas.width = big ? 512 : 256; canvas.height = big ? 128 : 64;
	ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = big ? 'bold 36px Inter, sans-serif' : 'bold 24px Inter, sans-serif';
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	const hex = '#' + color.toString(16).padStart(6, '0');
	ctx.shadowColor = hex; ctx.shadowBlur = 8; ctx.fillStyle = hex; ctx.fillText(text.slice(0, 32), canvas.width / 2, canvas.height / 2);
	const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
	const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(big ? 60 : 30, big ? 15 : 8, 1);
	return sprite;
}

export class SceneController {
	scene = new THREE.Scene();
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	group = new THREE.Group();
	nodeObjects: THREE.Object3D[] = [];
	edgeObjects: THREE.Line[] = [];
	regionObjects: THREE.Object3D[] = [];
	nodePositions = new Map<string, THREE.Vector3>();
	nodeVelocities = new Map<string, THREE.Vector3>();
	raycaster = new THREE.Raycaster();
	mouse = new THREE.Vector2();
	hovered: THREE.Mesh | null = null;
	selected: THREE.Mesh | null = null;
	spherical = { theta: 0, phi: Math.PI / 3, radius: 350 };
	target = new THREE.Vector3(0, 0, 0);
	// brain state — exact parity with app.js
	brainMeshGroup: THREE.Group | null = null;
	layoutMode: string = 'shell';
	shellRadii: Record<number, number> = {};
	_brainScale = 2.5;
	_brainNodeRegions = new Map<string, string>();
	_brainRegionCentroids: Record<string, THREE.Vector3> = {};
	_brainRegionLabels: Record<string, THREE.Sprite> = {};
	_brainLoaded = false;

	// drag state — must mirror app.js _isDragging + hoveredNode guard + drag suppression
	_isDragging = false;
	_dragMoved = 0;
	_prevMouse = { x: 0, y: 0 };
	_keys: Record<string, boolean> = { w: false, a: false, s: false, d: false, q: false, e: false };
	_moveSpeed = 2;

	constructor(private canvas: HTMLCanvasElement) {
		this.scene.background = new THREE.Color(0x0a0a0f);
		(this.scene as any).fog = new THREE.FogExp2(0x0a0a0f, 0.0006);
		const r = canvas.getBoundingClientRect();
		this.camera = new THREE.PerspectiveCamera(60, r.width / r.height, 0.1, 2000);
		this.camera.position.set(0, 100, 300);
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setSize(r.width, r.height, false);
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.scene.add(this.group);
		this.addLights();
		this.bindEvents();
		this.animate();
	}

	async loadBrainMesh(): Promise<THREE.Group | null> {
		if (this.brainMeshGroup) return this.brainMeshGroup;
		// EXACT copy of app.js loadBrainMesh — uses custom GLBLoader, not THREE GLTFLoader
		const urls = ['/brain-atlas.glb', '/models/brain-atlas.glb', 'http://127.0.0.1:8787/models/brain-atlas.glb', 'models/brain-atlas.glb'];
		for (const url of urls) {
			try {
				const regions = await loadBrainRegions(url);
				const group = new THREE.Group();
				for (const r of regions) {
					// 2× subdiv left edgy (flat midpoints). Now 1× subdiv + 3× Laplacian smooth → actually round.
					try {
						let g: THREE.BufferGeometry = r.geometry as THREE.BufferGeometry;
						g.deleteAttribute('normal');
						g = mergeVertices(g) as THREE.BufferGeometry;
						g = subdivideGeometry(g);
						g = laplacianSmooth(g, 3, 0.35);
						g.computeVertexNormals();
						r.geometry = g;
					} catch { r.geometry.computeVertexNormals(); }
					const mat = new THREE.MeshStandardMaterial({
						color: r.color, roughness: 0.65, metalness: 0.0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, emissive: r.color, emissiveIntensity: 0.10, flatShading: false,
					});
					const mesh = new THREE.Mesh(r.geometry, mat);
					mesh.name = r.name;
					(mesh as any).userData.brainRegion = r.name;
					group.add(mesh);
				}
				this.brainMeshGroup = group;
				Logger.debug('[scene] brain GLB loaded', url, group.children.length);
				return group;
			} catch (e) {
				Logger.warn('[scene] brain load failed', url, String(e).slice(0, 80));
			}
		}
		Logger.warn('[brain] Failed to load brain mesh: all urls failed');
		return null;
	}

	addLights() {
		this.scene.add(new THREE.AmbientLight(0x8888cc, 0.8));
		this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a3a5a, 0.6));
		const l1 = new THREE.DirectionalLight(0xffffff, 1.0); l1.position.set(200, 300, 200); this.scene.add(l1);
		const l2 = new THREE.DirectionalLight(0x4a9eff, 0.5); l2.position.set(-200, -100, -200); this.scene.add(l2);
		const l3 = new THREE.DirectionalLight(0xff8844, 0.3); l3.position.set(-100, 50, 300); this.scene.add(l3);
	}

	bindEvents() {
		const el = this.renderer.domElement;
		// EXACT copy of app.js _bindEvents — no extra _dragMoved guard
		el.addEventListener('mousedown', (e) => {
			if ((e as MouseEvent).button === 0 && !this.hovered) {
				this._isDragging = true;
				this._prevMouse = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
			}
		});
		el.addEventListener('mousemove', (e) => {
			if (this._isDragging) {
				const dx = (e as MouseEvent).clientX - this._prevMouse.x;
				const dy = (e as MouseEvent).clientY - this._prevMouse.y;
				this.spherical.theta -= dx * 0.005;
				this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi + dy * 0.005));
				this._prevMouse = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
				this.updateCamera();
			}
		});
		el.addEventListener('mouseup', () => { this._isDragging = false; });
		el.addEventListener('mouseleave', () => { this._isDragging = false; });
		el.addEventListener('wheel', (e) => {
			this.spherical.radius *= (e as WheelEvent).deltaY > 0 ? 1.1 : 0.9;
			this.spherical.radius = Math.max(10, Math.min(1000, this.spherical.radius));
			this.updateCamera();
		});
		el.addEventListener('mousemove', (e) => this.onMouseMove(e as MouseEvent));
		el.addEventListener('click', (e) => this.onClick(e as MouseEvent));
		window.addEventListener('keydown', (e) => this.onKeyDown(e));
		window.addEventListener('keyup', (e) => this.onKeyUp(e));
		window.addEventListener('resize', () => this.resize());
	}

	onKeyDown(e: KeyboardEvent) {
		if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
		switch (e.code) { case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'KeyQ': case 'KeyE': e.preventDefault(); this._keys[e.code.slice(3).toLowerCase()] = true; break; }
	}
	onKeyUp(e: KeyboardEvent) {
		switch (e.code) { case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'KeyQ': case 'KeyE': this._keys[e.code.slice(3).toLowerCase()] = false; break; }
	}
	updateMovement() {
		if (!this._keys.w && !this._keys.a && !this._keys.s && !this._keys.d && !this._keys.q && !this._keys.e) return;
		const forward = new THREE.Vector3().subVectors(this.target, this.camera.position); forward.y = 0;
		if (forward.lengthSq() < 0.001) forward.set(0, 0, -1); else forward.normalize();
		const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
		const move = new THREE.Vector3(); const s = this._moveSpeed;
		if (this._keys.w) move.add(forward.clone().multiplyScalar(s));
		if (this._keys.s) move.sub(forward.clone().multiplyScalar(s));
		if (this._keys.a) move.sub(right.clone().multiplyScalar(s));
		if (this._keys.d) move.add(right.clone().multiplyScalar(s));
		if (this._keys.q) move.y -= s; if (this._keys.e) move.y += s;
		this.target.add(move); this.updateCamera();
	}

	updateCamera() {
		const s = this.spherical, t = this.target;
		this.camera.position.set(t.x + s.radius * Math.sin(s.phi) * Math.cos(s.theta), t.y + s.radius * Math.cos(s.phi), t.z + s.radius * Math.sin(s.phi) * Math.sin(s.theta));
		this.camera.lookAt(t);
	}

	onMouseMove(e: MouseEvent) {
		const rect = this.renderer.domElement.getBoundingClientRect();
		(this as any)._lastMouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		(this as any)._lastMouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
		this.mouse.x = (this as any)._lastMouseX; this.mouse.y = (this as any)._lastMouseY;
		this.raycaster.setFromCamera(this.mouse, this.camera);
		const meshes = this.nodeObjects.filter((o) => (o as any).isMesh);
		const hits = this.raycaster.intersectObjects(meshes as any);
		const tip = document.getElementById('tooltip');
		let brainHit: any = null;
		if (this.brainMeshGroup && this.layoutMode === 'brain') {
			const brainMeshes: THREE.Mesh[] = []; this.brainMeshGroup.traverse((c: any) => { if (c.isMesh) brainMeshes.push(c); });
			const bh = this.raycaster.intersectObjects(brainMeshes as any); if (bh.length > 0) brainHit = bh[0].object;
		}
		if (hits.length > 0) {
			const obj = hits[0].object as THREE.Mesh;
			const nd = (obj as any).userData.nodeData;
			if (this.hovered !== obj) {
				if (this.hovered && this.hovered !== this.selected) (this.hovered.material as any).emissiveIntensity = 0.2;
				this.hovered = obj; if (obj !== this.selected) (obj.material as any).emissiveIntensity = 0.5;
			}
			if (tip) { tip.style.display = 'block'; tip.style.left = e.clientX + 15 + 'px'; tip.style.top = e.clientY + 15 + 'px'; tip.innerHTML = `<strong>${nd.label || 'Unnamed'}</strong><br>Level: ${nd.level} | Importance: ${nd.importance}`; }
		} else if (brainHit) {
			const regionName = brainHit.userData.brainRegion || brainHit.name;
			if (this.hovered && this.hovered !== this.selected) (this.hovered.material as any).emissiveIntensity = 0.2;
			this.hovered = null;
			if (tip) { tip.style.display = 'block'; tip.style.left = e.clientX + 15 + 'px'; tip.style.top = e.clientY + 15 + 'px'; tip.innerHTML = `<strong>${regionName}</strong><br><em>Click to filter nodes</em>`; }
		} else {
			if (this.hovered && this.hovered !== this.selected) (this.hovered.material as any).emissiveIntensity = 0.2;
			this.hovered = null; if (tip) tip.style.display = 'none';
		}
	}

	onClick(event: MouseEvent) {
		if (this.hovered) {
			this.selected = this.hovered; this.highlight(); (window as any).showDetail?.(this.hovered.userData.nodeData);
			return;
		}
		if (this.brainMeshGroup && this.layoutMode === 'brain') {
			const rect = this.renderer.domElement.getBoundingClientRect();
			this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
			this.raycaster.setFromCamera(this.mouse, this.camera);
			const brainMeshes: THREE.Mesh[] = []; this.brainMeshGroup.traverse((c: any) => { if (c.isMesh) brainMeshes.push(c); });
			const hits = this.raycaster.intersectObjects(brainMeshes as any);
			if (hits.length > 0) {
				const region = (hits[0].object as any).userData.brainRegion || (hits[0].object as any).name;
				const fe = (window as any).filterEngine;
				if (fe) { fe.customTypes = new Set([region]); document.querySelectorAll('.filter-btn.custom-type').forEach((b: any) => b.classList.toggle('active', b.dataset.customType === region)); this.updateVisibility(fe); }
			}
		}
	}

	highlight() {
		this.nodeObjects.forEach((o) => {
			if ((o as any).isMesh && (o as any).userData.nodeData) {
				if (o === this.selected) (o as any).material.emissiveIntensity = 0.8; else if (o !== this.hovered) (o as any).material.emissiveIntensity = 0.2;
			}
		});
	}

	clear() {
		this.nodeObjects.forEach((o) => this.scene.remove(o));
		this.edgeObjects.forEach((o) => this.scene.remove(o));
		this.regionObjects.forEach((o) => this.scene.remove(o));
		if (this.brainMeshGroup) this.scene.remove(this.brainMeshGroup);
		this.nodeObjects = []; this.edgeObjects = []; this.regionObjects = [];
		this.nodePositions.clear(); this.nodeVelocities.clear();
		// keep brainMeshGroup cached for reuse like original (not nulled), but removed from scene
	}

	buildFromData(data: any[], mode = 'shell') {
		this.clear();
		this.layoutMode = mode;
		if (!data.length) { Logger.debug('[scene] no data'); return; }
		if (mode === 'shell') this.computeShell(data);
		else if (mode === 'type-cluster') this.computeTypeCluster(data);
		else if (mode === 'brain') this.showBrainLayout(data);
		else this.computeForce(data);
		this.createMeshes(data);
		Logger.debug('[scene] built', data.length, 'mode', mode);
	}

	computeShell(data: any[]) {
		const levelGroups: Record<number, any[]> = {}; const levelCounts: Record<number, number> = {};
		for (const n of data) { if (!n) continue; const lvl = n.level ?? 3; (levelGroups[lvl] ??= []).push(n); levelCounts[lvl] = (levelCounts[lvl] ?? 0) + 1; }
		const radii = computeShellRadii(levelCounts); this.shellRadii = radii;
		const counters: Record<number, number> = {};
		for (const n of data) { if (!n) continue; const lvl = n.level ?? 3; const count = levelCounts[lvl]; const idx = counters[lvl] ?? 0; counters[lvl] = idx + 1; const r = radii[lvl] ?? 120; this.nodePositions.set(n.id, fibonacciSphere(idx, count, r, THREE)); this.nodeVelocities.set(n.id, new THREE.Vector3(0, 0, 0)); }
	}

	computeTypeCluster(data: any[]) {
		const byType: Record<string, any[]> = {}; for (const n of data) { const t = n.type || 'unknown'; (byType[t] ??= []).push(n); }
		const types = Object.keys(byType); const centers: Record<string, THREE.Vector3> = {};
		types.forEach((t, i) => (centers[t] = fibonacciSphere(i, types.length, 180, THREE)));
		for (const t of types) {
			const list = byType[t]; const c = centers[t];
			const byLv: Record<number, any[]> = {}; const cnts: Record<number, number> = {};
			for (const n of list) { const l = n.level ?? 3; (byLv[l] ??= []).push(n); cnts[l] = (cnts[l] ?? 0) + 1; }
			const sorted = Object.keys(cnts).map(Number).sort((a, b) => a - b);
			const maxCount = sorted.length ? Math.max(...sorted.map((l) => cnts[l])) : 1;
			const baseR = Math.max(12, Math.sqrt(maxCount) * 5);
			sorted.forEach((lvl, i) => {
				const lvlNodes = byLv[lvl]; const count = cnts[lvl]; const r = baseR + i * 6;
				lvlNodes.forEach((node, idx) => { const local = fibonacciSphere(idx, count, r, THREE); this.nodePositions.set(node.id, new THREE.Vector3().copy(c).add(local)); this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0)); });
			});
		}
		this.shellRadii = {};
	}

	computeForce(data: any[]) {
		data.forEach((n, i) => { this.nodePositions.set(n.id, fibonacciSphere(i, data.length, 80, THREE)); this.nodeVelocities.set(n.id, new THREE.Vector3(0, 0, 0)); });
	}

	// EXACT 1:1 from app.js _showBrainLayout — nodes INSIDE lobes, not shells
	showBrainLayout(data: any[]) {
		function getRegion(node: any) {
			const s = node.supertype;
			if (s && (TYPE_REGION as any)[s]) return (TYPE_REGION as any)[s];
			return (TYPE_REGION as any)[node.type || 'unknown'] || 'frontal';
		}
		const regionNodes: Record<string, any[]> = {};
		for (const node of data) { if (!node) continue; const r = getRegion(node); (regionNodes[r] ??= []).push(node); }
		const scale = 2.5;
		this._brainScale = scale;
		this._brainNodeRegions = new Map();
		this._brainRegionCentroids = {};
		this._brainRegionLabels = {};
		for (const [region, nodes] of Object.entries(regionNodes)) {
			const info = (REGION_META as any)[region] || (REGION_META as any).frontal;
			const center = info.center.clone().multiplyScalar(scale);
			this._brainRegionCentroids[region] = center;
			const count = nodes.length;
			const radius = Math.max(15, Math.sqrt(count) * 6);
			const label = createTextSprite(THREE, info.label, info.color, true);
			label.position.set(center.x, center.y + 50, center.z);
			this.scene.add(label); this.regionObjects.push(label); this._brainRegionLabels[region] = label;
			nodes.forEach((node: any, idx: number) => {
				this._brainNodeRegions.set(node.id, region);
				const localPos = fibonacciSphere(idx, count, radius, THREE);
				const pos = new THREE.Vector3().copy(center).add(localPos);
				this.nodePositions.set(node.id, pos);
				this.nodeVelocities.set(node.id, new THREE.Vector3(0, 0, 0));
			});
		}
		// Load brain mesh as transparent overlay, then reposition nodes to actual centroids — EXACT original
		this.loadBrainMesh().then((group) => {
			if (!group || this.layoutMode !== 'brain') return;
			group.scale.set(scale, scale, scale);
			this.scene.add(group); this.brainMeshGroup = group;
			const actualCentroids: Record<string, THREE.Vector3> = {};
			for (const child of (group as any).children) {
				if (!child.isMesh) continue; const posAttr = child.geometry.attributes.position; if (!posAttr) continue;
				const vc = new THREE.Vector3(); for (let i = 0; i < posAttr.count; i++) { vc.x += posAttr.getX(i); vc.y += posAttr.getY(i); vc.z += posAttr.getZ(i); } vc.divideScalar(posAttr.count); vc.multiplyScalar(scale); actualCentroids[child.name] = vc;
			}
			const updatedPositions = new Map<string, THREE.Vector3>();
			for (const obj of this.nodeObjects) {
				const nodeId = (obj as any).userData.nodeId; if (!nodeId) continue;
				const region = this._brainNodeRegions.get(nodeId); if (!region) continue;
				const actual = actualCentroids[region]; const hardcoded = this._brainRegionCentroids[region]; if (!actual || !hardcoded) continue;
				let newPos: THREE.Vector3 | undefined;
				if ((obj as any).isMesh) {
					const offset = obj.position.clone().sub(hardcoded); if (offset.length() > 80) offset.setLength(80); newPos = actual.clone().add(offset); obj.position.copy(newPos);
				} else if ((obj as any).isSprite) {
					const meshPos = updatedPositions.get(nodeId) || this.nodePositions.get(nodeId); if (meshPos) { const size = getNodeSize((obj as any).userData.nodeData); newPos = meshPos.clone(); newPos.y += size + 5; obj.position.copy(newPos); } continue;
				} else continue;
				if (newPos) updatedPositions.set(nodeId, newPos);
			}
			for (const [id, pos] of updatedPositions) this.nodePositions.set(id, pos);
			// 5 push-apart passes within each region — exact
			for (let pass = 0; pass < 5; pass++) {
				for (const region of Object.keys(actualCentroids)) {
					const ids: string[] = []; for (const [id, r] of this._brainNodeRegions) if (r === region) ids.push(id);
					for (let i = 0; i < ids.length; i++) {
						const pi = this.nodePositions.get(ids[i]); if (!pi) continue;
						for (let j = i + 1; j < ids.length; j++) {
							const pj = this.nodePositions.get(ids[j]); if (!pj) continue;
							const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z; const distSq = dx * dx + dy * dy + dz * dz; const minDist = 20;
							if (distSq < minDist * minDist && distSq > 0.01) { const dist = Math.sqrt(distSq); const push = (minDist - dist) * 0.4; const nx = dx / dist, ny = dy / dist, nz = dz / dist; pi.x += nx * push; pi.y += ny * push; pi.z += nz * push; pj.x -= nx * push; pj.y -= ny * push; pj.z -= nz * push; }
						}
					}
				}
			}
			for (const obj of this.nodeObjects) {
				const nodeId = (obj as any).userData.nodeId; if (!nodeId) continue; const pos = this.nodePositions.get(nodeId); if (!pos) continue;
				if ((obj as any).isMesh) obj.position.copy(pos); else if ((obj as any).isSprite) { const size = getNodeSize((obj as any).userData.nodeData); obj.position.set(pos.x, pos.y + size + 5, pos.z); }
			}
			for (const [region, label] of Object.entries(this._brainRegionLabels)) { const actual = actualCentroids[region]; if (actual) label.position.set(actual.x, actual.y + 50, actual.z); }
			this.syncEdges();
			this.spherical.radius = 250; this.target.set(0, 0, 0); this.updateCamera();
		});
		this.shellRadii = {};
	}

	createMeshes(data: any[]) {
		for (const n of data) {
			const pos = this.nodePositions.get(n.id); if (!pos) continue;
			const size = getNodeSize(n);
			const customType = n.metadata?.customType;
			let color: number, shape: string;
			if (customType && (CUSTOM_TYPE_COLORS as any)[customType]) { color = (CUSTOM_TYPE_COLORS as any)[customType]; shape = (CUSTOM_TYPE_SHAPES as any)[customType] ?? 'sphere'; }
			else if (n.type && (TYPE_COLORS as any)[n.type]) { color = (TYPE_COLORS as any)[n.type]; shape = (TYPE_SHAPES as any)[n.type] ?? 'sphere'; }
			else { color = (LEVEL_COLORS as any)[n.level] ?? 0x888888; shape = (TYPE_SHAPES as any)[n.type] ?? 'sphere'; }
			const geometry = getGeometry(THREE, shape, size);
			const material = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.95 });
			const mesh = new THREE.Mesh(geometry, material);
			mesh.position.copy(pos); (mesh as any).userData = { nodeId: n.id, nodeData: n };
			this.scene.add(mesh); this.nodeObjects.push(mesh);
			const label = createTextSprite(THREE, n.label || n.id.slice(0, 8), color);
			label.position.copy(pos); label.position.y += size + 5; (label as any).userData = { nodeId: n.id, nodeData: n };
			this.scene.add(label); this.nodeObjects.push(label);
		}
	}

	buildEdges(links: any[]) {
		const seen = new Set<string>();
		for (const l of links) {
			const k = `${l.source}-${l.target}`; if (seen.has(k)) continue; seen.add(k);
			const sp = this.nodePositions.get(l.source), tp = this.nodePositions.get(l.target); if (!sp || !tp) continue;
			const g = new THREE.BufferGeometry().setFromPoints([sp, tp]);
			const m = new THREE.LineBasicMaterial({ color: l.type === 'parent' ? 0x4a9eff : 0x666666, transparent: true, opacity: l.type === 'parent' ? 0.4 : 0.2 });
			const line = new THREE.Line(g, m); (line as any).userData = { source: l.source, target: l.target, edgeType: l.type };
			this.scene.add(line); this.edgeObjects.push(line);
		}
	}

	syncEdges() {
		this.edgeObjects.forEach((line: any) => {
			const s = this.nodePositions.get(line.userData.source); const t = this.nodePositions.get(line.userData.target);
			if (s && t) { const arr = line.geometry.attributes.position.array; arr[0] = s.x; arr[1] = s.y; arr[2] = s.z; arr[3] = t.x; arr[4] = t.y; arr[5] = t.z; line.geometry.attributes.position.needsUpdate = true; }
		});
	}

	updateVisibility(filter: any) {
		// fallback — Svelte side passes filtered ids via store; keep parity signature
		const filtered = filter?.apply ? filter.apply([]) : [];
		const ids = new Set(filtered.map((n: any) => n.id));
		this.nodeObjects.forEach((o: any) => { if (!o.userData?.nodeId) return; o.visible = ids.size === 0 ? true : ids.has(o.userData.nodeId); });
	}

	animate = () => {
		requestAnimationFrame(this.animate); this.updateMovement();
		this.nodeObjects.forEach((o) => { if ((o as any).isMesh) { (o as any).rotation.y += 0.002; (o as any).rotation.x += 0.001; } });
		this.renderer.render(this.scene, this.camera);
	};

	resize() {
		const r = this.canvas.getBoundingClientRect(); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); this.renderer.setSize(r.width, r.height, false);
	}

	dispose() { this.renderer.dispose(); }
}
