import assert from "node:assert/strict";
import test from "node:test";
import { compileSdf, encodePly, generateSurface, presets, STRIDE } from "./sdf.mjs";

const options = { resolution: 48, extent: 1.5, size: 0.72, thickness: 0.15, color: "#71debb" };
const generate = (name, overrides) => generateSurface(compileSdf(presets[name].source), { ...options, ...overrides });
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);

test("sphere samples lie on the zero surface, with the thin axis pointing out", () => {
  const { data, count, scales, clipped } = generate("sphere");
  assert.ok(count > 1000 && !clipped);
  assert.ok(scales[2] < scales[0] && scales[0] === scales[1]);

  for (let i = 0; i < data.length; i += STRIDE) {
    const [x, y, z, nx, ny, nz, qx, qy, qz, qw] = data.subarray(i, i + 10);
    near(Math.hypot(x, y, z), 1);
    near(nx, x, 0.0001);
    near(ny, y, 0.0001);
    near(nz, z, 0.0001);
    near(Math.hypot(qx, qy, qz, qw), 1);
    near(2 * (qx * qz + qw * qy), nx);
    near(2 * (qy * qz - qw * qx), ny);
    near(1 - 2 * (qx * qx + qy * qy), nz);
  }
});

test("torus leaves its hole open and finer sampling adds surface detail", () => {
  const coarse = generate("torus", { resolution: 24 });
  const fine = generate("torus");
  assert.ok(fine.count > coarse.count * 3);
  for (let i = 0; i < fine.data.length; i += STRIDE) {
    const [x, y, z] = fine.data.subarray(i, i + 3);
    const r = Math.hypot(x, z);
    assert.ok(r > 0.53);
    near(Math.hypot(r - 0.88, y), 0.34);
  }
});

test("surface clipping and invalid fields are reported", () => {
  assert.equal(generate("sphere", { extent: 0.9 }).clipped, true);
  assert.throws(() => generateSurface(() => 1, options), /表面が見つかりません/);
  assert.throws(() => generateSurface(() => NaN, options), /有限の数値/);
  assert.throws(() => compileSdf("const radius = 1;"), /sdf/);
});

test("Gaussian PLY records preserve center, normal, RGB, scale, opacity and WXYZ rotation", () => {
  const result = generate("cut");
  const bytes = encodePly(result);
  const offset = Buffer.from(bytes).indexOf("end_header\n") + "end_header\n".length;
  const header = new TextDecoder().decode(bytes.subarray(0, offset));
  assert.match(header, /^ply\nformat binary_little_endian 1\.0\n/);
  assert.match(header, new RegExp(`element vertex ${result.count}\\n`));
  assert.equal(bytes.length - offset, result.count * 17 * 4);
  const view = new DataView(bytes.buffer, offset);
  for (const i of [0, Math.floor(result.count / 2), result.count - 1]) {
    const value = j => view.getFloat32((i * 17 + j) * 4, true);
    const sample = j => result.data[i * STRIDE + j];
    for (let j = 0; j < 6; j++) near(value(j), sample(j));
    for (let j = 0; j < 3; j++) {
      near(0.5 + 0.28209479177387814 * value(6 + j), sample(10 + j));
      near(Math.exp(value(10 + j)), result.scales[j]);
      near(value(14 + j), sample(6 + j));
    }
    near(1 / (1 + Math.exp(-value(9))), sample(13));
    near(value(13), sample(9));
  }
});

test("upright hairs follow normals, keep roots on the sphere, and export individual scales", () => {
  const result = generate("sphere", { effect: "fur", base: false, density: 100,
    hairLength: 0.18, hairWidth: 0.01, disorder: 0, clump: 0, variation: 0 });
  assert.equal(result.count, result.hairCount * 3);
  assert.ok(result.hairCount > 1000);
  for (let i = 0; i < result.data.length; i += STRIDE) {
    const d = result.data.subarray(i, i + STRIDE);
    const segment = (i / STRIDE) % 3, t = (segment + 0.5) / 3;
    near(Math.hypot(d[0], d[1], d[2]), 1 + 0.18 * t, 0.0001);
    const [qx, qy, qz, qw] = d.subarray(6, 10);
    near(2 * (qx * qz + qw * qy), d[3]);
    near(2 * (qy * qz - qw * qx), d[4]);
    near(1 - 2 * (qx * qx + qy * qy), d[5]);
    near(d[14], 0.01 * (1 - 0.65 * t));
    near(d[16], 0.18 / 3 * 0.55);
  }
  const bytes = encodePly(result);
  const offset = Buffer.from(bytes).indexOf("end_header\n") + "end_header\n".length;
  const view = new DataView(bytes.buffer, offset);
  for (const i of [0, 1, result.count - 1]) {
    for (let axis = 0; axis < 3; axis++) {
      near(Math.exp(view.getFloat32((i * 17 + 10 + axis) * 4, true)), result.data[i * STRIDE + 14 + axis]);
    }
  }
});

test("density is approximately independent of sampling resolution and controls hair count", () => {
  const opts = { effect: "fluffy", base: false, density: 100 };
  const coarse = generate("sphere", { ...opts, resolution: 24 });
  const fine = generate("sphere", { ...opts, resolution: 72 });
  assert.ok(Math.abs(coarse.hairCount / fine.hairCount - 1) < 0.15);
  const dense = generate("sphere", { ...opts, density: 200 });
  assert.ok(dense.hairCount > fine.hairCount * 1.7);
  near(coarse.count, coarse.hairCount);
});

test("effects are repeatable, bounded and preserve the optional base", () => {
  const opts = { effect: "fur", density: 80, seed: 42, variation: 1, disorder: 1, clump: 1 };
  const a = generate("torus", opts), b = generate("torus", opts);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, generate("torus", { ...opts, seed: 43 }).data);
  assert.equal(a.count, a.surfaceCount + a.hairCount * 3);
  for (let i = 0; i < a.data.length; i += STRIDE) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(a.data[i + axis] >= a.min[axis] && a.data[i + axis] <= a.max[axis]);
      assert.ok(a.data[i + 14 + axis] > 0);
    }
    near(Math.hypot(...a.data.subarray(i + 6, i + 10)), 1);
  }
  assert.deepEqual(generate("sphere", { effect: "fur", density: 0 }).data, generate("sphere").data);
  assert.throws(() => generate("sphere", { effect: "fluffy", density: 0, base: false }), /毛が生成されません/);
  for (const bad of [{ density: NaN }, { hairWidth: 0 }, { seed: 0.2 }, { effect: "bad" }]) {
    assert.throws(() => generate("sphere", bad), /エフェクト/);
  }
});
