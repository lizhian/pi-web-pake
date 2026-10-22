(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  if (
    typeof invoke !== "function" ||
    window !== window.top ||
    typeof MutationObserver !== "function"
  )
    return;

  const installed = "data-pi-web-file-open-adapter";
  if (document.documentElement.hasAttribute(installed)) return;
  document.documentElement.setAttribute(installed, "");
  const chinese = /^zh\b/i.test(
    document.documentElement.lang || navigator.language,
  );
  const title = chinese ? "打开" : "Open";
  const failure = chinese
    ? "打开失败，请检查文件是否存在及默认打开方式。"
    : "Could not open the item. Check that it exists and has a default application.";
  let tree;
  let frame = 0;

  function itemPath(label) {
    let path = label?.getAttribute("title") || "";
    if (label?.hasAttribute("data-hidden-reason")) {
      const end = path.lastIndexOf("\n");
      if (end !== -1) path = path.slice(0, end);
    }
    return /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path) ? path : null;
  }

  function update() {
    frame = 0;
    observer.disconnect();
    try {
      const sidebar = document.querySelector("#session-sidebar");
      tree = sidebar?.querySelector(".sidebar-files-scroll");
      if (!tree) return;
      for (const label of tree.querySelectorAll("span[title]")) {
        const row = label.parentElement;
        if (
          !itemPath(label) ||
          row.querySelector(":scope > button[data-pi-web-open]")
        )
          continue;
        const button = document.createElement("button");
        button.type = "button";
        button.title = title;
        button.setAttribute("aria-label", title);
        button.setAttribute("data-pi-web-open", "");
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "11");
        svg.setAttribute("height", "11");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        const shape = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        shape.setAttribute(
          "d",
          "M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4",
        );
        svg.append(shape);
        button.append(svg);
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const path = itemPath(row.querySelector(":scope > span[title]"));
          if (!path || button.disabled) return;
          button.disabled = true;
          try {
            await invoke("plugin:opener|open_path", { path });
          } catch (error) {
            console.warn("[Pi Web file open] Could not open item:", error);
            if (typeof window.pakeToast === "function")
              window.pakeToast(failure);
          } finally {
            button.disabled = false;
          }
        });
        row.setAttribute("data-pi-web-file-row", "");
        row.append(button);
      }
    } finally {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["title", "data-hidden-reason"],
      });
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        ({ target, addedNodes, removedNodes }) =>
          tree?.contains(target) ||
          [...addedNodes, ...removedNodes].some(
            (node) =>
              node.nodeType === 1 &&
              (node.matches("#session-sidebar, .sidebar-files-scroll") ||
                node.querySelector("#session-sidebar, .sidebar-files-scroll")),
          ),
      )
    )
      schedule();
  });
  function start() {
    update();
  }
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  start();
})();

