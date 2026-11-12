import test from "node:test";
import assert from "node:assert/strict";
import { disposeSplatMesh } from "../html/splat-resources.mjs";

test("retiring rendered meshes releases generated materials and splat resources", () => {
  const generatorProgram = new WeakMap();
  let liveMaterials = 0, disposedMeshes = 0;
  for (let i = 0; i < 30; i++) {
    const generator = {};
    liveMaterials++;
    generatorProgram.set(generator, {
      prepareMaterial: () => ({ dispose() { liveMaterials--; } }),
    });
    let detached = false;
    const mesh = {
      generator,
      removeFromParent() { detached = true; },
      dispose() { assert.ok(detached); disposedMeshes++; },
    };
    disposeSplatMesh(mesh, { generatorProgram });
    assert.equal(generatorProgram.has(generator), false);
    assert.equal(liveMaterials, 0);
  }
  assert.equal(disposedMeshes, 30);
});

test("unrendered and absent meshes need no generated material", () => {
  const accumulator = { generatorProgram: new WeakMap() };
  let disposed = false;
  disposeSplatMesh(undefined, accumulator);
  disposeSplatMesh({ removeFromParent() {}, dispose() { disposed = true; } }, accumulator);
  assert.ok(disposed);
});
