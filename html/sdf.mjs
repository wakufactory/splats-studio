export const presets = {
  torus: {
    name: "トーラス",
    source: `// XZ 平面に沿うリング（Y が上）
function sdf(x, y, z) {
  const ring = Math.hypot(x, z) - 0.88;
  return Math.hypot(ring, y) - 0.34;
}`,
  },
  sphere: {
    name: "球",
    source: `function sdf(x, y, z) {
  return Math.hypot(x, y, z) - 1.0;
}`,
  },
  box: {
    name: "角丸ボックス",
    source: `function sdf(x, y, z) {
  const a = Math.abs(x) - 0.76;
  const b = Math.abs(y) - 0.55;
  const c = Math.abs(z) - 0.76;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0))
    + Math.min(Math.max(a, b, c), 0) - 0.18;
}`,
  },
  cut: {
    name: "差分：3方向の貫通穴",
    source: `function sdf(x, y, z) {
  const body = Math.hypot(x, y, z) - 1.16;
  const holes = Math.min(Math.hypot(x, y), Math.hypot(y, z), Math.hypot(z, x)) - 0.40;
  return Math.max(body, -holes);
}`,
  },
};

export const STRIDE = 17; // xyz, normal xyz, quaternion xyzw, rgb, alpha, scales xyz
const edgePairs = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

export function compileSdf(source) {
  const sdf = new Function('"use strict";\n' + source +
    '\nreturn typeof sdf === "function" ? sdf : null;')();
  if (!sdf) throw new Error("function sdf(x, y, z) を定義してください。");
  return sdf;
}

export function generateSurface(sdf, { resolution, extent, size, thickness, color,
  secondaryColor = "#de7194", secondaryRatio = 0,
  ambientIntensity = 0.37, mainIntensity = 0.61, mainAzimuth = 46.15, mainElevation = 58.2,
  fillIntensity = 0.23, ...effectOptions }, { deferLighting = false, maxSplats = 500_000 } = {}) {
  const effect = validateEffect(effectOptions);
  if (!Number.isInteger(resolution) || resolution < 16 || resolution > 144 ||
      !Number.isFinite(extent) || extent < 0.1 || extent > 20 ||
      !Number.isFinite(size) || size < 0.3 || size > 1.5 ||
      !Number.isFinite(thickness) || thickness < 0.05 || thickness > 0.8 ||
      !/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(secondaryColor) ||
      !Number.isFinite(secondaryRatio) || secondaryRatio < 0 || secondaryRatio > 1) {
    throw new Error("生成パラメータが範囲外です。");
  }
  const lightingRanges = [[ambientIntensity, 0, 1], [mainIntensity, 0, 2],
    [fillIntensity, 0, 2], [mainAzimuth, -180, 180], [mainElevation, -90, 90]];
  if (lightingRanges.some(([value, min, max]) => !Number.isFinite(value) || value < min || value > max)) {
    throw new Error("照明パラメータが範囲外です。");
  }
  const azimuth = mainAzimuth * Math.PI / 180, elevation = mainElevation * Math.PI / 180;
  // Direction from the surface toward the light; Y is up, azimuth 0 is +Z.
  const lx = Math.sin(azimuth) * Math.cos(elevation), ly = Math.sin(elevation);
  const lz = Math.cos(azimuth) * Math.cos(elevation);
  const start = performance.now();
  const sample = (x, y, z) => {
    const d = sdf(x, y, z);
    if (!Number.isFinite(d)) {
      throw new Error(`SDF が有限の数値を返しません（${[x, y, z].map(v => v.toFixed(3)).join(", ")}）。`);
    }
    return d;
  };
  const n = resolution, side = n + 1, plane = side * side;
  const step = 2 * extent / n;
  const grid = new Float64Array(side ** 3);
  const coord = i => i * step - extent;
  let clipped = false;
  for (let k = 0, i = 0; k <= n; k++) {
    for (let j = 0; j <= n; j++) {
      for (let x = 0; x <= n; x++, i++) {
        const d = grid[i] = sample(coord(x), coord(j), coord(k));
        if (d <= 0 && (x === 0 || x === n || j === 0 || j === n || k === 0 || k === n)) clipped = true;
      }
    }
  }

  let data = new Float32Array(4096 * STRIDE);
  let count = 0;
  const ds = new Float64Array(8);
  const offsets = [0, 1, side, side + 1, plane, plane + 1, plane + side, plane + side + 1];
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const secondaryRgb = [1, 3, 5].map(i => parseInt(secondaryColor.slice(i, i + 2), 16) / 255);
  const e = step * 0.04;
  const alpha = 0.92;

  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const index = k * plane + j * side + i;
        let mask = 0;
        for (let c = 0; c < 8; c++) if ((ds[c] = grid[index + offsets[c]]) < 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;

        // Average the zero crossings of the cell edges, then refine on the SDF.
        let u = 0, v = 0, w = 0, crossings = 0;
        for (let c = 0; c < edgePairs.length; c += 2) {
          const a = edgePairs[c], b = edgePairs[c + 1];
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = ds[a] / (ds[a] - ds[b]);
          u += (a & 1) + ((a ^ b) === 1 ? t : 0);
          v += ((a >> 1) & 1) + ((a ^ b) === 2 ? t : 0);
          w += (a >> 2) + ((a ^ b) === 4 ? t : 0);
          crossings++;
        }
        let x = coord(i + u / crossings), y = coord(j + v / crossings), z = coord(k + w / crossings);
        let gx, gy, gz, length;
        for (let pass = 0; pass <= 4; pass++) {
          gx = sample(x + e, y, z) - sample(x - e, y, z);
          gy = sample(x, y + e, z) - sample(x, y - e, z);
          gz = sample(x, y, z + e) - sample(x, y, z - e);
          length = Math.hypot(gx, gy, gz);
          if (length === 0 || pass === 4) break;
          const distance = (sample(x, y, z) / length) * (2 * e);
          if (Math.abs(distance) < step * 1e-5) break;
          const delta = Math.max(-step / 2, Math.min(step / 2, distance)) / length;
          const px = x - gx * delta, py = y - gy * delta, pz = z - gz * delta;
          if (Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)) > extent) break;
          x = px; y = py; z = pz;
        }
        if (!(length > 0)) continue;
        const nx = gx / length, ny = gy / length, nz = gz / length;

        // Rotate the splat's thin Z axis onto the surface normal.
        let qx = -ny, qy = nx, qw = 1 + nz;
        const qlen = Math.hypot(qx, qy, qw);
        if (qlen > 1e-8) {
          qx /= qlen; qy /= qlen; qw /= qlen;
        } else {
          qx = 1; qy = 0; qw = 0;
        }
        const key = Math.max(0, lx * nx + ly * ny + lz * nz);
        const fill = Math.max(0, -0.8 * nx + 0.28 * ny - 0.52 * nz);
        const light = deferLighting ? 1 : Math.min(1, ambientIntensity + mainIntensity * key + fillIntensity * fill);
        if (count >= 500_000) throw new Error("スプラットが50万個を超えました。分割数を下げてください。");
        if (count * STRIDE === data.length) {
          const larger = new Float32Array(data.length * 2);
          larger.set(data);
          data = larger;
        }
        data.set([x, y, z, nx, ny, nz, qx, qy, 0, qw,
          light, light, light, alpha,
          step * size, step * size, step * size * thickness], count++ * STRIDE);
      }
    }
  }
  if (!count) throw new Error("表面が見つかりません。探索範囲、分割数、SDF の符号を確認してください。");

  const surface = addEffect(data.subarray(0, count * STRIDE), sample, step, { ...effect, maxSplats });
  // Choose colors after effects so every final splat has an independent choice.
  // Keep this random stream separate from hair placement and shape.
  let colorState = effect.seed >>> 0;
  for (let i = 0; i < surface.data.length; i += STRIDE) {
    colorState = (Math.imul(1664525, colorState) + 1013904223) >>> 0;
    const selected = colorState / 4294967296 < secondaryRatio ? secondaryRgb : rgb;
    for (let channel = 0; channel < 3; channel++) surface.data[i + 10 + channel] *= selected[channel];
  }
  return {
    ...surface, clipped,
    scales: [step * size, step * size, step * size * thickness],
    elapsed: performance.now() - start,
  };
}

