import { encodePly, presets, STRIDE } from "./sdf.mjs";

const byId = id => document.getElementById(id);
const form = byId("generator"), viewport = byId("viewport"), preset = byId("preset");
const source = byId("source"), generate = byId("generate"), cancel = byId("cancel");
const download = byId("download"), pointsButton = byId("points"), reset = byId("reset");
const status = byId("status"), countFormat = new Intl.NumberFormat("ja-JP");

function showStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

for (const [id, { name }] of Object.entries(presets)) preset.add(new Option(name, id));
preset.value = "torus";
source.value = presets.torus.source;
preset.addEventListener("change", () => { source.value = presets[preset.value].source; });
source.addEventListener("input", () => {
  preset.value = Object.keys(presets).find(id => presets[id].source === source.value) ?? "";
});

function updateEffectControls() {
  byId("effect-controls").hidden = byId("effect").value === "none";
  for (const input of form.querySelectorAll('input[type="range"]')) {
    form.querySelector(`output[for="${input.id}"]`).value = input.value;
  }
}
const effectParameterIds = ["density", "hairLength", "hairWidth", "disorder", "variation", "clump", "clumpSize"];
const initialEffect = Object.fromEntries(effectParameterIds.map(id => [id, byId(id).value]));
const effectSettings = {
  fur: { ...initialEffect }, fluffy: { ...initialEffect, density: "120", hairWidth: "0.045" },
};
let previousEffect = "none";
byId("effect").addEventListener("change", () => {
  if (previousEffect !== "none") {
    effectSettings[previousEffect] = Object.fromEntries(effectParameterIds.map(id => [id, byId(id).value]));
  }
  previousEffect = byId("effect").value;
  if (previousEffect !== "none") {
    for (const [id, value] of Object.entries(effectSettings[previousEffect])) byId(id).value = value;
  }
  updateEffectControls();
});
byId("effect-controls").addEventListener("input", updateEffectControls);
updateEffectControls();

function sampleInWorker(payload, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sdf-worker.mjs", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => finish(new Error("生成が30秒を超えました。SDF や分割数を見直してください。")), 30_000);
    const abort = () => finish(signal.reason);
    function finish(error, result) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data: { error, result } }) =>
      finish(result ? null : new Error(error || "生成に失敗しました。"), result);
    worker.onerror = () => finish(new Error("生成処理を起動できませんでした。"));
    worker.postMessage(payload);
  });
}