(() => {
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  if (
    !/mac/i.test(platform) ||
    window.pakeConfig?.new_window !== true ||
    window !== window.top
  )
    return;

  const installed = "data-pi-web-popup-adapter";
  if (document.documentElement.hasAttribute(installed)) return;
  document.documentElement.setAttribute(installed, "");
  const originalOpen = window.open;

  function destinationFor(url, target) {
    if (
      url == null ||
      (typeof url === "string" && (!url.trim() || url.trim().startsWith("#")))
    )
      return null;
    if (["_self", "_parent", "_top"].includes(String(target).toLowerCase()))
      return null;
    let destination;
    try {
      destination = new URL(url, document.baseURI || window.location.href);
    } catch {
      return null;
    }
    if (
      !["http:", "https:"].includes(destination.protocol) ||
      destination.origin !== window.location.origin
    )
      return null;
    if (
      typeof window.isAuthPopup === "function" &&
      window.isAuthPopup(destination.href, target)
    )
      return null;
    return destination;
  }

  function isolatedFeatures(features) {
    const flags = { noopener: false, noreferrer: false };
    const retained = [];
    for (const part of String(features ?? "").split(",")) {
      const [key, rawValue] = part.trim().split("=");
      const name = key.trim().toLowerCase();
      if (name !== "noopener" && name !== "noreferrer") {
        retained.push(part);
        continue;
      }
      const value = rawValue?.trim() || "";
      const integer = parseInt(value, 10);
      flags[name] =
        !value ||
        /^(yes|true)$/i.test(value) ||
        (Number.isFinite(integer) && integer !== 0);
    }
    return flags.noopener || flags.noreferrer ? retained.join(",") : null;
  }

  function paintInitialPopup(popup) {
    if (!popup || popup === window) return;
    try {
      const initial = popup.document;
      if (initial?.URL !== "about:blank" || !initial.documentElement) return;
      // The browser creates an initial document even for direct navigation.
      // Paint it synchronously while the response is pending. Navigation replaces
      // this document, so the destination keeps its own styles and color scheme.
      initial.documentElement.style.backgroundColor = "#000000";
      initial.documentElement.style.colorScheme = "dark";
      if (initial.body) initial.body.style.backgroundColor = "#000000";
    } catch (error) {
      console.warn(
        "[Pake popup compatibility] Could not paint initial popup:",
        error,
      );
    }
  }

  function openIsolated(destination, features) {
    // Navigate once, directly to the target. A blank intermediary adds a visible
    // extra load to Pake's immediately visible native popup windows.
    const popup = originalOpen.call(
      window,
      destination.href,
      "_blank",
      features,
    );
    if (popup && popup !== window) {
      try {
        popup.opener = null;
        if (popup.opener !== null)
          throw new Error("The popup retained its opener");
        paintInitialPopup(popup);
      } catch (error) {
        console.warn(
          "[Pake popup compatibility] Could not isolate popup:",
          error,
        );
        try {
          popup.close();
        } catch (closeError) {
          console.warn(
            "[Pake popup compatibility] Could not close popup:",
            closeError,
          );
        }
      }
    } else if (popup === window) {
      console.warn(
        "[Pake popup compatibility] The popup handler returned the current window",
      );
    }
    // Match native noopener/noreferrer return semantics. Referrer policy remains
    // the page/browser default; this adapter does not add a no-referrer policy.
    return null;
  }

  window.open = function (url, target, features) {
    const destination = destinationFor(url, target);
    const retained = destination ? isolatedFeatures(features) : null;
    if (!destination) return originalOpen.call(this, url, target, features);
    if (retained === null) {
      const popup = originalOpen.call(this, url, target, features);
      paintInitialPopup(popup);
      return popup;
    }
    return openIsolated(destination, retained);
  };

  function isolatedLink(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      window.pakeConfig.force_internal_navigation
    )
      return null;
    const anchor = event.target?.closest?.("a[href]");
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      anchor.target.toLowerCase() !== "_blank"
    )
      return null;
    const rawHref = anchor.getAttribute("href");
    const destination = destinationFor(rawHref, "_blank");
    if (
      !destination ||
      (typeof window.isAuthLink === "function" &&
        window.isAuthLink(destination.href))
    )
      return null;
    const rel = anchor.rel.toLowerCase().split(/\s+/);
    if (
      rel.includes("opener") &&
      !rel.includes("noopener") &&
      !rel.includes("noreferrer")
    )
      return null;
    return { anchor, destination };
  }

  const pendingLinks = new WeakMap();
  // Pake's document capture handler runs first. Its shell plugin also installs
  // a body listener that opens _blank links even after preventDefault(). Use the
  // equivalent uppercase target until window bubbling to bypass that listener
  // without blocking page handlers or changing the native fallback target.
  document.addEventListener(
    "click",
    (event) => {
      const link = isolatedLink(event);
      if (!link) return;
      const target = link.anchor.target;
      link.anchor.target = "_BLANK";
      const restore = () => {
        if (link.anchor.target === "_BLANK") link.anchor.target = target;
        pendingLinks.delete(event);
      };
      pendingLinks.set(event, { restore, timer: setTimeout(restore, 0) });
    },
    true,
  );

  // Window bubbling runs after document/React handlers, so a page can cancel its
  // own link navigation first. Restore even when the page cancelled the click.
  window.addEventListener("click", (event) => {
    const pending = pendingLinks.get(event);
    if (pending) {
      clearTimeout(pending.timer);
      pending.restore();
    }
    const link = isolatedLink(event);
    if (!link) return;
    event.preventDefault();
    // target=_blank links are implicitly noopener, including links without rel.
    openIsolated(link.destination, "");
  });
})();