export const effectDefaults = {
  effect: "none", density: 700, hairLength: 0.16, hairWidth: 0.012,
  disorder: 0.35, variation: 0.4, clump: 0.3, clumpSize: 0.25, seed: 1, base: true,
};

function validateEffect(options) {
  const effect = { ...effectDefaults, ...options };
  const ranges = { density: [0, 4000], hairLength: [0.01, 0.6], hairWidth: [0.001, 0.15],
    disorder: [0, 1], variation: [0, 1], clump: [0, 1], clumpSize: [0.03, 1], seed: [0, 1000000] };
  if (!["none", "fur", "fluffy"].includes(effect.effect) || typeof effect.base !== "boolean" ||
      !Number.isInteger(effect.seed) || Object.entries(ranges).some(([key, [min, max]]) =>
        !Number.isFinite(effect[key]) || effect[key] < min || effect[key] > max)) {
    throw new Error("表面エフェクトのパラメータが範囲外です。");
  }
  return effect;
}

function addEffect(surface, sample, step, options) {
  const { effect, density, hairLength, hairWidth, disorder, variation, clump, clumpSize, base } = options;
  let state = options.seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let data = new Float32Array(Math.max(4096, surface.length));
  let count = 0, hairCount = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  function push(record) {
    if (count >= options.maxSplats) throw new Error("scene全体でスプラットが50万個を超えます。密度または分割数を下げてください。");
    if ((count + 1) * STRIDE > data.length) {
      const larger = new Float32Array(data.length * 2);
      larger.set(data);
      data = larger;
    }
    data.set(record, count++ * STRIDE);
    // Conservative 3-sigma support, including long outward splats.
    const support = 3 * Math.max(record[14], record[15], record[16]);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], record[axis] - support);
      max[axis] = Math.max(max[axis], record[axis] + support);
    }
  }
  for (let i = 0; i < surface.length; i += STRIDE) {
    const root = surface.subarray(i, i + STRIDE);
    if (effect === "none" || base) push(root);
    if (effect === "none" || density === 0) continue;
    const normal = [...root.subarray(3, 6)];
    // A plane crosses ~sum(abs(normal)) cells per unit area / step^2.
    const expected = density * step * step / normal.reduce((sum, n) => sum + Math.abs(n), 0);
    const roots = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
    const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tangent = normalize(cross(normal, helper));
    const bitangent = cross(normal, tangent);
    for (let h = 0; h < roots; h++) {
      const u = (random() - 0.5) * step, v = (random() - 0.5) * step;
      let position = normal.map((_, a) => root[a] + tangent[a] * u + bitangent[a] * v);
      // Project jittered roots back to the implicit surface using its gradient.
      for (let pass = 0; pass < 3; pass++) {
        const e = step * 0.04;
        const gradient = position.map((_, a) => {
          const plus = [...position], minus = [...position];
          plus[a] += e; minus[a] -= e;
          return (sample(...plus) - sample(...minus)) / (2 * e);
        });
        const g2 = gradient.reduce((sum, n) => sum + n * n, 0);
        if (g2 < 1e-12) break;
        const d = sample(...position);
        position = position.map((p, a) => p - gradient[a] * d / g2);
      }
      const e = step * 0.04;
      const rootGradient = position.map((_, a) => {
        const plus = [...position], minus = [...position];
        plus[a] += e; minus[a] -= e;
        return sample(...plus) - sample(...minus);
      });
      const outward = Math.hypot(...rootGradient) > 1e-12 ? normalize(rootGradient) : normal;
      // Smooth spatial field gives neighboring hairs a shared lean (no cell seams).
      const phase = options.seed * 0.73;
      const field = position.map((p, a) => Math.sin(p / clumpSize * 3 + phase + a * 2.1));
      const projection = field.reduce((sum, n, a) => sum + n * outward[a], 0);
      const noise = outward.map(() => (random() * 2 - 1) * disorder);
      const lean = outward.map((_, a) => (field[a] - projection * outward[a]) * clump + noise[a]);
      const length = hairLength * (1 + (random() * 2 - 1) * variation * 0.8);
      const width = hairWidth * (1 + (random() * 2 - 1) * variation * 0.6);
      const segments = effect === "fur" ? 3 : 1;
      for (let segment = 0; segment < segments; segment++) {
        const t = (segment + 0.5) / segments;
        const direction = normalize(outward.map((n, a) => n + lean[a] * 2 * t));
        const q = quaternionFromZ(direction);
        const center = position.map((p, a) => p + length * (outward[a] * t + lean[a] * t * t));
        const scales = effect === "fur"
          ? [width * (1 - 0.65 * t), width * (1 - 0.65 * t), length / segments * 0.55]
          : [width, width, length * 0.5];
        const shade = 0.75 + t * 0.25;
        push([...center, ...outward, ...q, ...[root[10], root[11], root[12]].map(c => c * shade),
          effect === "fur" ? 0.88 : 0.8, ...scales]);
      }
      hairCount++;
    }
  }
  if (!count) throw new Error("毛が生成されません。密度を上げるか、下地を表示してください。");
  return { data: data.slice(0, count * STRIDE), count, min, max, hairCount,
    surfaceCount: surface.length / STRIDE };
}

