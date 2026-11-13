import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, serializeProject, parseProject, projectFilename, readSettings, applySettings } from '../html/generator-project.mjs';
import { scenePresets } from '../html/scene-presets.mjs';
import { generateScene } from '../html/scene.mjs';

test('JSON round-trip retains DSL, every default and the save name; restored project generates the same splats', () => {
  const source = scenePresets.torus.source;
  const defaults = { ...defaultSettings, resolution: 16, secondaryRatio: 0.37, seed: 87, mainAzimuth: -81.25 };
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
    ['secondaryRatio', 37], ['mainElevation', 91], ['thickness', '0.15'], ['size', null]]) {
    assert.throws(() => parseProject(JSON.stringify({ ...project, defaults: { ...defaultSettings, [key]: value } })));
  }
  const missing = { ...defaultSettings };
  delete missing.fillIntensity;
  assert.throws(() => parseProject(JSON.stringify({ ...project, defaults: missing })));
  assert.throws(() => parseProject('{broken'), /JSON/);
  assert.equal(parseProject('\uFEFF' + JSON.stringify(project)).source, '');
  assert.throws(() => serializeProject('', { ...defaultSettings, extent: NaN }));
});

test('all controls restore values including percentage and all lighting defaults', () => {
  const controls = Object.fromEntries(Object.keys(defaultSettings).map(key => [key, {
    type: key.includes('Color') || key === 'color' ? 'color' : 'number',
    get valueAsNumber() { return Number(this.value); }, value: '',
  }]));
  const defaults = { ...defaultSettings, secondaryRatio: 0.37, color: '#123456', mainElevation: -10 };
  applySettings(defaults, key => controls[key]);
  assert.equal(controls.secondaryRatio.value, 37);
  assert.deepEqual(readSettings(key => controls[key]), defaults);
});

test('shared export names avoid duplicate extensions and forbidden filename characters', () => {
  assert.equal(projectFilename(' torus.json '), 'torus.json');
  assert.equal(projectFilename(' torus.json ', 'fallback', 'ply'), 'torus.ply');
  assert.equal(projectFilename('shape.sog'), 'shape.json');
  assert.equal(projectFilename('a/b:c*'), 'a_b_c_.json');
  assert.equal(projectFilename('...'), 'sdf-scene.json');
});
