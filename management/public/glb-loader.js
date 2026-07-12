// Minimal GLB (Binary glTF 2.0) loader for Three.js
// Parses GLB into THREE.BufferGeometry[] with names
(function () {
  const GLBLoader = {
    load: async function (url) {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      return this.parse(buf);
    },

    parse: function (buf) {
      const dv = new DataView(buf);
      // Header
      const magic = dv.getUint32(0, true);
      if (magic !== 0x46546c67) throw new Error("Not a GLB file");
      const version = dv.getUint32(4, true);
      if (version !== 2) throw new Error("Unsupported GLB version: " + version);

      let offset = 12;
      let json = null;
      let binData = null;

      while (offset < buf.byteLength) {
        const chunkLen = dv.getUint32(offset, true);
        const chunkType = dv.getUint32(offset + 4, true);
        const chunkStart = offset + 8;

        if (chunkType === 0x4E4F534A) {
          // JSON chunk
          const jsonStr = new TextDecoder().decode(new Uint8Array(buf, chunkStart, chunkLen));
          json = JSON.parse(jsonStr);
        } else if (chunkType === 0x004E4942) {
          // BIN chunk
          binData = buf.slice(chunkStart, chunkStart + chunkLen);
        }

        offset += 8 + chunkLen;
      }

      if (!json) throw new Error("No JSON chunk found");

      return this._buildMeshes(json, binData);
    },

    _buildMeshes: function (json, binData) {
      const accessors = json.accessors || [];
      const bufferViews = json.bufferViews || [];
      const meshes = json.meshes || [];
      const materials = json.materials || [];
      const nodes = json.nodes || [];
      const result = [];

      // Find all mesh nodes with their names
      for (const node of nodes) {
        if (node.mesh === undefined) continue;
        const meshDef = meshes[node.mesh];
        if (!meshDef) continue;

        for (const prim of meshDef.primitives) {
          const geo = new THREE.BufferGeometry();

          // POSITION
          if (prim.attributes.POSITION !== undefined) {
            const acc = accessors[prim.attributes.POSITION];
            const bv = bufferViews[acc.bufferView];
            const data = this._readAccessor(binData, acc, bv);
            geo.setAttribute("position", new THREE.BufferAttribute(data, 3));
          }

          // COLOR_0
          if (prim.attributes.COLOR_0 !== undefined) {
            const acc = accessors[prim.attributes.COLOR_0];
            const bv = bufferViews[acc.bufferView];
            const data = this._readAccessor(binData, acc, bv);
            geo.setAttribute("color", new THREE.BufferAttribute(data, acc.type === "VEC4" ? 4 : 3));
          }

          // Indices
          if (prim.indices !== undefined) {
            const acc = accessors[prim.indices];
            const bv = bufferViews[acc.bufferView];
            const data = this._readAccessor(binData, acc, bv);
            geo.setIndex(new THREE.BufferAttribute(data, 1));
          }

          // Material color
          let color = new THREE.Color(0x888888);
          if (prim.material !== undefined && materials[prim.material]) {
            const mat = materials[prim.material];
            if (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) {
              const c = mat.pbrMetallicRoughness.baseColorFactor;
              color = new THREE.Color(c[0], c[1], c[2]);
            }
          }

          result.push({
            geometry: geo,
            name: node.name || "brain",
            color: color,
          });
        }
      }

      return result;
    },

    _readAccessor: function (binData, accessor, bufferView) {
      const compSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
      const numComps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
      const compSize = compSizes[accessor.componentType] || 4;
      const numComp = numComps[accessor.type] || 3;
      const count = accessor.count;
      const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      const byteStride = bufferView.byteStride || (compSize * numComp);
      const view = new DataView(binData, byteOffset);

      let TypedArray;
      switch (accessor.componentType) {
        case 5120: TypedArray = Int8Array; break;
        case 5121: TypedArray = Uint8Array; break;
        case 5122: TypedArray = Int16Array; break;
        case 5123: TypedArray = Uint16Array; break;
        case 5125: TypedArray = Uint32Array; break;
        case 5126: TypedArray = Float32Array; break;
        default: TypedArray = Float32Array;
      }

      const result = new TypedArray(count * numComp);

      for (let i = 0; i < count; i++) {
        for (let j = 0; j < numComp; j++) {
          const off = i * byteStride + j * compSize;
          switch (accessor.componentType) {
            case 5126: result[i * numComp + j] = view.getFloat32(off, true); break;
            case 5125: result[i * numComp + j] = view.getUint32(off, true); break;
            case 5123: result[i * numComp + j] = view.getUint16(off, true); break;
            case 5122: result[i * numComp + j] = view.getInt16(off, true); break;
            case 5121: result[i * numComp + j] = view.getUint8(off); break;
            default:   result[i * numComp + j] = view.getFloat32(off, true);
          }
        }
      }

      return result;
    }
  };

  window.GLBLoader = GLBLoader;
})();
