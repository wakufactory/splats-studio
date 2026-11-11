import { encodePly, STRIDE } from "./sdf.mjs";

// Pin both the converter and its WASM asset; the CDN ESM build resolves PlayCanvas.
const library = "https://cdn.jsdelivr.net/npm/@playcanvas/splat-transform@3.10.3/+esm";
const wasm = "https://cdn.jsdelivr.net/npm/@playcanvas/splat-transform@3.10.3/lib/webp.wasm";

try {
  const api = await import(library);
  // SH0 needs no GPU clustering. Run CPU tasks in this dedicated worker rather
  // than spawning the library's workers (whose URL changes in CDN ESM builds).
  api.WorkerQueue.maxWorkers = 0;
  api.WebPCodec.wasmUrl = wasm;
  api.logger.setVerbosity("quiet");
  await api.WebPCodec.create();

  self.onmessage = async ({ data: result }) => {
    let source;
    try {
      // Our preview/PLY is Y-up. Standard splat viewers (including ours) apply
      // an X half-turn on import, so store SOG in that convention. The buffer
      // is a transferred copy; the displayed source remains untouched.
      const d = result.data;
      for (let i = 0; i < d.length; i += STRIDE) {
        d[i + 1] = -d[i + 1];
        d[i + 2] = -d[i + 2];
        d[i + 4] = -d[i + 4];
        d[i + 5] = -d[i + 5];
        const x = d[i + 6], y = d[i + 7], z = d[i + 8], w = d[i + 9];
        // (1, 0, 0, 0) * quaternion
        d[i + 6] = w;
        d[i + 7] = -z;
        d[i + 8] = y;
        d[i + 9] = -x;
      }
      const input = new api.MemoryReadFileSystem();
      input.set("surface.ply", encodePly(result));
      [source] = await api.readFile({
        filename: "surface.ply", inputFormat: "ply", fileSystem: input,
      });
      const output = new api.MemoryFileSystem();
      await api.writeSource({
        filename: "surface.sog", outputFormat: "sog-bundle", source,
        pool: api.createChunkDataPool(), options: {},
      }, output);
      const bytes = output.results.get("surface.sog");
      if (!bytes?.byteLength) throw new Error("SOG データが空です。");
      self.postMessage({ type: "result", bytes }, [bytes.buffer]);
    } catch (error) {
      self.postMessage({ type: "error", message: error.message });
    } finally {
      await source?.close();
    }
  };
  self.postMessage({ type: "ready" });
} catch (error) {
  self.postMessage({ type: "unavailable", message: error.message });
}
