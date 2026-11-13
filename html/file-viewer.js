import { disposeSplatMesh } from "./splat-resources.mjs";
import { setupXR } from "./viewer-xr.mjs";

const viewer = document.querySelector("#file-viewer");
const viewport = document.querySelector("#viewport");
const fileInput = document.querySelector("#file");
const openButton = document.querySelector("#open");
const pointsButton = document.querySelector("#points");
const resetButton = document.querySelector("#reset");
const stereoMode = document.querySelector("#stereo-mode");
const stereoStrength = document.querySelector("#stereo-strength");
const stereoHelp = document.querySelector("#stereo-help");
const lodEnabled = document.querySelector("#lod-enabled");
const lodCount = document.querySelector("#lod-count");
const lodScale = document.querySelector("#lod-scale");
const lodScaleValue = document.querySelector("#lod-scale-value");
const toolbar = document.querySelector(".toolbar");
const empty = document.querySelector("#empty");
const dropOverlay = document.querySelector("#drop-overlay");
const status = document.querySelector("#status");
const filename = document.querySelector("#filename");
const splatCount = document.querySelector("#splat-count");
const countFormat = new Intl.NumberFormat("ja-JP");
const lodButton = document.querySelector("#lod-controls");
const lodPanel = document.querySelector("#lod-panel");
function setLodPanelOpen(open) {
  lodPanel.hidden = !open;
  lodButton.setAttribute("aria-expanded", String(open));
}
lodButton.addEventListener("click", () => setLodPanelOpen(lodPanel.hidden));
document.querySelector("#lod-close").addEventListener("click", () => {
  setLodPanelOpen(false);
  lodButton.focus({ preventScroll: true });
});
lodPanel.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    setLodPanelOpen(false);
    lodButton.focus({ preventScroll: true });
    event.stopPropagation();
  }
});

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.kind = error ? "error" : "";
}

