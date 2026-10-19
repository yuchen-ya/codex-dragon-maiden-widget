// Native WinEvents own x/y. Only resize the Chromium viewport here; writing a
// cached getBounds() position races the native follower during drag/DPI changes.
function syncNativeViewport(host, window, screen, previousKey = '') {
  if (!host.nativeFollowing) return '';
  if (!host.visible || !host.bounds || !['width', 'height', 'x', 'y'].every(k => Number.isFinite(host.bounds[k]))) return previousKey;
  const current = window.getBounds();
  const scale = Number.isFinite(host.dpi) && host.dpi >= 96 ? host.dpi / 96 : screen.getDisplayMatching(current).scaleFactor;
  const width = Math.round(host.bounds.width / scale), height = Math.round(host.bounds.height / scale);
  const key = [host.window, width, height, scale].join(':');
  if (width > 10 && height > 10 && key !== previousKey) {
    if (width !== current.width || height !== current.height) window.setBounds({ width, height }, false);
    return key;
  }
  return previousKey;
}
module.exports = { syncNativeViewport };
