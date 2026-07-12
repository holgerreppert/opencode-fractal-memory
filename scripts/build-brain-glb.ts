import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";

const REGION_MAP: Record<string, string> = {
  frontalpole: "prefrontal", lateralorbitofrontal: "prefrontal",
  medialorbitofrontal: "prefrontal", parsopercularis: "prefrontal",
  parsorbitalis: "prefrontal", parstriangularis: "prefrontal",
  rostralanteriorcingulate: "prefrontal", caudalanteriorcingulate: "prefrontal",
  precentral: "frontal", superiorfrontal: "frontal",
  rostralmiddlefrontal: "frontal", caudalmiddlefrontal: "frontal",
  paracentral: "frontal",
  postcentral: "parietal", superiorparietal: "parietal",
  inferiorparietal: "parietal", supramarginal: "parietal",
  precuneus: "parietal", posteriorcingulate: "parietal",
  superiortemporal: "temporal", middletemporal: "temporal",
  inferiortemporal: "temporal", temporalpole: "temporal",
  transversetemporal: "temporal", bankssts: "temporal",
  fusiform: "temporal", entorhinal: "temporal",
  parahippocampal: "temporal", isthmuscingulate: "temporal",
  insula: "temporal",
  lateraloccipital: "occipital", cuneus: "occipital",
  pericalcarine: "occipital", lingual: "occipital",
};

const REGION_META: Record<string, { hex: number; triTarget: number }> = {
  prefrontal: { hex: 0x4a9eff, triTarget: 2000 },
  frontal:    { hex: 0x38cc80, triTarget: 3000 },
  parietal:   { hex: 0xfb923c, triTarget: 3000 },
  temporal:   { hex: 0xa78bfa, triTarget: 2500 },
  occipital:  { hex: 0x34d399, triTarget: 1500 },
};

const ORDER = ["prefrontal", "frontal", "parietal", "temporal", "occipital"];

// Parse OBJ into flat position + index arrays
function parseObj(path: string, baseIdx: number) {
  const text = readFileSync(path, "utf-8");
  const verts: number[] = [];
  const tris: number[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("v ")) {
      const p = t.split(/\s+/).slice(1);
      verts.push(parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]));
    } else if (t.startsWith("f ")) {
      const p = t.split(/\s+/).slice(1);
      tris.push(
        parseInt(p[0].split("/")[0]) - 1 + baseIdx,
        parseInt(p[1].split("/")[0]) - 1 + baseIdx,
        parseInt(p[2].split("/")[0]) - 1 + baseIdx
      );
    }
  }
  return { verts, tris };
}

// Adaptive vertex merging — higher eps = fewer verts = fewer tris retained
function decimate(pos: number[], idx: number[], eps: number) {
  const grid = new Map<string, number>();
  const newPos: number[] = [];
  const oldMap = new Map<number, number>();

  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const cx = Math.round(x / eps), cy = Math.round(y / eps), cz = Math.round(z / eps);
    const key = `${cx},${cy},${cz}`;
    if (grid.has(key)) { oldMap.set(i / 3, grid.get(key)!); continue; }

    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++)
      for (let dy = -1; dy <= 1 && !found; dy++)
        for (let dz = -1; dz <= 1 && !found; dz++) {
          const nk = `${cx + dx},${cy + dy},${cz + dz}`;
          if (grid.has(nk)) {
            const ni = grid.get(nk)!;
            if (Math.abs(x - newPos[ni * 3]) < eps && Math.abs(y - newPos[ni * 3 + 1]) < eps && Math.abs(z - newPos[ni * 3 + 2]) < eps) {
              oldMap.set(i / 3, ni); found = true;
            }
          }
        }
    if (!found) { const ni = newPos.length / 3; grid.set(key, ni); oldMap.set(i / 3, ni); newPos.push(x, y, z); }
  }

  const newIdx: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = oldMap.get(idx[i])!, b = oldMap.get(idx[i + 1])!, c = oldMap.get(idx[i + 2])!;
    if (a !== b && b !== c && a !== c) newIdx.push(a, b, c); // skip degenerate
  }

  return { pos: newPos, idx: newIdx };
}

