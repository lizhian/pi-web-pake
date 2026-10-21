(() => {
  function applyDragRegion() {
    const value = window.pakeConfig?.drag_region_height;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return;
    window.__PAKE_INJECT_STYLE__(
      `#pake-top-dom { height: ${value}px !important; }`,
      "pake-enhanced-drag-region",
    );
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", applyDragRegion, {
      once: true,
    });
  } else {
    applyDragRegion();
  }
})();
