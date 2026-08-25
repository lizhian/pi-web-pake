window.addEventListener("DOMContentLoaded", () => {
  const dragRegionHeight = Number(window["pakeConfig"]?.drag_region_height);
  if (!Number.isFinite(dragRegionHeight) || dragRegionHeight < 0) return;

  const style = document.createElement("style");
  style.textContent = `#pake-top-dom { height: ${dragRegionHeight}px !important; }`;
  document.head.appendChild(style);
});
