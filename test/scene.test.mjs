import assert from "node:assert/strict";
import test from "node:test";
import { compileScene, generateScene } from "../html/scene.mjs";
import { scenePresets } from "../html/scene-presets.mjs";
import { encodePly, STRIDE } from "../html/sdf.mjs";

const ball = "sdf ball(x,y,z) { return sphere(x,y,z,1); }";
const scene = (objects, extra = "") => `${ball}\nscene { ${extra}\n${objects} }`;
const defaults = { resolution: 16, ambientIntensity: 1, mainIntensity: 0, fillIntensity: 0 };
const generate = (source, options = {}) => generateScene(source, { ...defaults, ...options });
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const partData = (result, name) => {
  const part = result.objects.find(o => o.name === name);
  return result.data.slice(part.offset * STRIDE, (part.offset + part.count) * STRIDE);
};

test("all DSL presets generate exportable finite splats", () => {
  for (const { source } of Object.values(scenePresets)) {
    const result = generate(source);
    assert.ok(result.count > 0);
    assert.equal(result.count * STRIDE, result.data.length);
    assert.ok(result.data.every(Number.isFinite));
    assert.ok(encodePly(result).length > result.data.byteLength);
  }
});

test("expressions, constants, local bindings, forward SDF calls and CSG", () => {
  const source = `version 1;
    // Forward references between SDFs are allowed.
    let radius = sqrt(4) / 2;
    sdf shape(x,y,z) {
      let d = other(x,y,z);
      return x > 0 && y != 9 ? union(d, 10) : subtract(d, -10);
    }
    sdf other(a,b,c) { return length([a,b,c]) - radius; }
    scene { object body { shape = shape; } }
  `;
  const { sdf } = compileScene(source).objects[0];
  near(sdf(2, 0, 0), 1); near(sdf(-2, 0, 0), 10);
  const compiled = compileScene(`let a = -2**2 + 3 * 4; ${ball} scene {
    object a { shape = ball; splat { size = a / 10; } }
  }`);
  near(compiled.objects[0].options.size, 0.8);
});

test("UI defaults are inherited and DSL defaults and individual properties override them", () => {
  const source = scene(`
    object a { shape = ball; splat { color = "#ff0000"; } }
    object b { shape = ball; sampling { resolution = 24; } effect { type = none; } seed = 9; }
  `, `seed = 42;
    lighting { ambient = 0.2; main { intensity = 0.8; azimuth = 90; } }
    defaults { splat { size = 0.9; } effect { type = fur; length = 0.2; } }
  `);
  const [a, b] = compileScene(source, { resolution: 32, size: 0.7, color: "#00ff00", mainElevation: 10 }).objects;
  assert.equal(a.options.resolution, 32);
  assert.equal(b.options.resolution, 24);
  assert.equal(a.options.size, 0.9);
  assert.equal(b.options.size, 0.9);
  assert.equal(a.options.color, "#ff0000");
  assert.equal(b.options.color, "#00ff00");
  assert.equal(a.options.effect, "fur");
  assert.equal(b.options.effect, "none");
  assert.equal(a.options.hairLength, 0.2);
  assert.equal(a.options.ambientIntensity, 0.2);
  assert.equal(a.options.mainIntensity, 0.8);
  assert.equal(a.options.mainElevation, 10);
  assert.equal(b.options.seed, 9);
});

test("each object has its own surface, color and effect, with stable seeds across ordering", () => {
  const fur = 'object furred { shape = ball; effect { type = fur; density = 10; base = false; } splat { color = "#ff0000"; secondaryRatio = 0.3; } }';
  const smooth = 'object smooth { shape = ball; splat { color = "#0000ff"; } }';
  const a = generate(scene(fur + smooth)), b = generate(scene(smooth + fur));
  assert.deepEqual(partData(a, "furred"), partData(b, "furred"));
  assert.deepEqual(partData(a, "smooth"), partData(b, "smooth"));
  assert.deepEqual(a.data, generate(scene(fur + smooth)).data);
  assert.notDeepEqual(partData(a, "furred"), partData(generate(scene(fur + smooth, "seed = 2;")), "furred"));
  assert.equal(a.objects[0].count, a.hairCount * 3);
  const d = partData(a, "smooth");
  for (let i = 0; i < d.length; i += STRIDE) {
    assert.equal(d[i + 10], 0); assert.equal(d[i + 11], 0); assert.equal(d[i + 12], 1);
  }
});

