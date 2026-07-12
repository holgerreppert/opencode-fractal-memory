# Brain Regions — 3D Mesh Implementation

## Data Source

Uses the **Desikan-Killiany (DK) atlas** from [Brain for Blender](https://brainder.org/research/brain-for-blender/) by Anderson Winkler (CC BY-SA 3.0). Specifically the **inflated surface** split per DK region (70 `.obj` files, ~23 MB uncompressed).

## Build Pipeline

`scripts/build-brain-glb.ts`:
1. Downloads are manual: `inflated_DK_obj.tar.bz2` from Brainder.org, extracted to `/tmp/brain_regions/`
2. Maps 70 DK parcels -> 5 buckets via `REGION_MAP`:
   - **prefrontal**: frontalpole, lateral/medial orbitofrontal, parsopercularis/orbitalis/triangularis, rostral/caudal anterior cingulate
   - **frontal**: precentral, superiorfrontal, rostral/caudal middlefrontal, paracentral
   - **parietal**: postcentral, superior/inferior parietal, supramarginal, precuneus, posterior cingulate
   - **temporal**: superior/middle/inferior temporal, temporalpole, transverse temporal, bankssts, fusiform, entorhinal, parahippocampal, isthmus cingulate, insula
   - **occipital**: lateraloccipital, cuneus, pericalcarine, lingual
3. OBJ files are parsed (vertices + faces) and grouped by bucket
4. Aggressive **spatial vertex merging** reduces ~360k verts -> ~3.6k verts
5. Outputs a **single GLB** (~101 KB) with 5 named meshes, each with per-vertex color

Run: `bun run scripts/build-brain-glb.ts`

## Runtime Loading

`management/public/glb-loader.js` — standalone GLB 2.0 parser (no GLTFLoader dependency).
Parses the binary format directly: header, JSON chunk (accessors/bufferViews/meshes), BIN chunk.
Builds `THREE.BufferGeometry[]` with position + color attributes.

Loaded in `management/public/app.js:SceneController.loadBrainMesh()`.

## Scene Integration

In `_showBrainLayout(data)`:
- `TYPE_REGION` maps memory node types -> 5 brain region names
- Starts `loadBrainMesh()` async, adds the GLB group to the scene
- Computes region centroids from mesh bounding boxes
- Positions memory nodes via `fibonacciSphere` around each region centroid
- Adds `createTextSprite` labels above each region

## Interaction

- **Hover**: brain region meshes show tooltip with region name
- **Click**: brain region mesh filters the node list to show only nodes in that region
- Node meshes are positioned inside their region's volume

## File Layout

```
management/public/models/brain-atlas.glb   — generated brain mesh (101 KB)
management/public/glb-loader.js             — GLB parser
scripts/build-brain-glb.ts                  — build script
```
