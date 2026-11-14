import { mountChat } from "./chat.js";
import { readSettings, applySettings, parseProject, serializeProject, projectFilename } from "./generator-project.mjs";
import { scenePresets as presets } from "./scene-presets.mjs";
import { encodePly, STRIDE } from "./sdf.mjs";
import { disposeSplatMesh } from "./splat-resources.mjs";
import { RenderWatchdog } from "./render-watchdog.mjs";

const byId = id => document.getElementById(id);
const form = byId("generator"), viewport = byId("viewport"), preset = byId("preset");
const source = byId("source"), generate = byId("generate"), cancel = byId("cancel");
const download = byId("download"), pointsButton = byId("points"), reset = byId("reset");
const status = byId("status"), countFormat = new Intl.NumberFormat("ja-JP");
const downloadSog = byId("download-sog"), sogStatus = byId("sog-status");
const downloadName = byId("download-name");

function saveBytes(bytes, filename, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function showStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

for (const [id, { name }] of Object.entries(presets)) preset.add(new Option(name, id));
const draftStorageKey = "sdf-splat-studio:draft-source";
source.value = presets.torus.source;
try {
  source.value = localStorage.getItem(draftStorageKey) ?? source.value;
} catch (error) {
  console.warn("DSL draft could not be restored:", error);
}
function updatePreset() {
  preset.value = Object.keys(presets).find(id => presets[id].source === source.value) ?? "";
}
updatePreset();
const editor = globalThis.SplatSourceEditor?.mount(source, () => {
  if (!generate.disabled) form.requestSubmit();
});
function setSource(value) {
  if (editor) editor.setValue(value);
  else { source.value = value; source.dispatchEvent(new Event("input", { bubbles: true })); }
}
preset.addEventListener("change", () => { if (presets[preset.value]) setSource(presets[preset.value].source); });
source.addEventListener("input", () => {
  updatePreset();
  try {
    localStorage.setItem(draftStorageKey, source.value);
  } catch (error) {
    console.warn("DSL draft could not be saved:", error);
  }
});

function updateRangeOutputs() {
  for (const input of form.querySelectorAll('input[type="range"]')) {
    form.querySelector(`output[for="${input.id}"]`).value = input.value;
  }
}
form.addEventListener("input", updateRangeOutputs);
updateRangeOutputs();

// The textarea remains usable if the editor bundle is unavailable.
source.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!generate.disabled) form.requestSubmit();
  } else if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end");
    source.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

const projectFile = byId("project-file"), loadProject = byId("load-project");
const projectStatus = byId("project-status");
function showProjectStatus(message, kind = "") {
  projectStatus.textContent = message;
  projectStatus.dataset.kind = kind;
}
loadProject.addEventListener("click", () => projectFile.click());
projectFile.addEventListener("change", async () => {
  const file = projectFile.files[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("JSON は2 MB以内にしてください。");
    const project = parseProject(await file.text());
    // Validate the entire document before changing any editor or control.
    applySettings(project.defaults, byId);
    setSource(project.source);
    downloadName.value = project.name || file.name.replace(/\.json$/i, "");
    updateRangeOutputs();
    showProjectStatus(`${file.name} を読み込みました。`);
    form.requestSubmit();
  } catch (error) {
    showProjectStatus(`読み込めませんでした：${error.message}`, "error");
  } finally {
    projectFile.value = "";
  }
});
byId("save-project").addEventListener("click", () => {
  try {
    if (!form.reportValidity()) return;
    const name = downloadName.value.trim();
    const json = serializeProject(source.value, readSettings(byId), name);
    const filename = projectFilename(name, preset.value ? `sdf-${preset.value}` : "sdf-scene");
    saveBytes(json, filename, "application/json;charset=utf-8");
    showProjectStatus(`${filename} を保存しました。`);
  } catch (error) {
    showProjectStatus(`保存できませんでした：${error.message}`, "error");
  }
});

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
    worker.onmessage = ({ data: { error, result, progress } }) => {
      if (progress) {
        showStatus(`object ${progress.name} を生成中… (${progress.index + 1}/${progress.total})`);
        return;
      }
      finish(result ? null : new Error(error || "生成に失敗しました。"), result);
    };
    worker.onerror = () => finish(new Error("生成処理を起動できませんでした。"));
    worker.postMessage(payload);
  });
}

