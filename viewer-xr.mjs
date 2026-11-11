import { XRPinchGestures } from "./xr-gestures.mjs";

// Keep tracked cameras at meter scale; normalize only the splat/point content.
export function setupXR({ THREE, renderer, scene, content, camera, controls,
  getBounds, isLoading, resize, showStatus }) {
  const byId = id => document.getElementById(id);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  const placement = new THREE.Group();
  scene.add(placement);
  placement.add(content);
  const gestures = new XRPinchGestures();
  const direction = new THREE.Vector3(), axis = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.065, 0.085, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xc8ffc9, side: THREE.DoubleSide }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  const support = { ar: false, vr: false };
  let active = false, mode, saved, session, hitSource, pendingPlacement = false;
  let halfHeight = 0;

  function updateButtons() {
    for (const type of ["ar", "vr"]) {
      const button = byId(type);
      button.disabled = active || isLoading() || !support[type] || !getBounds();
      button.title = !isSecureContext ? "AR/VRにはHTTPSまたはlocalhostが必要です"
        : !support[type] ? `この環境はWebXR ${type.toUpperCase()}に非対応です`
        : !getBounds() ? "Splatファイルを開いてください" : `${type.toUpperCase()}で表示（最大辺 約1m）`;
    }
  }
  async function detect() {
    if (isSecureContext && navigator.xr) {
      await Promise.all(["ar", "vr"].map(async type => {
        try { support[type] = await navigator.xr.isSessionSupported(`immersive-${type}`); }
        catch { /* Unsupported or disallowed by permissions policy. */ }
      }));
    }
    updateButtons();
  }

  function restore() {
    hitSource?.cancel();
    hitSource = null;
    session = null;
    mode = null;
    active = pendingPlacement = reticle.visible = false;
    gestures.reset();
    document.body.classList.remove("xr");
    byId("exit-xr").hidden = true;
    placement.position.set(0, 0, 0);
    placement.quaternion.identity();
    placement.scale.setScalar(1);
    content.position.set(0, 0, 0);
    content.scale.setScalar(1);
    if (saved) {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.near = saved.near;
      camera.far = saved.far;
      controls.target.copy(saved.target);
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
      saved = null;
    }
    controls.enabled = true;
    controls.update();
    for (const id of ["open", "reset", "stereo-mode"]) byId(id).disabled = false;
    resize();
    updateButtons();
  }

  async function start(type) {
    if (active || isLoading() || !support[type] || !getBounds()) return;
    active = true;
    updateButtons();
    for (const id of ["open", "reset", "stereo-mode"]) byId(id).disabled = true;
    let requested;
    try {
      requested = await navigator.xr.requestSession(`immersive-${type}`, {
        optionalFeatures: type === "ar" ? ["local-floor", "hit-test", "dom-overlay"] : ["local-floor", "hand-tracking"],
        ...(type === "ar" ? { domOverlay: { root: document.body } } : {}),
      });
      session = requested;
      saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(),
        target: controls.target.clone(), near: camera.near, far: camera.far,
        clearColor: renderer.getClearColor(new THREE.Color()).clone(), clearAlpha: renderer.getClearAlpha() };
      mode = type;
      gestures.reset();
      controls.enabled = false;
      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      camera.near = 0.01;
      camera.far = 1000;
      camera.updateProjectionMatrix();
      const box = getBounds();
      const scale = 1 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
      halfHeight = box.getSize(new THREE.Vector3()).y * scale / 2;
      content.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
      content.scale.setScalar(scale);
      renderer.setClearColor(0x11151b, type === "ar" ? 0 : 1);
      renderer.setScissorTest(false);
      pendingPlacement = true;
      document.body.classList.add("xr");
      byId("exit-xr").hidden = false;
      requested.addEventListener("visibilitychange", () => gestures.reset());
      requested.addEventListener("select", () => {
        if (mode === "ar" && reticle.visible) {
          placement.position.setFromMatrixPosition(reticle.matrix);
          placement.position.y += halfHeight;
          placement.quaternion.identity();
          pendingPlacement = false;
        }
      });
      // Restore after WebXRManager has restored its framebuffer and canvas size.
      await renderer.xr.setSession(requested);
      if (session !== requested) return;
      renderer.xr.getReferenceSpace()?.addEventListener("reset", () => gestures.reset());
      showStatus(type === "ar" ? "面に向けてタップで配置。面が見つからない場合は前方に表示します。"
        : "片手のピンチ移動で回転 · 両手のピンチで拡縮");
      if (type === "ar" && requested.requestHitTestSource) {
        try {
          const space = await requested.requestReferenceSpace("viewer");
          const source = await requested.requestHitTestSource({ space });
          if (session === requested) hitSource = source;
          else source?.cancel();
        } catch { /* Front placement works without hit testing. */ }
      }
    } catch (error) {
      if (requested) await requested.end().catch(() => {});
      if (active) restore();
      showStatus(`XRを開始できませんでした。${error.message}`, true);
    }
  }
  renderer.xr.addEventListener("sessionend", () => {
    if (active) { restore(); showStatus("XRを終了しました。"); }
  });
  byId("ar").addEventListener("click", () => void start("ar"));
  byId("vr").addEventListener("click", () => void start("vr"));
  byId("exit-xr").addEventListener("click", () => {
    session?.end().catch(error => showStatus(error.message, true));
  });
  byId("exit-xr").addEventListener("beforexrselect", event => event.preventDefault());
  void detect();

  function update(frame) {
    if (!frame) return;
    const reference = renderer.xr.getReferenceSpace();
    if (!reference) return;
    const pose = frame.getViewerPose(reference);
    if (pendingPlacement && pose) {
      const p = pose.transform.position, q = pose.transform.orientation;
      rotation.set(q.x, q.y, q.z, q.w);
      direction.set(0, 0, -1).applyQuaternion(rotation);
      direction.y = 0;
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
      direction.normalize();
      placement.position.set(p.x + direction.x * 1.7, p.y - 0.25, p.z + direction.z * 1.7);
      pendingPlacement = false;
    }
    if (mode === "vr") {
      const gesture = gestures.update(frame, reference, pose?.transform.orientation);
      if (gesture?.type === "rotate") {
        axis.copy(gesture.up);
        rotation.setFromAxisAngle(axis, gesture.yaw);
        placement.quaternion.premultiply(rotation);
        axis.copy(gesture.right);
        rotation.setFromAxisAngle(axis, gesture.pitch);
        placement.quaternion.premultiply(rotation).normalize();
      } else if (gesture?.type === "zoom") {
        placement.scale.setScalar(THREE.MathUtils.clamp(placement.scale.x * gesture.factor, 0.1, 5));
      }
    }
    reticle.visible = false;
    if (mode === "ar" && hitSource) {
      const hit = frame.getHitTestResults(hitSource)[0]?.getPose(reference);
      if (hit) { reticle.matrix.fromArray(hit.transform.matrix); reticle.visible = true; }
    }
  }
  return { get active() { return active; }, update, updateButtons };
}
