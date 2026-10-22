(async () => {
  const report = (tag, value) =>
    fetch("/report/" + tag, {
      method: "POST",
      body: JSON.stringify(value),
    });
  try {
    if (location.pathname.startsWith("/popup/")) {
      // Observe isolation in the destination's first script, before the adapter.
      await report("popup", {
        path: location.pathname,
        openerIsNull: window.opener === null,
        rootStyle: document.documentElement.style.backgroundColor,
      });
      await window.__TAURI__.window.getCurrentWindow().close();
      return;
    }
    if (document.readyState === "loading") {
      await new Promise((resolve) =>
        addEventListener("DOMContentLoaded", resolve, { once: true }),
      );
    }
    const originalUrl = location.href;
    window.open("/popup/direct", "_blank", "noopener,noreferrer");
    window.open("/popup/loading", "_blank", "noopener,noreferrer");
    const anchor = document.createElement("a");
    anchor.href = "/popup/implicit";
    anchor.target = "_blank";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    await report("main", {
      originalUrl,
      currentUrl: location.href,
      config: window.pakeConfig,
    });
    while (!(await (await fetch("/finish", { cache: "no-store" })).json())) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await window.__TAURI__.window.getCurrentWindow().close();
  } catch (error) {
    await report("error", String(error));
  }
})();