async function start() {
  const [THREE, { SparkRenderer, SplatMesh, SplatAccumulator }, { OrbitControls }] = await Promise.all([
    import("three"), import("@sparkjsdev/spark"), import("three/addons/controls/OrbitControls.js"),
  ]);

  // Gaussian edges already fade smoothly; MSAA adds fill/blend cost for long fur.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setClearColor(0x11151b);
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.2;
  const viewDirection = new THREE.Vector3(1.7, 1.3, 2.3).normalize();

  let result, model, pointCloud, bounds, job;
  let showPoints = false;
  let outputName = "sdf-surface";
  let sogWorker, sogReady = false, sogBusy = false, sogTimeout;
  let sogFilename;
  const renderWatchdog = new RenderWatchdog();
  const renderNotice = byId("render-notice");

  function exportFilename(extension) {
    return projectFilename(downloadName.value, outputName, extension);
  }

  function updateSogButton() {
    downloadSog.disabled = !sogReady || !result || sogBusy || Boolean(job);
  }

  function disableSog(message) {
    clearTimeout(sogTimeout);
    sogWorker?.terminate();
    sogWorker = undefined;
    sogReady = sogBusy = false;
    downloadSog.textContent = "SOG を保存";
    sogStatus.textContent = message;
    downloadSog.title = message;
    generate.disabled = Boolean(job);
    updateSogButton();
  }

  function prepareSog() {
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      disableSog("SOG 保存はこの環境では利用できません（Worker / WebAssembly が必要です）。");
      return;
    }
    try {
      sogWorker = new Worker(new URL("./sog-worker.mjs", import.meta.url), { type: "module" });
      sogTimeout = setTimeout(() => disableSog("SOG 保存の準備がタイムアウトしました。再読み込みで再試行できます。"), 60_000);
      sogWorker.onerror = event => {
        event.preventDefault();
        disableSog("SOG 保存を利用できません。ブラウザーの対応状況と CDN 接続を確認してください。");
      };
      sogWorker.onmessage = ({ data }) => {
        clearTimeout(sogTimeout);
        if (data.type === "unavailable") {
          console.warn("SOG initialization failed:", data.message);
          disableSog("SOG 保存を利用できません。ブラウザーの対応状況と CDN 接続を確認してください。");
          return;
        }
        if (data.type === "ready") {
          sogReady = true;
          sogStatus.textContent = "SOG：ブラウザー内で圧縮保存（非可逆）";
        } else {
          sogBusy = false;
          generate.disabled = Boolean(job);
          downloadSog.textContent = "SOG を保存";
          if (data.type === "result") {
            saveBytes(data.bytes, sogFilename);
            sogStatus.textContent = `SOG を保存しました（${(data.bytes.byteLength / 1024 / 1024).toFixed(2)} MB）。`;
          } else {
            console.warn("SOG export failed:", data.message);
            disableSog("SOG 変換に失敗しました。再読み込みで再試行できます。PLY 保存は利用できます。");
            return;
          }
        }
        updateSogButton();
      };
    } catch {
      disableSog("SOG 保存用 Worker を起動できませんでした。");
    }
  }

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
      disposeSplatMesh(nextModel, SplatAccumulator);
      throw error;
    }
    const first = !model;
    disposeSplatMesh(model, SplatAccumulator);
    disposePointCloud();
    model = nextModel;
    result = next;
    const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    bounds = box.getBoundingSphere(new THREE.Sphere());
    scene.add(model);
    updateDisplayMode();
    if (first) frameModel();
    pointsButton.disabled = reset.disabled = download.disabled = false;
    updateSogButton();
  }

  let previewFailure = null;
  async function regenerate() {
    if (job || sogBusy) return "生成・保存処理の完了後に再生成してください。";
    const options = readSettings(byId);
    const requestSource = source.value;
    previewFailure = null;
    const name = preset.value ? `sdf-${preset.value}` : "sdf-surface";
    job = new AbortController();
    loadProject.disabled = projectFile.disabled = true;
    updateSogButton();
    generate.disabled = true;
    cancel.hidden = false;
    showStatus("表面をサンプリング中…");
    try {
      const next = await sampleInWorker({ source: requestSource, options }, job.signal);
      cancel.hidden = true;
      showStatus("Spark プレビューを準備中…");
      await display(next);
      renderWatchdog.reset();
      renderNotice.hidden = true;
      updateRenderLoop();
      outputName = name;
      downloadName.placeholder = outputName;
      const stats = `${next.objects.length} object · ${countFormat.format(next.count)} スプラット${next.hairCount ? ` / ${countFormat.format(next.hairCount)} 本・房` : ""} · 生成 ${Math.round(next.elapsed)} ms`;
      showStatus(next.clipped ? `${stats}。${next.objects.filter(object => object.clipped).map(object => object.name).join(", ")} が境界に達しています。探索範囲を広げてください。` : stats,
        next.clipped ? "warning" : "");
    } catch (error) {
      previewFailure = {source: requestSource, parameters: options, error: error.message};
      const previous = result ? (renderWatchdog.stopped
        ? " 前回の結果は保持しています。描画は停止中です。" : " 前回の結果を表示しています。") : "";
      if (error.name === "AbortError") showStatus(`生成を中止しました。${previous}`);
      else showStatus(`生成できませんでした：${error.message.replace(/[。.]$/, "")}。${previous}`, "error");
    } finally {
      job = undefined;
      loadProject.disabled = projectFile.disabled = false;
      generate.disabled = false;
      cancel.hidden = true;
      updateSogButton();
    }
    return previewFailure?.error ?? null;
  }

  mountChat({
    snapshot: () => ({source: source.value, mode: "text", parameters: readSettings(byId)}),
    setSource,
    canApply: () => !job && !sogBusy,
    preview: regenerate,
    error: () => previewFailure?.source === source.value &&
      JSON.stringify(previewFailure.parameters) === JSON.stringify(readSettings(byId)) ? previewFailure.error : null,
  });

  form.addEventListener("submit", event => { event.preventDefault(); void regenerate(); });
  cancel.addEventListener("click", () => job?.abort());
  reset.addEventListener("click", frameModel);
  pointsButton.addEventListener("click", () => { showPoints = !showPoints; updateDisplayMode(); });
  download.addEventListener("click", () => {
    saveBytes(encodePly(result), exportFilename("ply"));
  });
  downloadSog.addEventListener("click", () => {
    if (downloadSog.disabled) return;
    sogBusy = true;
    sogFilename = exportFilename("sog");
    generate.disabled = true;
    downloadSog.textContent = "SOG 変換中…";
    sogStatus.textContent = "ブラウザー内で SOG に圧縮中…";
    updateSogButton();
    sogTimeout = setTimeout(() => disableSog("SOG 変換がタイムアウトしました。再読み込みで再試行できます。"), 120_000);
    try {
      // Transfer a copy so preview and PLY export retain the original data.
      const data = result.data.slice();
      sogWorker.postMessage({ data, count: result.count }, [data.buffer]);
    } catch (error) {
      console.warn("SOG export failed:", error);
      disableSog("SOG 変換を開始できませんでした。PLY 保存は利用できます。");
    }
  });
  new ResizeObserver(resize).observe(viewport);
  resize();
  const render = () => {
    const start = performance.now();
    controls.update();
    renderer.render(scene, camera);
    if (job) {
      // Generation and preview setup can block the main thread independently.
      renderWatchdog.resetTiming();
    } else if (renderWatchdog.sample(start, performance.now())) {
      renderNotice.hidden = false;
      updateRenderLoop();
    }
  };
  function updateRenderLoop() {
    renderWatchdog.resetTiming();
    renderer.setAnimationLoop(!document.hidden && !renderWatchdog.stopped ? render : null);
  }
  document.addEventListener("visibilitychange", updateRenderLoop);
  updateRenderLoop();
  prepareSog();
  await regenerate();
}

start().catch(error => {
  console.error(error);
  showStatus("起動できませんでした。WebGL 2 とインターネット接続を確認してください。", "error");
});
