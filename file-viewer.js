const viewer = document.querySelector("#file-viewer");
const viewport = document.querySelector("#viewport");
const fileInput = document.querySelector("#file");
const openButton = document.querySelector("#open");
const pointsButton = document.querySelector("#points");
const resetButton = document.querySelector("#reset");
const empty = document.querySelector("#empty");
const dropOverlay = document.querySelector("#drop-overlay");
const status = document.querySelector("#status");
const countFormat = new Intl.NumberFormat("ja-JP");

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.kind = error ? "error" : "";
}

async function start() {
  const [THREE, { SparkRenderer, SplatMesh }, { OrbitControls }] = await Promise.all([
    import("three"), import("@sparkjsdev/spark"), import("three/addons/controls/OrbitControls.js"),
  ]);
  const renderer = new THREE.WebGLRenderer();
  renderer.setClearColor(0x11151b);
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let model, pointCloud, bounds;
  let showPoints = false, loading = false, dragDepth = 0;

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
    const positions = new Float32Array(splats.numSplats * 3);
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
  }

  async function load(file) {
    if (!file || loading) return;
    if (!/\.(ply|splat|ksplat|spz|sog|zip|rad)$/i.test(file.name)) {
      showStatus(`対応していない形式です · ${file.name}`, true);
      return;
    }
    loading = true;
    openButton.disabled = true;
    showStatus(`読み込み中… ${file.name}`);
    let nextModel, nextPointCloud;
    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      nextModel = new SplatMesh({ fileBytes, fileName: file.name });
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
      if (model) {
        model.removeFromParent();
        model.dispose();
      }
      model = nextModel;
      pointCloud = nextPointCloud;
      bounds = sphere;
      scene.add(model);
      if (pointCloud) scene.add(pointCloud);
      updateDisplayMode();
      frameModel();
      empty.hidden = true;
      pointsButton.disabled = resetButton.disabled = false;
      showStatus(`${file.name} · ${countFormat.format(model.numSplats)} splats`);
    } catch (error) {
      nextModel?.dispose();
      nextPointCloud?.geometry.dispose();
      nextPointCloud?.material.dispose();
      console.error(error);
      showStatus(`読み込めませんでした · ${file.name}`, true);
    } finally {
      loading = false;
      openButton.disabled = false;
    }
  }

  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    void load(file);
  });
  resetButton.addEventListener("click", frameModel);
  pointsButton.addEventListener("click", () => {
    if (!showPoints && !pointCloud) {
      try {
        pointCloud = createPointCloud(model);
        scene.add(pointCloud);
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
  openButton.disabled = false;
  showStatus("ファイルを選択してください。");
}

start().catch(error => {
  console.error(error);
  showStatus("起動できませんでした。WebGL 2 とインターネット接続を確認してください。", true);
});