test("transforms move positions, rotate normals and Gaussian axes, scale effects and update bounds", () => {
  const base = generate(scene('object item { shape = ball; effect { type = fur; density = 10; } }'));
  const transformed = generate(scene(`object item {
    shape = ball; effect { type = fur; density = 10; }
    transform { position = [3, 4, 5]; rotation = [0,0,90]; scale = 2; }
  }`));
  assert.equal(base.count, transformed.count);
  for (let i = 0; i < base.data.length; i += STRIDE) {
    const a = base.data.subarray(i, i + STRIDE), b = transformed.data.subarray(i, i + STRIDE);
    near(b[0], 3 - 2 * a[1]); near(b[1], 4 + 2 * a[0]); near(b[2], 5 + 2 * a[2]);
    near(b[3], -a[4]); near(b[4], a[3]); near(b[5], a[5]);
    const [x,y,z,w] = b.subarray(6, 10);
    near(Math.hypot(x,y,z,w), 1);
    const [ax,ay,az,aw] = a.subarray(6, 10);
    const oldAxis = [2 * (ax*az + aw*ay), 2 * (ay*az - aw*ax), 1 - 2 * (ax*ax + ay*ay)];
    near(2 * (x*z + w*y), -oldAxis[1]); near(2 * (y*z - w*x), oldAxis[0]); near(1 - 2 * (x*x + y*y), oldAxis[2]);
    for (let axis = 0; axis < 3; axis++) {
      near(b[14 + axis], 2 * a[14 + axis]);
      assert.ok(b[axis] >= transformed.min[axis] && b[axis] <= transformed.max[axis]);
    }
  }
});

test("lighting uses world normals after rotation, including effect splats", () => {
  const result = generate(scene(`object item {
    shape = ball;
    transform { rotation = [25, 45, 90]; }
    splat { color = "#ffffff"; }
  }`), { ambientIntensity: 0, mainIntensity: 1, mainAzimuth: 90, mainElevation: 0, fillIntensity: 0 });
  for (let i = 0; i < result.data.length; i += STRIDE) near(result.data[i + 10], Math.max(0, result.data[i + 3]));
});

test("syntax, names, types and invalid settings produce line and column errors", () => {
  const invalid = [
    scene('object a { shape = missing; }'),
    scene('object a { shape = ball; splat { typo = 0.7; } }'),
    scene('object a { shape = ball; transform { scale = [1,2,3]; } }'),
    scene('object a { shape = ball; transform { rotation = [1,2]; } }'),
    scene('object a { shape = ball; effect { type = furry; } }'),
    scene('object a { shape = ball; effect { density = 5000; } }'),
    scene('object a { shape = ball; effect { base = 0; } }'),
    scene('object a { shape = ball; sampling { resolution = 16.5; } }'),
    scene('object a { shape = ball; seed = -1; }'),
    scene('object a { shape = ball; shape = ball; }'),
    scene('object a { shape = ball; } object a { shape = ball; }'),
    scene('object a { shape = ball; constructor {} }'),
    scene('object a { shape = ball; toString {} }'),
    scene('object a { shape = ball; }', 'defaults { __proto__ {} }'),
    scene('object a { shape = ball; splat { color = "red"; } }'),
    scene('object a { shape = ball; splat { size = 1/0; } }'),
    scene('object a { shape = ball; splat { size = 0.7 } }'),
    scene('object a { shape = ball; }', 'seed = "1";'),
    'sdf ball(x,x,z) { return x; } scene { object a { shape = ball; } }',
    'sdf ball(x,y,z) { return ball(x,y,z); } scene { object a { shape = ball; } }',
    'sdf a(x,y,z) { return b(x,y,z); } sdf b(x,y,z) { return a(x,y,z); } scene { object a { shape = a; } }',
    'sdf ball(x,y,z) { return missing(x,y,z); } scene { object a { shape = ball; } }',
    'sdf ball(x,y,z) { return sphere(x,y,z); } scene { object a { shape = ball; } }',
    'sdf ball(x,y,z) { return Math.hypot(x,y,z)-1; } scene { object a { shape = ball; } }',
    'sdf ball(x,y,z) { return globalThis; } scene { object a { shape = ball; } }',
    'function sdf(x,y,z) { return 1; }',
    'scene {}', 'version 2;',
  ];
  for (const source of invalid) assert.throws(() => compileScene(source), /\d+行 \d+列:/, source);
});

test("generation errors identify the failing object; progress and clipping are per object", () => {
  const progress = [];
  const r = generateScene(scene('object small { shape = ball; sampling { extent = 0.9; } } object full { shape = ball; }'), defaults, p => progress.push(p));
  assert.equal(r.clipped, true);
  assert.deepEqual(r.objects.map(o => o.clipped), [true, false]);
  assert.deepEqual(progress.map(p => p.name), ["small", "full"]);
  assert.throws(() => generateScene('sdf bad(x,y,z) { return sqrt(-1); }\nscene { object broken { shape = bad; } }', defaults), /2行.*object broken:.*有限/);
  assert.throws(() => generate(scene('object huge { shape = ball; transform { scale = 1e100; } }')), /object huge:.*数値範囲/);
});

test("the 500,000 splat limit applies to the entire scene", () => {
  const objects = ["a", "b", "c", "d", "e"].map(name => `object ${name} { shape = ball; }`).join("\n");
  assert.throws(() => generate(scene(objects, 'defaults { effect { type = fur; density = 4000; } }')), /object [bcde]:.*scene全体.*50万/);
});