const normalize = v => {
  const length = Math.hypot(...v);
  return v.map(n => n / length);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function quaternionFromZ([x, y, z]) {
  return z < -0.99999999 ? [1, 0, 0, 0] : normalize([-y, x, 0, 1 + z]);
}

export function encodePly({ data, count }) {
  const properties = [
    "x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header = new TextEncoder().encode([
    "ply", "format binary_little_endian 1.0", "comment SDF Splat Studio - Y up",
    `element vertex ${count}`, ...properties.map(name => "property float " + name), "end_header", "",
  ].join("\n"));
  const bytes = new Uint8Array(header.length + count * properties.length * 4);
  bytes.set(header);
  const view = new DataView(bytes.buffer, header.length);
  const sh = 0.28209479177387814;

  for (let i = 0; i < count; i++) {
    const offset = i * STRIDE;
    const alpha = data[offset + 13];
    const values = [
      ...data.subarray(offset, offset + 6),
      ...data.subarray(offset + 10, offset + 13).map(channel => (channel - 0.5) / sh),
      Math.log(alpha / (1 - alpha)), ...data.subarray(offset + 14, offset + 17).map(Math.log),
      data[offset + 9], ...data.subarray(offset + 6, offset + 9),
    ];
    for (let j = 0; j < values.length; j++) {
      view.setFloat32((i * properties.length + j) * 4, values[j], true);
    }
  }
  return bytes;
}
