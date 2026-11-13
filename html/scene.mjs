import { parseScene, compileDefinitions, dslError } from "./scene-dsl.mjs";
import { generateSurface, STRIDE } from "./sdf.mjs";

const sampling = { extent: "extent", resolution: "resolution" };
const splat = { size: "size", thickness: "thickness", color: "color", secondaryColor: "secondaryColor", secondaryRatio: "secondaryRatio" };
const effect = { type: "effect", density: "density", length: "hairLength", width: "hairWidth", disorder: "disorder",
  variation: "variation", clump: "clump", clumpSize: "clumpSize", base: "base" };
const ranges = { extent: [0.1, 20], resolution: [16, 144], size: [0.3, 1.5], thickness: [0.05, 0.8],
  secondaryRatio: [0, 1], density: [0, 4000], hairLength: [0.01, 0.6], hairWidth: [0.001, 0.15],
  disorder: [0, 1], variation: [0, 1], clump: [0, 1], clumpSize: [0.03, 1], seed: [0, 1_000_000],
  ambientIntensity: [0, 1], mainIntensity: [0, 2], fillIntensity: [0, 2], mainAzimuth: [-180, 180], mainElevation: [-90, 90] };

export const sceneDefaults = {
  extent: 1.5, resolution: 64, size: 0.72, thickness: 0.15,
  color: "#71debb", secondaryColor: "#de7194", secondaryRatio: 0, seed: 1,
  effect: "none", density: 700, hairLength: 0.16, hairWidth: 0.012,
  disorder: 0.35, variation: 0.4, clump: 0.3, clumpSize: 0.25, base: true,
  ambientIntensity: 0.37, mainIntensity: 0.61, mainAzimuth: 46.15, mainElevation: 58.2, fillIntensity: 0.23,
};

function validate(key, value, token) {
  let valid;
  if (ranges[key]) {
    const [min, max] = ranges[key];
    valid = typeof value === "number" && Number.isFinite(value) && value >= min && value <= max &&
      (!["resolution", "seed"].includes(key) || Number.isInteger(value));
  } else if (key === "color" || key === "secondaryColor") valid = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  else if (key === "effect") valid = ["none", "fur", "fluffy"].includes(value);
  else if (key === "base") valid = typeof value === "boolean";
  if (!valid) throw dslError(token, `${key} の値が不正、または範囲外です。`);
  return value;
}

export function compileScene(source, uiDefaults = {}) {
  const ast = parseScene(source), { functions, evaluate } = compileDefinitions(ast);
  const value = entry => {
    if (!entry.value) throw dslError(entry.token, "値を指定してください。");
    // Enum literals are allowed only where the schema expects an effect type.
    return evaluate(entry.value);
  };
  const blockNames = new Set(["sampling", "splat", "effect", "lighting", "transform", "main", "fill"]);
  const resolved = new Map(), active = new Set(), resolvedBlocks = new WeakSet();
  function merge(base, overrides) {
    if (base === overrides || !overrides.size) return base;
    const result = new Map(base);
    for (const [name, entry] of overrides) {
      const previous = result.get(name);
      result.set(name, previous?.block && entry.block
        ? { ...entry, block: merge(previous.block, entry.block) } : entry);
    }
    return result;
  }
  function definition(token, depth) {
    const name = token.value;
    if (!ast.defines.has(name)) throw dslError(token, `未定義のdefineです: ${name}`);
    if (active.has(name)) throw dslError(token, `defineの循環参照は使えません: ${name}`);
    if (resolved.has(name)) return resolved.get(name);
    active.add(name);
    const result = group(ast.defines.get(name), depth);
    active.delete(name); resolved.set(name, result);
    return result;
  }
  function group(entry, depth = 0) {
    if (depth > 32) throw dslError(entry.token, "define・設定の参照が深すぎます。");
    if (!entry.reference && entry.block && resolvedBlocks.has(entry.block)) return entry.block;
    const reference = entry.reference ?? (entry.value?.type === "name" ? entry.value.token : null);
    if (!entry.block && !reference) throw dslError(entry.token, "{ ... } またはdefine名で設定してください。");
    const base = reference ? definition(reference, depth + 1) : new Map();
    const overrides = new Map();
    for (const [name, child] of entry.block ?? []) {
      overrides.set(name, child.block || child.reference || blockNames.has(name)
        ? { block: group(child, depth + 1), token: child.token } : child);
    }
    const result = merge(base, overrides);
    resolvedBlocks.add(result);
    return result;
  }
  // Resolve even unused definitions so missing names and cycles are caught early.
  for (const [name, entry] of ast.defines) definition({ ...entry.token, value: name }, 0);
  function settings(entries, schema) {
    const output = {};
    for (const [name, entry] of entries) {
      if (!Object.hasOwn(schema, name)) throw dslError(entry.token, `未知の設定です: ${name}`);
      const key = schema[name];
      const v = key === "effect" && entry.value?.type === "name" && ["none", "fur", "fluffy"].includes(entry.value.name)
        ? entry.value.name : value(entry);
      output[key] = validate(key, v, entry.token);
    }
    return output;
  }
  function lighting(entries) {
    const output = {};
    for (const [name, entry] of entries) {
      if (name === "ambient") Object.assign(output, settings(new Map([[name, entry]]), { ambient: "ambientIntensity" }));
      else if (name === "main") Object.assign(output, settings(group(entry), { intensity: "mainIntensity", azimuth: "mainAzimuth", elevation: "mainElevation" }));
      else if (name === "fill") Object.assign(output, settings(group(entry), { intensity: "fillIntensity" }));
      else throw dslError(entry.token, `未知の照明設定です: ${name}`);
    }
    return output;
  }
  function groups(entries, object = false) {
    const output = {};
    for (const [name, entry] of entries) {
      if (object && ["shape", "transform", "seed"].includes(name)) continue;
      if (name === "lighting") Object.assign(output, lighting(group(entry)));
      else {
        const schemas = { sampling, splat, effect };
        const schema = Object.hasOwn(schemas, name) ? schemas[name] : null;
        if (!schema) throw dslError(entry.token, `未知の設定ブロックです: ${name}`);
        Object.assign(output, settings(group(entry), schema));
      }
    }
    return output;
  }
  const defaults = { ...sceneDefaults, ...uiDefaults, ...lighting(group(ast.lighting)), ...groups(group(ast.defaults)) };
  if (ast.seed) defaults.seed = validate("seed", value(ast.seed), ast.seed.token);
  for (const [key, v] of Object.entries(defaults)) validate(key, v, ast.seed?.token ?? ast.objects[0].token);
  const objects = ast.objects.map(object => {
    const { token, name } = object;
    const entries = group({ block: object.entries, token });
    const options = { ...defaults, ...groups(entries, true) };
    const shape = entries.get("shape");
    if (!shape || shape.value?.type !== "name" || !ast.sdfs.has(shape.value.name)) {
      throw dslError(shape?.token ?? token, `object ${name}: shape に定義済みのSDF名を指定してください。`);
    }
    if (entries.has("seed")) options.seed = validate("seed", value(entries.get("seed")), entries.get("seed").token);
    else {
      let hash = defaults.seed >>> 0;
      for (const c of name) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
      options.seed = hash % 1_000_001;
    }
    const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    if (entries.has("transform")) {
      for (const [key, entry] of group(entries.get("transform"))) {
        if (!Object.hasOwn(transform, key)) throw dslError(entry.token, `未知のtransform設定です: ${key}`);
        const v = value(entry);
        const valid = key === "scale" ? typeof v === "number" && Number.isFinite(v) && v > 0
          : Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n));
        if (!valid) throw dslError(entry.token, `${key} は${key === "scale" ? "正の数値" : "3要素の数値配列"}にしてください。`);
        transform[key] = v;
      }
    }
    return { name, token, sdf: functions[shape.value.name], options, transform };
  });
  return { objects };
}

