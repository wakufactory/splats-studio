import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, serializeProject, parseProject, projectFilename, readSettings, applySettings } from '../html/generator-project.mjs';
import { scenePresets } from '../html/scene-presets.mjs';
import { compileScene, generateScene } from '../html/scene.mjs';

test('JSON round-trip retains DSL, every default and the save name; restored project generates the same splats', () => {
  const source = scenePresets.torus.source;
  const defaults = { ...defaultSettings, resolution: 16, secondaryRatio: 0.37, seed: 87, mainAzimuth: -81.25,
    effect: 'fluffy', density: 80, hairLength: 0.12, hairWidth: 0.03, disorder: 0.2, variation: 0.6, clump: 0.5, clumpSize: 0.4, base: false };
  const restored = parseProject(serializeProject(source, defaults, 'my torus'));
  assert.equal(restored.source, source);
  assert.equal(restored.name, 'my torus');
  assert.deepEqual(restored.defaults, defaults);
  assert.deepEqual(generateScene(restored.source, restored.defaults).data, generateScene(source, defaults).data);
});

test('invalid documents, missing settings, unsupported versions and invalid numeric/color types are rejected', () => {
  const project = JSON.parse(serializeProject('', defaultSettings));
  for (const data of [null, [], {}, { ...project, version: 2 }, { ...project, format: 'other' },
    { ...project, source: 5 }, { ...project, source: 'a'.repeat(100_001) }, { ...project, defaults: [] },
    { ...project, name: 5 }]) {
    assert.throws(() => parseProject(JSON.stringify(data)));
  }
  for (const [key, value] of [['resolution', 16.5], ['extent', 0], ['seed', -1], ['color', 'red'],
    ['secondaryRatio', 37], ['mainElevation', 91], ['thickness', '0.15'], ['size', null],
    ['effect', 'other'], ['base', 'false'], ['base', null], ['density', -1], ['hairLength', 0],
    ['hairWidth', 0.16], ['disorder', 2], ['variation', -0.1], ['clump', '0.3'], ['clumpSize', 0]]) {
    assert.throws(() => parseProject(JSON.stringify({ ...project, defaults: { ...defaultSettings, [key]: value } })));
  }
  const missing = { ...defaultSettings };
  delete missing.fillIntensity;
  assert.throws(() => parseProject(JSON.stringify({ ...project, defaults: missing })));
  assert.throws(() => parseProject('{broken'), /JSON/);
  assert.equal(parseProject('\uFEFF' + JSON.stringify(project)).source, '');
  assert.throws(() => serializeProject('', { ...defaultSettings, extent: NaN }));
});

test('all controls restore values including percentage, effect type and the base checkbox', () => {
  const controls = Object.fromEntries(Object.keys(defaultSettings).map(key => [key, {
    type: key === 'base' ? 'checkbox' : key === 'effect' ? 'select-one' : key.includes('Color') || key === 'color' ? 'color' : 'number',
    get valueAsNumber() { return Number(this.value); }, value: '',
  }]));
  const defaults = { ...defaultSettings, secondaryRatio: 0.37, color: '#123456', mainElevation: -10,
    effect: 'fur', base: false, hairLength: 0.3 };
  applySettings(defaults, key => controls[key]);
  assert.equal(controls.secondaryRatio.value, 37);
  assert.deepEqual(readSettings(key => controls[key]), defaults);
  applySettings(defaultSettings, key => controls[key]);
  assert.equal(controls.base.checked, true);
  assert.deepEqual(readSettings(key => controls[key]), defaultSettings);
});

test('older version 1 samples restore missing effect controls to initial defaults', async () => {
  const { readFile } = await import('node:fs/promises');
  const project = parseProject(await readFile(new URL('../html/samples/teddy-bear.json', import.meta.url), 'utf8'));
  for (const key of ['effect', 'density', 'hairLength', 'hairWidth', 'disorder', 'variation', 'clump', 'clumpSize', 'base']) {
    assert.equal(project.defaults[key], defaultSettings[key]);
  }
});

test('UI effect defaults are overridden per field by scene defaults and object settings', () => {
  const source = `sdf ball(x,y,z) { return sphere(x,y,z,1); }
    scene {
      defaults { effect { length = 0.2; } }
      object a { shape = ball; }
      object b { shape = ball; effect { type = fluffy; width = 0.04; base = true; } }
      object c { shape = ball; effect { type = none; } }
    }`;
  const restored = parseProject(serializeProject(source, { ...defaultSettings, effect: 'fur', density: 123, base: false }));
  const [a, b, c] = compileScene(restored.source, restored.defaults).objects.map(object => object.options);
  assert.equal(a.effect, 'fur');
  assert.equal(a.density, 123);
  assert.equal(a.hairLength, 0.2);
  assert.equal(a.base, false);
  assert.equal(b.effect, 'fluffy');
  assert.equal(b.hairWidth, 0.04);
  assert.equal(b.density, 123);
  assert.equal(b.base, true);
  assert.equal(c.effect, 'none');
});

test('shared export names avoid duplicate extensions and forbidden filename characters', () => {
  assert.equal(projectFilename(' torus.json '), 'torus.json');
  assert.equal(projectFilename(' torus.json ', 'fallback', 'ply'), 'torus.ply');
  assert.equal(projectFilename('shape.sog'), 'shape.json');
  assert.equal(projectFilename('a/b:c*'), 'a_b_c_.json');
  assert.equal(projectFilename('...'), 'sdf-scene.json');
});
