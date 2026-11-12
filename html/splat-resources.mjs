// Spark 2.4.0 disposes a mesh's splat textures, but leaves the accumulator's
// generated RawShaderMaterial undisposed. A WeakMap alone cannot release the
// WebGL program reference registered by Three.js. Keep this version-specific
// workaround here until Spark handles it in SplatMesh.dispose().
export function disposeSplatMesh(mesh, SplatAccumulator) {
  if (!mesh) return;
  mesh.removeFromParent();
  const cache = SplatAccumulator.generatorProgram;
  for (const generator of new Set([mesh.generator, mesh.covGenerator])) {
    const program = cache.get(generator);
    if (!program) continue; // An unrendered mesh has no material to release.
    program.prepareMaterial().dispose();
    cache.delete(generator);
  }
  mesh.dispose();
}