async function start() {
  const [THREE, { SparkRenderer, SplatMesh, SplatAccumulator }, { OrbitControls }] = await Promise.all([
    import("three"), import("@sparkjsdev/spark"), import("three/addons/controls/OrbitControls.js"),
  ]);
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setClearColor(0x11151b);
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const content = new THREE.Group();
  scene.add(content);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.2;
  const stereo = new THREE.StereoCamera();
  stereo.aspect = 0.5;

  let model, pointCloud, bounds, modelBox;
  let showPoints = false, loading = false, dragDepth = 0;
  let lastCountUpdate = -Infinity;
  function updateSplatCount(time) {
    if (!model || time - lastCountUpdate < 250) return;
    lastCountUpdate = time;
    const total = model.splats.getNumSplats();
    const selected = showPoints ? total : model.numSplats;
    const text = `${showPoints ? "表示中の点" : "表示中"} ${countFormat.format(selected)} / 元データ ${countFormat.format(total)}`;
    if (splatCount.textContent !== text) splatCount.textContent = text;
    splatCount.hidden = false;
  }
  function updateLod() {
    spark.enableLod = lodEnabled.checked;
    spark.lodSplatCount = lodCount.value === "" ? undefined : Number(lodCount.value);
    spark.lodSplatScale = Number(lodScale.value);
    // Explicitly select the retained originals when LoD is disabled.
    if (model) model.enableLod = lodEnabled.checked;
    lodScaleValue.value = `${Number(lodScale.value).toFixed(2)}×`;
    lodEnabled.disabled = showPoints;
    lodCount.disabled = lodScale.disabled = showPoints || !lodEnabled.checked;
  }
  lodEnabled.addEventListener("change", updateLod);
  lodCount.addEventListener("change", updateLod);
  lodScale.addEventListener("input", updateLod);
  updateLod();
  const xr = setupXR({ THREE, renderer, scene, content, camera, controls,
    getBounds: () => modelBox, isLoading: () => loading, resize, showStatus });

  function resize() {
    if (renderer.xr.isPresenting) return;
    const toolbarBottom = toolbar.getClientRects().length ? toolbar.offsetTop + toolbar.offsetHeight + 12 : 0;
    document.body.style.setProperty("--stereo-toolbar-height", `${toolbarBottom}px`);
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frameModel() {
    if (xr.active || !bounds) return;
    const { center, radius } = bounds;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect * (stereoMode.value === "mono" ? 1 : 0.5));
    const distance = 1.15 * radius / Math.sin(Math.min(vertical, horizontal));
    controls.enableDamping = false;
    controls.update();
    controls.target.copy(center);
    controls.minDistance = radius * 0.001;
    controls.maxDistance = distance * 50;
    camera.near = radius * 0.0001;
    camera.far = controls.maxDistance * 2;
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    controls.update();
    controls.enableDamping = true;
  }

  function createPointCloud(splats) {
    // numSplats becomes the current LoD selection count after rendering.
    const positions = new Float32Array(splats.splats.getNumSplats() * 3);
    const colors = new Float32Array(positions.length);
    const rgb = new THREE.Color();
    splats.forEachSplat((index, center, _scales, _rotation, _opacity, color) => {
      center.toArray(positions, index * 3);
      rgb.copy(color).convertSRGBToLinear().toArray(colors, index * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      vertexColors: true, size: 2, sizeAttenuation: false,
    }));
    points.matrixAutoUpdate = false;
    points.matrix.copy(splats.matrix);
    return points;
  }

  function updateDisplayMode() {
    model.visible = spark.visible = !showPoints;
    if (pointCloud) pointCloud.visible = showPoints;
    pointsButton.setAttribute("aria-pressed", String(showPoints));
    updateLod();
  }

  async function load(file) {
    if (!file || loading || xr.active) return;
    if (!/\.(ply|splat|ksplat|spz|sog|zip|rad)$/i.test(file.name)) {
      showStatus(`対応していない形式です · ${file.name}`, true);
      return;
    }
    loading = true;
    openButton.disabled = true;
    xr.updateButtons();
    showStatus(`読み込み・LoD データ作成中… ${file.name}`);
    let nextModel, nextPointCloud;
    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      nextModel = new SplatMesh({ fileBytes, fileName: file.name, lod: true, nonLod: true });
      await nextModel.initialized;
      if (!nextModel.numSplats) throw new Error("スプラットがありません。");

      // Our generated PLY uses Y-up. Other non-SPZ files retain the viewer's original axis conversion.
      const generatedPly = /\.ply$/i.test(file.name) && new TextDecoder().decode(
        fileBytes.subarray(0, 1024),
      ).includes("comment SDF Splat Studio - Y up");
      if (!/\.spz$/i.test(file.name) && !generatedPly) nextModel.quaternion.set(1, 0, 0, 0);
      const box = nextModel.getBoundingBox();
      if (box.getSize(new THREE.Vector3()).lengthSq() === 0) {
        box.copy(nextModel.getBoundingBox(false));
      }
      nextModel.updateMatrix();
      box.applyMatrix4(nextModel.matrix);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      if (!(sphere.radius > 0) || !Number.isFinite(sphere.radius) ||
          !sphere.center.toArray().every(Number.isFinite)) {
        throw new Error("形状の範囲が不正です。");
      }
      if (showPoints) nextPointCloud = createPointCloud(nextModel);
      if (pointCloud) {
        pointCloud.removeFromParent();
        pointCloud.geometry.dispose();
        pointCloud.material.dispose();
      }
      disposeSplatMesh(model, SplatAccumulator);
      model = nextModel;
      lastCountUpdate = -Infinity;
      pointCloud = nextPointCloud;
      bounds = sphere;
      modelBox = box;
      content.add(model);
      if (pointCloud) content.add(pointCloud);
      updateDisplayMode();
      frameModel();
      empty.hidden = true;
      pointsButton.disabled = resetButton.disabled = false;
      filename.textContent = filename.title = file.name;
      filename.hidden = false;
      showStatus(`${countFormat.format(model.numSplats)} splats`);
    } catch (error) {
      disposeSplatMesh(nextModel, SplatAccumulator);
      nextPointCloud?.geometry.dispose();
      nextPointCloud?.material.dispose();
      console.error(error);
      showStatus(`読み込めませんでした · ${file.name} · ${error.message}`, true);
    } finally {
      loading = false;
      openButton.disabled = false;
      xr.updateButtons();
    }
  }

  async function loadURL(source) {
    try {
      if (!source.trim()) throw new Error("urlにファイルのパスまたはURLを指定してください。");
      const url = new URL(source, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("HTTPまたはHTTPSのURLを指定してください。");
      }
      const name = decodeURIComponent(url.pathname.split("/").pop());
      await load({
        name,
        async arrayBuffer() {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        },
      });
    } catch (error) {
      showStatus(`URLを開けませんでした · ${error.message}`, true);
    }
  }

  resetButton.addEventListener("click", frameModel);
  stereoMode.addEventListener("change", () => {
    const active = stereoMode.value !== "mono";
    document.body.dataset.stereo = String(active);
    document.querySelector("#stereo-strength-control").hidden = !active;
    document.querySelector("#stereo-guide").hidden = !active;
    stereoHelp.hidden = !active;
    stereoHelp.textContent = stereoMode.value === "cross"
      ? "交差法：目を寄せて、2つの白い点を重ねます。"
      : "平行法：画面の奥を見て、2つの白い点を重ねます。";
    resize();
  });
  stereoStrength.addEventListener("input", () => {
    document.querySelector("#stereo-strength-value").value = Number(stereoStrength.value).toFixed(1);
  });
  pointsButton.addEventListener("click", () => {
    if (!showPoints && !pointCloud) {
      try {
        pointCloud = createPointCloud(model);
        content.add(pointCloud);
      } catch (error) {
        console.error(error);
        showStatus("点群を作成できませんでした。", true);
        return;
      }
    }
    showPoints = !showPoints;
    updateDisplayMode();
  });
  viewer.addEventListener("dragenter", event => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    dropOverlay.hidden = loading;
  });
  viewer.addEventListener("dragover", event => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = loading ? "none" : "copy";
  });
  viewer.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  viewer.addEventListener("drop", event => {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (event.dataTransfer.files.length > 1) {
      if (!loading) showStatus("ファイルは一度に1つ選択してください。", true);
      return;
    }
    void load(event.dataTransfer.files[0]);
  });

  new ResizeObserver(resize).observe(viewport);
  new ResizeObserver(resize).observe(toolbar);
  resize();
  const render = (_time, frame) => {
    if (renderer.xr.isPresenting) {
      xr.update(frame);
      renderer.render(scene, camera);
      updateSplatCount(_time);
      return;
    }
    controls.update();
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    if (stereoMode.value === "mono") {
      renderer.render(scene, camera);
      updateSplatCount(_time);
      return;
    }
    // Parallel camera axes and off-axis frusta avoid vertical disparity.
    // Orbit target is the zero-parallax plane; separation scales with model/view distance.
    camera.focus = Math.max(camera.near * 2, camera.position.distanceTo(controls.target));
    stereo.eyeSep = camera.focus * 0.035 * Number(stereoStrength.value);
    camera.updateMatrixWorld();
    stereo.update(camera);
    // Spark queries world transforms itself. StereoCamera only writes matrixWorld;
    // keep the local matrix in sync so those queries cannot reset an eye to the origin.
    for (const eye of [stereo.cameraL, stereo.cameraR]) {
      eye.matrix.copy(eye.matrixWorld);
      eye.matrix.decompose(eye.position, eye.quaternion, eye.scale);
      eye.near = camera.near;
      eye.far = camera.far;
      eye.fov = camera.fov;
      eye.aspect = camera.aspect * 0.5;
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
    }
    const eyes = stereoMode.value === "cross"
      ? [stereo.cameraR, stereo.cameraL] : [stereo.cameraL, stereo.cameraR];
    renderer.setScissorTest(true);
    for (let index = 0; index < 2; index++) {
      renderer.setViewport(index * width / 2, 0, width / 2, height);
      renderer.setScissor(index * width / 2, 0, width / 2, height);
      renderer.render(scene, eyes[index]);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    updateSplatCount(_time);
  };
  function updateRenderLoop() {
    renderer.setAnimationLoop(!document.hidden || xr.active ? render : null);
  }
  document.addEventListener("visibilitychange", updateRenderLoop);
  updateRenderLoop();
  openButton.disabled = false;
  stereoMode.disabled = false;
  showStatus("ファイルを選択してください。");
  const modelURL = new URLSearchParams(location.search).get("url");
  if (modelURL !== null) void loadURL(modelURL);
  return load;
}

// Open the native chooser synchronously, even while rendering dependencies load.
openButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  try {
    const load = await ready;
    await load(file);
  } catch {
    showStatus("起動できませんでした。WebGL 2 とインターネット接続を確認してください。", true);
  }
});

const ready = start();
ready.catch(error => {
  console.error(error);
  showStatus("起動できませんでした。WebGL 2 とインターネット接続を確認してください。", true);
});