// Euler XYZ: q = qx * qy * qz, matching three.js's default Euler convention.
function rotationQuaternion(degrees) {
  const [x, y, z] = degrees.map(v => v * Math.PI / 360);
  const a = Math.cos(x), b = Math.cos(y), c = Math.cos(z), d = Math.sin(x), e = Math.sin(y), f = Math.sin(z);
  return [d * b * c + a * e * f, a * e * c - d * b * f, a * b * f + d * e * c, a * b * c - d * e * f];
}
function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function rotate(v, q) {
  const [x, y, z] = v, [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

export function generateScene(source, defaults = {}, onProgress = () => {}) {
  const start = performance.now(), scene = compileScene(source, defaults);
  const parts = [], objects = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let count = 0, hairCount = 0, surfaceCount = 0, clipped = false;
  for (const object of scene.objects) {
    const { name, sdf, options, transform, token } = object;
    onProgress({ name, index: objects.length, total: scene.objects.length });
    try {
      if (count >= 500_000) throw new Error("scene全体でスプラットが50万個を超えます。");
      const part = generateSurface(sdf, options, { deferLighting: true, maxSplats: 500_000 - count });
      const q = rotationQuaternion(transform.rotation);
      const az = options.mainAzimuth * Math.PI / 180, el = options.mainElevation * Math.PI / 180;
      const light = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      for (let i = 0; i < part.data.length; i += STRIDE) {
        const d = part.data;
        const p = rotate(d.subarray(i, i + 3), q).map((v, a) => v * transform.scale + transform.position[a]);
        const n = rotate(d.subarray(i + 3, i + 6), q);
        const orientation = multiply(q, d.subarray(i + 6, i + 10));
        d.set(p, i); d.set(n, i + 3); d.set(orientation, i + 6);
        const brightness = Math.min(1, options.ambientIntensity + options.mainIntensity * Math.max(0, n.reduce((s, v, a) => s + v * light[a], 0)) +
          options.fillIntensity * Math.max(0, -0.8 * n[0] + 0.28 * n[1] - 0.52 * n[2]));
        for (let a = 0; a < 3; a++) {
          d[i + 10 + a] *= brightness;
          d[i + 14 + a] *= transform.scale;
        }
        const support = 3 * Math.max(d[i + 14], d[i + 15], d[i + 16]);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], d[i + a] - support);
          max[a] = Math.max(max[a], d[i + a] + support);
        }
        if (!d.subarray(i, i + STRIDE).every(Number.isFinite) || !(Math.min(d[i + 14], d[i + 15], d[i + 16]) > 0)) {
          throw new Error("transform後の値が数値範囲を超えました。");
        }
      }
      objects.push({ name, offset: count, count: part.count, hairCount: part.hairCount, clipped: part.clipped });
      count += part.count; hairCount += part.hairCount; surfaceCount += part.surfaceCount; clipped ||= part.clipped;
      parts.push(part.data);
    } catch (error) {
      throw dslError(token, `object ${name}: ${error.message}`);
    }
  }
  const data = new Float32Array(count * STRIDE);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return { data, count, hairCount, surfaceCount, min, max, clipped, objects, elapsed: performance.now() - start };
}