(() => {
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  if (
    !/mac/i.test(platform) ||
    window.pakeConfig?.hide_title_bar !== true ||
    window !== window.top ||
    !document.documentElement ||
    !document.querySelector
  )
    return;

  // The static export has its own sidebar layout, separate from the main app.
  // Mark it synchronously and avoid installing the main app's layout observers.
  const historySidebar = document.querySelector("#app > aside#sidebar");
  if (
    historySidebar?.querySelector(
      ".sidebar-header #tree-search.sidebar-search",
    ) &&
    historySidebar.querySelector("#tree-container.tree-container") &&
    document.querySelector("#app > main#content > #messages")
  ) {
    document.documentElement.setAttribute("data-pi-web-history-titlebar", "");
    return;
  }

  if (
    typeof ResizeObserver !== "function" ||
    typeof MutationObserver !== "function"
  )
    return;

  const marker = "data-pi-web-titlebar";
  const gutterProperty = "--pi-web-titlebar-gutter";
  const installed = "data-pi-web-titlebar-adapter";
  if (document.documentElement.hasAttribute(installed)) return;
  document.documentElement.setAttribute(installed, "");

  let sidebar;
  let sidebarHeader;
  let mainHeader;
  let layout;
  let frame = 0;
  const adaptedHeaders = new Set();
  const observed = new Set();
  const resizeObserver = new ResizeObserver(schedule);
  const mutationObserver = new MutationObserver((records) => {
    if (
      !sidebar?.isConnected ||
      !sidebarHeader?.isConnected ||
      !mainHeader?.isConnected ||
      records.some(
        ({ target, type }) =>
          target === sidebar ||
          target === layout ||
          target === sidebar.firstElementChild ||
          target === sidebarHeader ||
          (type === "childList" && sidebarHeader.contains(target)),
      )
    )
      schedule();
  });

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function isToolbar(element) {
    if (!element || getComputedStyle(element).display !== "flex") return false;
    const button = element.firstElementChild;
    const height = element.getBoundingClientRect().height;
    return (
      height >= 35 &&
      height <= 37 &&
      button?.matches("button[aria-label]") &&
      button.style.width === "36px" &&
      button.style.height === "36px"
    );
  }

  function discover() {
    sidebar = document.querySelector("#session-sidebar.sidebar-container");
    sidebarHeader = sidebar?.querySelector(
      ".session-sidebar > .sidebar-header",
    );
    if (
      !sidebarHeader?.querySelector(
        ".sidebar-brand, #session-sidebar-tab-sessions",
      ) ||
      !sidebarHeader.querySelector(".sidebar-new-button") ||
      !sidebarHeader.querySelector(".sidebar-search-toggle")
    ) {
      sidebarHeader = null;
      mainHeader = null;
      return;
    }
    layout = sidebar.parentElement;
    // The main pane follows the sidebar and its optional resize separator.
    // Validate the toolbar shape instead of relying on translated labels.
    let pane = sidebar.nextElementSibling;
    if (pane?.matches('[data-resize-handle="sidebar"]'))
      pane = pane.nextElementSibling;
    const candidate = pane?.firstElementChild?.firstElementChild;
    mainHeader = isToolbar(candidate) ? candidate : null;
  }

  function observeSizes() {
    const next = new Set([sidebar, sidebarHeader, mainHeader].filter(Boolean));
    for (const element of observed) {
      if (!next.has(element)) {
        resizeObserver.unobserve(element);
        observed.delete(element);
      }
    }
    for (const element of next) {
      if (!observed.has(element)) {
        resizeObserver.observe(element);
        observed.add(element);
      }
    }
  }

  function update() {
    frame = 0;
    discover();
    observeSizes();
    const rect = layout?.getBoundingClientRect();
    // Exported history and unrelated pages do not have this app structure.
    const eligible =
      sidebarHeader &&
      mainHeader &&
      rect?.width > 0 &&
      Math.abs(rect.left) <= 1 &&
      Math.abs(rect.top) <= 1 &&
      Math.abs(sidebarHeader.getBoundingClientRect().top) <= 1 &&
      Math.abs(mainHeader.getBoundingClientRect().top) <= 1;
    const headers = eligible ? [sidebarHeader, mainHeader] : [];
    for (const header of adaptedHeaders) {
      if (headers.includes(header)) continue;
      header.removeAttribute(marker);
      header.style.removeProperty(gutterProperty);
      adaptedHeaders.delete(header);
    }
    // Commit the initial gutter before enabling the sidebar's matching animation.
    const initialMain = eligible && !adaptedHeaders.has(mainHeader);
    if (initialMain)
      mainHeader.style.setProperty("--pi-web-titlebar-transition", "none");
    for (const header of headers) {
      const kind = header === sidebarHeader ? "sidebar" : "main";
      adaptedHeaders.add(header);
      if (header.getAttribute(marker) !== kind)
        header.setAttribute(marker, kind);

      let gutter = 80;
      if (kind === "sidebar" && header.dataset.fit === "2") {
        // At Pi Web's smallest fitting state, give the existing controls priority.
        // Their measured widths include tab counts, current fonts and locale.
        let controlsWidth = 0;
        for (const child of header.children) {
          if (child.matches(".sidebar-header-spacer")) continue;
          const style = getComputedStyle(child);
          if (style.display === "none") continue;
          controlsWidth +=
            child.getBoundingClientRect().width +
            (parseFloat(style.marginLeft) || 0) +
            (parseFloat(style.marginRight) || 0);
        }
        const rightPadding =
          parseFloat(getComputedStyle(header).paddingRight) || 0;
        gutter = Math.max(
          0,
          Math.min(
            80,
            Math.floor(header.clientWidth - rightPadding - controlsWidth),
          ),
        );
      }
      const value = `${gutter}px`;
      if (header.style.getPropertyValue(gutterProperty) !== value)
        header.style.setProperty(gutterProperty, value);
    }
    if (initialMain) {
      mainHeader.getBoundingClientRect();
      mainHeader.style.removeProperty("--pi-web-titlebar-transition");
    }
  }

  function start() {
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-fit"],
    });
    // DOMContentLoaded already has the server-rendered app. Reserve its gutter
    // before the first paint; later hydration/layout changes remain coalesced.
    update();
  }

  window.addEventListener("resize", schedule);
  document.fonts?.addEventListener("loadingdone", schedule);
  window.addEventListener("pagehide", () => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    observed.clear();
    cancelAnimationFrame(frame);
    frame = 0;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  start();
})();