function toGLB(regions: { name: string; pos: number[]; idx: number[]; hex: number }[]): Buffer {
  const mats: any[] = [];
  const accessors: any[] = [];
  const bvs: any[] = [];
  const meshes: any[] = [];
  const nodes: any[] = [{ name: "brain", children: [] }];
  let bo = 0;
  const binChunks: Buffer[] = [];

  for (const r of regions) {
    const vc = r.pos.length / 3;
    const posLen = r.pos.length * 4;
    const idxLen = r.idx.length * 2; // Uint16

    bvs.push({ buffer: 0, byteOffset: bo, byteLength: posLen, target: 34962 });
    const pa = accessors.length;
    accessors.push({ bufferView: pa, componentType: 5126, count: vc, type: "VEC3",
      min: [Math.min(...r.pos.filter((_, i) => i % 3 === 0)), Math.min(...r.pos.filter((_, i) => i % 3 === 1)), Math.min(...r.pos.filter((_, i) => i % 3 === 2))],
      max: [Math.max(...r.pos.filter((_, i) => i % 3 === 0)), Math.max(...r.pos.filter((_, i) => i % 3 === 1)), Math.max(...r.pos.filter((_, i) => i % 3 === 2))],
    });
    bo += posLen;

    const idxPadLen = (4 - (idxLen % 4)) % 4;
    bvs.push({ buffer: 0, byteOffset: bo, byteLength: idxLen, target: 34963 });
    const ia = accessors.length;
    accessors.push({ bufferView: ia, componentType: 5123, count: r.idx.length, type: "SCALAR" });
    bo += idxLen + idxPadLen;

    const mi = meshes.length;
    const matIdx = mats.length;
    const c = r.hex;
    mats.push({ pbrMetallicRoughness: { baseColorFactor: [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255, 1] } });
    meshes.push({ primitives: [{ attributes: { POSITION: pa }, indices: ia, material: matIdx }] });
    nodes[0].children.push(nodes.length);
    nodes.push({ mesh: mi, name: r.name });

    // Bin data — positions (float32)
    const pBuf = Buffer.alloc(posLen);
    for (let j = 0; j < r.pos.length; j++) pBuf.writeFloatLE(r.pos[j], j * 4);
    binChunks.push(pBuf);

    // Indices (uint16) — pad to 4-byte boundary so next region's float32 is aligned
    const iBuf = Buffer.alloc(idxLen);
    for (let j = 0; j < r.idx.length; j++) iBuf.writeUInt16LE(r.idx[j], j * 2);
    binChunks.push(iBuf);
    const idxPad = (4 - (idxLen % 4)) % 4;
    if (idxPad) binChunks.push(Buffer.alloc(idxPad));
  }

  const gltf = {
    asset: { version: "2.0", generator: "brain-region-builder" },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes, meshes, accessors, bufferViews: bvs,
    buffers: [{ byteLength: bo }],
    materials: mats,
  };

  const json = Buffer.from(JSON.stringify(gltf), "utf-8");
  const jsonPad = pad(json);
  const bin = Buffer.concat(binChunks);
  const binPad = pad(bin);

  const hdr = Buffer.alloc(12);
  hdr.write("glTF", 0); hdr.writeUInt32LE(2, 4);
  hdr.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jsonPad.length, 0); jc.writeUInt32LE(0x4E4F534A, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(binPad.length, 0); bc.writeUInt32LE(0x004E4942, 4);

  return Buffer.concat([hdr, jc, jsonPad, bc, binPad]);
}

function pad(b: Buffer) { const p = Math.ceil(b.length / 4) * 4; return b.length === p ? b : Buffer.concat([b, Buffer.alloc(p - b.length)]); }

function main() {
  const objDir = process.argv[2] || "/tmp/brain_regions/inflated_DK_obj";
  const outputPath = process.argv[3] || join(process.cwd(), "management", "public", "models", "brain-atlas.glb");

  if (!existsSync(objDir)) { console.error(`OBJ dir not found: ${objDir}`); process.exit(1); }

  const files = readdirSync(objDir).filter(f => f.endsWith(".obj"));
  console.log(`Found ${files.length} OBJ files`);

  const buckets: Record<string, { pos: number[]; idx: number[] }> = {};
  for (const r of ORDER) buckets[r] = { pos: [], idx: [] };
  let unassigned = 0;

  for (const file of files) {
    const dkName = basename(file, ".obj").split(".").pop()!;
    const region = REGION_MAP[dkName];
    if (!region) { unassigned++; continue; }
    const m = parseObj(join(objDir, file), buckets[region].pos.length / 3);
    buckets[region].pos.push(...m.verts);
    buckets[region].idx.push(...m.tris);
  }
  console.log(`Unassigned: ${unassigned}`);

  const results: { name: string; pos: number[]; idx: number[]; hex: number }[] = [];

  for (const name of ORDER) {
    const d = buckets[name];
    if (d.pos.length === 0) continue;
    const rawVerts = d.pos.length / 3;
    const rawTris = d.idx.length / 3;

    // Progressive decimation: increase eps until under target
    let eps = 0.5;
    let result: { pos: number[]; idx: number[] } | null = null;
    let tris = rawTris;
    const target = REGION_META[name].triTarget;

    while (tris > target * 1.2 && eps < 20) {
      result = decimate(d.pos, d.idx, eps);
      tris = result.idx.length / 3;
      if (tris > target * 1.2) eps *= 1.5;
    }
    if (!result) result = decimate(d.pos, d.idx, 1);

    console.log(`${name}: ${rawVerts} verts, ${rawTris} tris → ${result.pos.length / 3} verts, ${result.idx.length / 3} tris (eps=${eps.toFixed(1)})`);
    results.push({ name, hex: REGION_META[name].hex, ...result });
  }

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const glb = toGLB(results);
  writeFileSync(outputPath, glb);
  console.log(`Written: ${outputPath} (${(glb.length / 1024).toFixed(1)} KB)`);
}

main();