async function start() {
  const [THREE, { SparkRenderer, SplatMesh }, { OrbitControls }] = await Promise.all([
    import("three"), import("@sparkjsdev/spark"), import("three/addons/controls/OrbitControls.js"),
  ]);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0x11151b);
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const viewDirection = new THREE.Vector3(1.7, 1.3, 2.3).normalize();

  let result, model, pointCloud, bounds, job;
  let showPoints = false;
  let outputName = "sdf-surface";

  function resize() {
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frameModel() {
    const { center, radius } = bounds;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = 1.10 * radius / Math.sin(Math.min(vertical, horizontal));
    controls.enableDamping = false;
    controls.update();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(viewDirection, distance);
    controls.update();
    controls.enableDamping = true;
  }

  function createPointCloud({ data, count }) {
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const rgb = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const offset = i * STRIDE;
      positions.set(data.subarray(offset, offset + 3), i * 3);
      rgb.setRGB(data[offset + 10], data[offset + 11], data[offset + 12], THREE.SRGBColorSpace);
      rgb.toArray(colors, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      vertexColors: true, size: 2, sizeAttenuation: false,
    }));
  }

  function disposePointCloud() {
    if (!pointCloud) return;
    pointCloud.removeFromParent();
    pointCloud.geometry.dispose();
    pointCloud.material.dispose();
    pointCloud = undefined;
  }

  function updateDisplayMode() {
    if (showPoints && !pointCloud) {
      pointCloud = createPointCloud(result);
      scene.add(pointCloud);
    }
    model.visible = spark.visible = !showPoints;
    if (pointCloud) pointCloud.visible = showPoints;
    pointsButton.setAttribute("aria-pressed", String(showPoints));
  }

  async function display(next) {
    const { data, count, min, max } = next;
    const nextModel = new SplatMesh({
      maxSplats: count,
      constructSplats(splats) {
        const center = new THREE.Vector3(), scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion(), color = new THREE.Color();
        for (let i = 0; i < data.length; i += STRIDE) {
          center.fromArray(data, i);
          rotation.fromArray(data, i + 6);
          scale.fromArray(data, i + 14);
          color.setRGB(data[i + 10], data[i + 11], data[i + 12]);
          splats.pushSplat(center, scale, rotation, data[i + 13], color);
        }
      },
    });
    try {
      await nextModel.initialized;
      if (nextModel.numSplats !== count) throw new Error("Spark に全スプラットを転送できませんでした。");
    } catch (error) {
      nextModel.dispose();
      throw error;
    }
    const first = !model;
    if (model) {
      model.removeFromParent();
      model.dispose();
    }
    disposePointCloud();
    model = nextModel;
    result = next;
    const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    bounds = box.getBoundingSphere(new THREE.Sphere());
    scene.add(model);
    updateDisplayMode();
    if (first) frameModel();
    pointsButton.disabled = reset.disabled = download.disabled = false;
  }

  async function regenerate() {
    if (job) return;
    const options = Object.fromEntries(["resolution", "extent", "size", "thickness", "density", "hairLength", "hairWidth",
      "disorder", "variation", "clump", "clumpSize", "seed"].map(
      id => [id, byId(id).valueAsNumber],
    ));
    options.color = byId("color").value;
    options.effect = byId("effect").value;
    options.base = byId("base").checked;
    const name = preset.value ? `sdf-${preset.value}` : "sdf-surface";
    job = new AbortController();
    generate.disabled = true;
    cancel.hidden = false;
    showStatus("表面をサンプリング中…");
    try {
      const next = await sampleInWorker({ source: source.value, options }, job.signal);
      cancel.hidden = true;
      showStatus("Spark プレビューを準備中…");
      await display(next);
      outputName = name;
      const stats = `${countFormat.format(next.count)} スプラット${options.effect === "none" ? "" : ` / ${countFormat.format(next.hairCount)} 本・房`} · 生成 ${Math.round(next.elapsed)} ms`;
      showStatus(next.clipped ? `${stats}。形状が境界に達しています。探索範囲を広げてください。` : stats,
        next.clipped ? "warning" : "");
    } catch (error) {
      const previous = result ? " 前回の結果を表示しています。" : "";
      if (error.name === "AbortError") showStatus(`生成を中止しました。${previous}`);
      else showStatus(`生成できませんでした：${error.message}。${previous}`, "error");
    } finally {
      job = undefined;
      generate.disabled = false;
      cancel.hidden = true;
    }
  }

  form.addEventListener("submit", event => { event.preventDefault(); void regenerate(); });
  cancel.addEventListener("click", () => job?.abort());
  reset.addEventListener("click", frameModel);
  pointsButton.addEventListener("click", () => { showPoints = !showPoints; updateDisplayMode(); });
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([encodePly(result)], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${outputName}.ply`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  new ResizeObserver(resize).observe(viewport);
  resize();
  const render = () => {
    controls.update();
    renderer.render(scene, camera);
  };
  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== location.origin ||
        event.data?.type !== "splat-studio-visibility") return;
    resize();
    renderer.setAnimationLoop(event.data.active ? render : null);
  });
  renderer.setAnimationLoop(window.frameElement?.parentElement.hidden ? null : render);
  await regenerate();
}

start().catch(error => {
  console.error(error);
  showStatus("起動できませんでした。WebGL 2 とインターネット接続を確認してください。", "error");
});
