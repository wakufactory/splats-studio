const header = document.querySelector('.app-header');
let headersHidden = false;

if (header) {
  const controls = document.createElement('div');
  controls.className = 'display-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '画面表示');
  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.id = 'fullscreen-toggle';
  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.id = 'header-toggle';
  const notice = document.createElement('p');
  notice.className = 'display-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  controls.append(fullscreenButton, headerButton, notice);
  header.append(controls);

  const root = document.documentElement;
  const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
  const nativeSupported = Boolean(requestFullscreen && exitFullscreen &&
    (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true));
  let expanded = false;
  let previousHidden = false;
  let pending = false;
  const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

  function setIcon(button, pathData) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
    button.replaceChildren(svg);
  }
  function update() {
    const active = isFullscreen() || expanded;
    document.body.classList.toggle('fullscreen-mode', active);
    setIcon(fullscreenButton, active ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
    fullscreenButton.title = active ? '拡大を終了' : nativeSupported ? '全画面表示' : 'ヘッダーを隠して画面を広く表示';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    setIcon(headerButton, headersHidden ? 'M4 4h16v16H4zM4 9h16m-12 4 4 4 4-4' : 'M4 4h16v16H4zM4 9h16m-12 8 4-4 4 4');
    headerButton.title = headersHidden ? 'ヘッダーを表示' : 'ヘッダーを隠す';
    headerButton.setAttribute('aria-label', headerButton.title);
    headerButton.setAttribute('aria-pressed', String(headersHidden));
  }
  function hideHeaders(hidden, focus = false) {
    // Keep both controls reachable after hiding their original header.
    (hidden ? document.body : header).append(controls);
    headersHidden = hidden;
    document.body.classList.toggle('headers-hidden', hidden);
    window.dispatchEvent(new Event('resize'));
    update();
    if (focus) headerButton.focus({ preventScroll: true });
  }
  headerButton.addEventListener('click', () => hideHeaders(!headersHidden, true));
  fullscreenButton.addEventListener('click', async () => {
    if (pending) return;
    notice.hidden = true;
    if (!nativeSupported) {
      if (!expanded) previousHidden = headersHidden;
      expanded = !expanded;
      hideHeaders(expanded || previousHidden, true);
      return;
    }
    pending = true;
    try {
      if (isFullscreen()) await exitFullscreen.call(document);
      else {
        previousHidden = headersHidden;
        await requestFullscreen.call(root);
      }
    } catch {
      notice.textContent = '全画面に切り替えられませんでした。「ヘッダーを隠す」で表示を広げられます。';
      notice.hidden = false;
    } finally {
      pending = false;
      update();
    }
  });
  function fullscreenChanged() {
    hideHeaders(isFullscreen() || previousHidden, true);
  }
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('webkitfullscreenchange', fullscreenChanged);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !isFullscreen()) {
      expanded = false;
      notice.hidden = true;
      hideHeaders(false, true);
    }
  });
  update();
}
